import { NextRequest, NextResponse } from 'next/server';
import { getSession, ensureSchema } from '@/lib/auth';
import { queryAll, queryOne } from '@/lib/db';
import type { NoteFile, Subject } from '@/lib/types';

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureSchema();

  const { searchParams } = new URL(request.url);
  const subjectId = searchParams.get('subject_id');

  if (!subjectId) {
    return NextResponse.json({ error: 'subject_id is required' }, { status: 400 });
  }

  // Verify subject belongs to the user
  const subject = await queryOne<Subject>(
    'SELECT * FROM subjects WHERE id = ? AND user_id = ?',
    [subjectId, session.id]
  );
  if (!subject) return NextResponse.json({ error: 'Subject not found' }, { status: 404 });

  const notes = await queryAll<NoteFile & { card_count: number; node_count: number }>(
    `SELECT nf.*,
       (SELECT COUNT(*) FROM flashcards fc WHERE fc.note_file_id = nf.id AND fc.status != 'deleted') AS card_count,
       (SELECT COUNT(*) FROM node_note_map nnm WHERE nnm.note_file_id = nf.id) AS node_count
     FROM note_files nf
     WHERE nf.subject_id = ?
     ORDER BY nf.updated_at DESC`,
    [subjectId]
  );

  return NextResponse.json({ notes, subject });
}
