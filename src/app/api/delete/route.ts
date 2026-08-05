import { NextRequest, NextResponse } from 'next/server';
import { getSession, ensureSchema } from '@/lib/auth';
import { queryAll, execute } from '@/lib/db';

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureSchema();

  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type'); // 'subject', 'account', 'notes'
  const id = searchParams.get('id');

  if (!type) {
    return NextResponse.json({ error: 'Delete type is required' }, { status: 400 });
  }

  try {
    if (type === 'subject' && id) {
      // Delete a specific subject and all its data
      const subject = await queryAll(
        'SELECT * FROM subjects WHERE id = ? AND user_id = ?',
        [id, session.id]
      );
      
      if (subject.length === 0) {
        return NextResponse.json({ error: 'Subject not found' }, { status: 404 });
      }

      // Delete in order to respect foreign key constraints
      await execute('DELETE FROM review_history WHERE card_id IN (SELECT id FROM flashcards WHERE subject_id = ?)', [id]);
      await execute('DELETE FROM flashcards WHERE subject_id = ?', [id]);
      await execute('DELETE FROM node_note_map WHERE node_id IN (SELECT id FROM graph_nodes WHERE subject_id = ?)', [id]);
      await execute('DELETE FROM graph_edges WHERE subject_id = ?', [id]);
      await execute('DELETE FROM graph_nodes WHERE subject_id = ?', [id]);
      await execute('DELETE FROM note_versions WHERE note_file_id IN (SELECT id FROM note_files WHERE subject_id = ?)', [id]);
      await execute('DELETE FROM note_files WHERE subject_id = ?', [id]);
      await execute('DELETE FROM subjects WHERE id = ?', [id]);

      return NextResponse.json({ success: true, message: 'Subject and all associated data deleted' });
    }

    if (type === 'account') {
      // Delete entire account and all data
      const userId = session.id;

      // Delete in order to respect foreign key constraints
      await execute('DELETE FROM review_history WHERE user_id = ?', [userId]);
      await execute('DELETE FROM devices WHERE user_id = ?', [userId]);
      await execute('DELETE FROM user_preferences WHERE user_id = ?', [userId]);
      
      // Delete all subjects and their data
      const subjects = await queryAll('SELECT id FROM subjects WHERE user_id = ?', [userId]);
      for (const subject of subjects) {
        await execute('DELETE FROM flashcards WHERE subject_id = ?', [(subject as any).id]);
        await execute('DELETE FROM node_note_map WHERE node_id IN (SELECT id FROM graph_nodes WHERE subject_id = ?)', [(subject as any).id]);
        await execute('DELETE FROM graph_edges WHERE subject_id = ?', [(subject as any).id]);
        await execute('DELETE FROM graph_nodes WHERE subject_id = ?', [(subject as any).id]);
        await execute('DELETE FROM note_versions WHERE note_file_id IN (SELECT id FROM note_files WHERE subject_id = ?)', [(subject as any).id]);
        await execute('DELETE FROM note_files WHERE subject_id = ?', [(subject as any).id]);
      }
      await execute('DELETE FROM subjects WHERE user_id = ?', [userId]);
      
      // Finally delete the user
      await execute('DELETE FROM users WHERE id = ?', [userId]);

      return NextResponse.json({ success: true, message: 'Account and all data deleted' });
    }

    if (type === 'notes' && id) {
      // Delete a specific note and its versions
      const note = await queryAll(
        'SELECT * FROM note_files WHERE id = ? AND subject_id IN (SELECT id FROM subjects WHERE user_id = ?)',
        [id, session.id]
      );
      
      if (note.length === 0) {
        return NextResponse.json({ error: 'Note not found' }, { status: 404 });
      }

      // Delete note versions
      await execute('DELETE FROM note_versions WHERE note_file_id = ?', [id]);
      
      // Soft delete the note (preserve graph/cards per AppFlow §7)
      await execute(
        "UPDATE note_files SET source = 'deleted', updated_at = NOW() WHERE id = ?",
        [id]
      );

      return NextResponse.json({ success: true, message: 'Note soft deleted' });
    }

    return NextResponse.json({ error: 'Invalid delete type' }, { status: 400 });
  } catch (err) {
    console.error('Delete error:', err);
    return NextResponse.json({ error: 'Failed to delete data' }, { status: 500 });
  }
}