import { NextRequest, NextResponse } from 'next/server';
import { getSession, ensureSchema } from '@/lib/auth';
import { queryAll, queryOne } from '@/lib/db';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureSchema();

  const noteFile = await queryOne<any>(
    `SELECT nf.*, s.user_id FROM note_files nf
     JOIN subjects s ON nf.subject_id = s.id
     WHERE nf.id = ? AND s.user_id = ?`,
    [params.id, session.id]
  );
  if (!noteFile) return NextResponse.json({ error: 'Note not found' }, { status: 404 });

  const [latestVersion, concepts, cards] = await Promise.all([
    queryOne<{ content: string }>(
      'SELECT content FROM note_versions WHERE note_file_id = ? ORDER BY created_at DESC LIMIT 1',
      [params.id]
    ),
    queryAll(
      `SELECT gn.* FROM graph_nodes gn
       JOIN node_note_map nnm ON gn.id = nnm.node_id
       WHERE nnm.note_file_id = ?
       ORDER BY gn.reference_count DESC`,
      [params.id]
    ),
    queryAll(
      'SELECT * FROM flashcards WHERE note_file_id = ? AND status != "deleted" ORDER BY created_at DESC',
      [params.id]
    ),
  ]);

  return NextResponse.json({
    note: noteFile,
    content: latestVersion?.content || '',
    concepts,
    cards,
  });
}
