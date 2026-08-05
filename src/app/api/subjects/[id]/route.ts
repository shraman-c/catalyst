import { NextRequest, NextResponse } from 'next/server';
import { getSession, ensureSchema } from '@/lib/auth';
import { queryAll, queryOne, execute } from '@/lib/db';
import type { Subject } from '@/lib/types';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await ensureSchema();

    const subject = await queryOne<Subject>(
      'SELECT * FROM subjects WHERE id = ? AND user_id = ?',
      [params.id, session.id]
    );
    if (!subject) return NextResponse.json({ error: 'Subject not found' }, { status: 404 });

    const [noteCount, nodeCount, edgeCount, cardCount, cardsDue, lastSync] = await Promise.all([
      queryOne<{ c: number }>('SELECT COUNT(*) as c FROM note_files WHERE subject_id = ? AND source != "deleted"', [params.id]),
      queryOne<{ c: number }>('SELECT COUNT(*) as c FROM graph_nodes WHERE subject_id = ?', [params.id]),
      queryOne<{ c: number }>('SELECT COUNT(*) as c FROM graph_edges WHERE subject_id = ?', [params.id]),
      queryOne<{ c: number }>('SELECT COUNT(*) as c FROM flashcards WHERE subject_id = ? AND status != "deleted"', [params.id]),
      queryOne<{ c: number }>('SELECT COUNT(*) as c FROM flashcards WHERE subject_id = ? AND status != "deleted" AND (next_review_at IS NULL OR next_review_at <= datetime("now"))', [params.id]),
      queryOne<{ t: string | null }>('SELECT MAX(updated_at) as t FROM note_files WHERE subject_id = ? AND source != "deleted"', [params.id]),
    ]);

    const recentNotes = await queryAll(
      'SELECT id, filename, source, content_hash, created_at, updated_at FROM note_files WHERE subject_id = ? AND source != "deleted" ORDER BY updated_at DESC LIMIT 10',
      [params.id]
    );

    return NextResponse.json({
      subject,
      stats: {
        note_count: noteCount?.c ?? 0,
        graph_node_count: nodeCount?.c ?? 0,
        graph_edge_count: edgeCount?.c ?? 0,
        card_count: cardCount?.c ?? 0,
        cards_due_today: cardsDue?.c ?? 0,
        last_synced_at: lastSync?.t ?? null,
      },
      recent_notes: recentNotes,
    });
  } catch (err) {
    console.error('GET /api/subjects/[id] error:', err);
    return NextResponse.json({ error: 'Failed to fetch subject' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await ensureSchema();

    const subject = await queryOne<Subject>(
      'SELECT * FROM subjects WHERE id = ? AND user_id = ?',
      [params.id, session.id]
    );
    if (!subject) return NextResponse.json({ error: 'Subject not found' }, { status: 404 });

    const body = await request.json();

    if (body.name !== undefined) {
      const ok = await execute('UPDATE subjects SET name = ? WHERE id = ?', [body.name.trim(), params.id]);
      if (!ok) return NextResponse.json({ error: 'Failed to update subject name' }, { status: 500 });
    }
    if (body.archived !== undefined) {
      const ok = await execute('UPDATE subjects SET archived = ? WHERE id = ?', [body.archived ? 'TRUE' : 'FALSE', params.id]);
      if (!ok) return NextResponse.json({ error: 'Failed to update subject archive status' }, { status: 500 });
    }

    const updated = await queryOne<Subject>('SELECT * FROM subjects WHERE id = ?', [params.id]);
    return NextResponse.json({ subject: updated });
  } catch (err) {
    console.error('PATCH /api/subjects/[id] error:', err);
    return NextResponse.json({ error: 'Failed to update subject' }, { status: 500 });
  }
}
