import { NextRequest, NextResponse } from 'next/server';
import { getSession, ensureSchema } from '@/lib/auth';
import { queryOne, execute, generateId } from '@/lib/db';
import { processNote, hashContent } from '@/lib/ai/pipeline';
import { parseBody, uploadNoteSchema } from '@/lib/validation';
import { encryptNote } from '@/lib/encryption';
import type { Subject } from '@/lib/types';

const MAX_FILE_SIZE = 2 * 1024 * 1024;

// Audit 3.3: explicit extension allowlist (checked server-side).
const ALLOWED_EXTENSIONS = ['.md', '.txt', '.markdown', '.mdx', '.text'];

/**
 * Audit 3.3: content inspection, not just the filename.
 * Rejects binary payloads (NUL bytes / high ratio of control chars) and
 * non-allowlisted extensions, which can be spoofed by the client.
 */
function validateUpload(filename: string, content: string): { ok: true } | { ok: false; error: string } {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return { ok: false, error: 'Unsupported file type. Only .md, .txt, .markdown are allowed.' };
  }
  if (content.includes('\u0000')) {
    return { ok: false, error: 'File appears to be binary. Only text notes are supported.' };
  }
  const controlRatio =
    content.length > 0
      ? (content.match(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g)?.length ?? 0) / content.length
      : 0;
  if (controlRatio > 0.1) {
    return { ok: false, error: 'File appears to be binary. Only text notes are supported.' };
  }
  return { ok: true };
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureSchema();

  let subjectId: string;
  let filename: string;
  let content: string;

  const contentType = request.headers.get('content-type') || '';    if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    subjectId = (formData.get('subject_id') as string) || '';
    const file = formData.get('file') as File | null;

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: `FILE TOO LARGE — MAX 2MB (${file.name})` }, { status: 413 });
    }

    filename = file.name;
    content = await file.text();

    // Audit 3.3: validate by content inspection, not just extension.
    const check = validateUpload(filename, content);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
  } else {
    const body = await request.json().catch(() => null);
    const parsed = parseBody(uploadNoteSchema, body);
    if (!parsed.ok) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    subjectId = parsed.data.subject_id;
    filename = parsed.data.filename || 'pasted-note.md';
    content = parsed.data.content;

    // Audit 3.3: pasted notes default to .md but still must be text.
    const check = validateUpload(filename, content);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
  }

  if (!subjectId || !content?.trim()) {
    return NextResponse.json({ error: 'subject_id and content are required' }, { status: 400 });
  }

  const subject = await queryOne<Subject>(
    'SELECT * FROM subjects WHERE id = ? AND user_id = ?',
    [subjectId, session.id]
  );
  if (!subject) return NextResponse.json({ error: 'Subject not found' }, { status: 404 });

  const contentHash = await hashContent(content);

  const existingFile = await queryOne<{ id: string; content_hash: string }>(
    'SELECT id, content_hash FROM note_files WHERE subject_id = ? AND filename = ?',
    [subjectId, filename]
  );

  if (existingFile?.content_hash === contentHash) {
    return NextResponse.json({
      message: 'Content unchanged — no reprocessing needed',
      note_file_id: existingFile.id,
      reprocessed: false,
    });
  }

  let noteFileId: string;
  const isNewFile = !existingFile;
  const previousHash = existingFile?.content_hash ?? null;

  if (existingFile) {
    await execute(
      'UPDATE note_files SET content_hash = ?, updated_at = NOW() WHERE id = ?',
      [contentHash, existingFile.id]
    );
    noteFileId = existingFile.id;
  } else {
    noteFileId = generateId();
    await execute(
      "INSERT INTO note_files (id, subject_id, filename, content_hash, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())",
      [noteFileId, subjectId, filename, contentHash, 'upload']
    );
  }

  const versionId = generateId();
  // Encryption at rest (fix 3.3): the stored version is ciphertext; the AI
  // pipeline below still receives the plaintext `content` in memory.
  await execute(
    "INSERT INTO note_versions (id, note_file_id, content, created_at) VALUES (?, ?, ?, NOW())",
    [versionId, noteFileId, encryptNote(content)]
  );

  try {
    const pipelineResult = await processNote(noteFileId, subjectId, content, contentHash);
    return NextResponse.json({ success: true, note_file_id: noteFileId, reprocessed: true, pipeline: pipelineResult });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Pipeline error:', error);

    // Roll back the note-file change so a retry actually reprocesses instead of
    // being short-circuited by the "content unchanged" dedup check.
    if (isNewFile) {
      await execute('DELETE FROM note_files WHERE id = ?', [noteFileId]);
    } else if (previousHash) {
      await execute(
        'UPDATE note_files SET content_hash = ?, updated_at = NOW() WHERE id = ?',
        [previousHash, noteFileId]
      );
    }

    return NextResponse.json(
      { error: 'AI PROCESSING FAILED', detail: message, note_file_id: noteFileId },
      { status: 500 }
    );
  }
}
