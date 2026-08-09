import { NextRequest, NextResponse } from 'next/server';
import { getSession, ensureSchema } from '@/lib/auth';
import { queryOne, execute, generateId } from '@/lib/db';
import { parseBody, createSubjectSchema } from '@/lib/validation';
import { getSubjectsWithStats } from '@/lib/review';
import type { Subject } from '@/lib/types';

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await ensureSchema();

    // Single query for all subjects + stats (was 5N round-trips, see
    // getSubjectsWithStats in src/lib/review.ts).
    const subjectRows = await getSubjectsWithStats(session.id);

    const subjects = subjectRows.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      created_at: s.created_at,
      stats: {
        note_count: s.note_count,
        graph_node_count: s.graph_node_count,
        graph_edge_count: 0,
        card_count: s.card_count,
        cards_due_today: s.cards_due_today,
        last_synced_at: s.last_synced_at,
      },
    }));

    return NextResponse.json({ subjects });
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
