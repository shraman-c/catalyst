import { NextRequest, NextResponse } from 'next/server';
import { getSession, ensureSchema } from '@/lib/auth';
import { queryAll, queryOne, execute, generateId } from '@/lib/db';
import { parseBody, createSubjectSchema } from '@/lib/validation';
import { getCardsDueCount } from '@/lib/review';
import type { Subject } from '@/lib/types';

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await ensureSchema();

    const subjects = await queryAll<Subject>(
      'SELECT * FROM subjects WHERE user_id = ? AND archived = FALSE ORDER BY created_at DESC',
      [session.id]
    );

    const subjectsWithStats = await Promise.all(
      subjects.map(async (s) => {
        const [noteCount, nodeCount, cardCount, cardsDue, lastSync] = await Promise.all([
          queryOne<{ c: number }>('SELECT COUNT(*) as c FROM note_files WHERE subject_id = ?', [s.id]),
          queryOne<{ c: number }>('SELECT COUNT(*) as c FROM graph_nodes WHERE subject_id = ?', [s.id]),
          queryOne<{ c: number }>("SELECT COUNT(*) as c FROM flashcards WHERE subject_id = ? AND status != 'deleted'", [s.id]),
          getCardsDueCount(s.id, session.id),
          queryOne<{ t: string | null }>('SELECT MAX(updated_at) as t FROM note_files WHERE subject_id = ?', [s.id]),
        ]);
        return {
          ...s,
          stats: {
            note_count: noteCount?.c ?? 0,
            graph_node_count: nodeCount?.c ?? 0,
            graph_edge_count: 0,
            card_count: cardCount?.c ?? 0,
            cards_due_today: cardsDue,
            last_synced_at: lastSync?.t ?? null,
          },
        };
      })
    );

    return NextResponse.json({ subjects: subjectsWithStats });
  } catch (err) {
    console.error('GET /api/subjects error:', err);
    return NextResponse.json({ error: 'Failed to fetch subjects' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => null);
    const parsed = parseBody(createSubjectSchema, body);
    if (!parsed.ok) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    const { name, description } = parsed.data;

    await ensureSchema();

    const id = generateId();
    const ok = await execute(
      "INSERT INTO subjects (id, user_id, name, description, created_at) VALUES (?, ?, ?, ?, NOW())",
      [id, session.id, name.trim(), description?.trim() || null]
    );
    if (!ok) {
      return NextResponse.json({ error: 'Failed to create subject. Database write error.' }, { status: 500 });
    }

    const subject = await queryOne<Subject>('SELECT * FROM subjects WHERE id = ?', [id]);
    if (!subject) {
      return NextResponse.json({ error: 'Subject created but could not be retrieved.' }, { status: 500 });
    }

    return NextResponse.json({ subject }, { status: 201 });
  } catch (err) {
    console.error('POST /api/subjects error:', err);
    return NextResponse.json({ error: 'Failed to create subject' }, { status: 500 });
  }
}
