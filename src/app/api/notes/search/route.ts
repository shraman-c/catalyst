import { NextRequest, NextResponse } from 'next/server';
import { getSession, ensureSchema } from '@/lib/auth';
import { queryAll, queryOne } from '@/lib/db';
import { decryptNote } from '@/lib/encryption';
import { noteSearchQuerySchema } from '@/lib/validation';
import type { Subject } from '@/lib/types';

/**
 * Full-text search over note content (encryption-at-rest friendly).
 *
 * Design: note_versions.content is ciphertext at rest, so the index-free
 * approach decrypts + scans in memory. This is deliberately O(corpus) per
 * query, which is fine for this app's scale: notes are capped at 2 MB each
 * and the corpus is a single user's notes. One LATERAL query fetches only
 * the latest version of every visible note, so no plaintext is ever stored —
 * the encryption guarantee from fix 3.3 is untouched.
 *
 * If the corpus ever grows past ~100-200 MB total, swap this for a
 * write-time index (pg_trgm side table, accepting the plaintext-token
 * tradeoff, or a Pinecone chunk namespace for semantic search).
 *
 * Bounds: the query scans at most MAX_SCAN most-recently-updated notes per
 * request (so a single search never decrypts the whole corpus) and returns
 * at most MAX_RESULTS. Tradeoff: notes older than the scan window aren't
 * searchable from here (they remain visible on the notes list page).
 *
 * Ranking: filename matches first, then occurrence count. Results are capped
 * at MAX_RESULTS; snippets are extracted around the first few matches.
 */

const MAX_SCAN = 500;
const MAX_RESULTS = 25;
const MAX_SNIPPETS = 3;
const SNIPPET_RADIUS = 70;

interface NoteRow {
  id: string;
  filename: string;
  updated_at: string;
  subject_id: string;
  subject_name: string;
  content: string | null;
}

interface SearchResult {
  id: string;
  filename: string;
  updated_at: string;
  subject_name: string;
  match_count: number;
  filename_matched: boolean;
  snippets: string[];
}

function countMatches(haystack: string, needle: string): number {
  if (!needle) return 0;
  const lower = haystack.toLowerCase();
  let count = 0;
  let from = 0;
  for (;;) {
    const idx = lower.indexOf(needle, from);
    if (idx === -1) break;
    count++;
    from = idx + needle.length;
  }
  return count;
}

/** Pull up to maxSnippets context windows around matches in the plaintext. */
function extractSnippets(content: string, needle: string, maxSnippets: number, radius: number): string[] {
  const lower = content.toLowerCase();
  const snippets: string[] = [];
  let from = 0;
  while (snippets.length < maxSnippets) {
    const idx = lower.indexOf(needle, from);
    if (idx === -1) break;
    const start = Math.max(0, idx - radius);
    const end = Math.min(content.length, idx + needle.length + radius);
    const pre = start > 0 ? '…' : '';
    const post = end < content.length ? '…' : '';
    snippets.push(pre + content.slice(start, end) + post);
    from = idx + needle.length;
  }
  return snippets;
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureSchema();

  const { searchParams } = new URL(request.url);
  // searchParams.get() returns null for absent params; zod's .optional() only
  // accepts undefined, so map null -> undefined (global search omits subject_id).
  const subjectIdRaw = searchParams.get('subject_id');
  const parsed = noteSearchQuerySchema.safeParse({
    q: searchParams.get('q'),
    subject_id: subjectIdRaw ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid search query' }, { status: 400 });
  }
  const { q, subject_id } = parsed.data;

  // Scope check: a supplied subject_id must belong to the caller.
  if (subject_id) {
    const subject = await queryOne<Subject>(
      'SELECT * FROM subjects WHERE id = ? AND user_id = ?',
      [subject_id, session.id]
    );
    if (!subject) return NextResponse.json({ error: 'Subject not found' }, { status: 404 });
  }

  // Latest version per note file, scoped to the user's subjects (optionally
  // one subject). Only the most recent version is searched.
  const notes = await queryAll<NoteRow>(
    `SELECT nf.id, nf.filename, nf.updated_at, nf.subject_id,
            s.name AS subject_name,
            nv.content
     FROM note_files nf
     JOIN subjects s ON nf.subject_id = s.id
     LEFT JOIN LATERAL (
       SELECT content FROM note_versions
       WHERE note_file_id = nf.id
       ORDER BY created_at DESC
       LIMIT 1
     ) nv ON true
     WHERE s.user_id = ? AND nf.source != 'deleted'
       ${subject_id ? 'AND nf.subject_id = ?' : ''}
     ORDER BY nf.updated_at DESC
     LIMIT ${MAX_SCAN}`,
    subject_id ? [session.id, subject_id] : [session.id]
  );

  const needle = q.toLowerCase();
  const results: SearchResult[] = [];

  for (const note of notes) {
    const content = note.content ? decryptNote(note.content) : '';
    const matchCount = countMatches(content, needle);
    const filenameMatched = note.filename.toLowerCase().includes(needle);
    if (matchCount === 0 && !filenameMatched) continue;

    results.push({
      id: note.id,
      filename: note.filename,
      updated_at: note.updated_at,
      subject_name: note.subject_name,
      match_count: matchCount,
      filename_matched: filenameMatched,
      snippets: extractSnippets(content, needle, MAX_SNIPPETS, SNIPPET_RADIUS),
    });
  }

  results.sort(
    (a, b) =>
      Number(b.filename_matched) - Number(a.filename_matched) ||
      b.match_count - a.match_count
  );

  return NextResponse.json({
    query: q,
    subject_id: subject_id ?? null,
    total: results.length,
    results: results.slice(0, MAX_RESULTS),
  });
}
