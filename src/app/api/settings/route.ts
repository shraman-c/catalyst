import { NextRequest, NextResponse } from 'next/server';
import { getSession, ensureSchema } from '@/lib/auth';
import { queryOne, execute } from '@/lib/db';
import { parseBody, updateSettingsSchema } from '@/lib/validation';

interface UserPreferences {
  user_id: string;
  card_density: number;
  graph_verbosity: string;
  updated_at: string;
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureSchema();

  const prefs = await queryOne<UserPreferences>(
    'SELECT * FROM user_preferences WHERE user_id = ?',
    [session.id]
  );

  // Return defaults if no preferences row yet
  return NextResponse.json({
    prefs: prefs ?? {
      user_id: session.id,
      card_density: 20,
      graph_verbosity: 'standard',
    },
    user: { id: session.id, email: session.email, name: session.name },
  });
}

export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureSchema();

  const body = await request.json().catch(() => null);
  const parsed = parseBody(updateSettingsSchema, body);
  if (!parsed.ok) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  const { card_density, graph_verbosity } = parsed.data;

  // Upsert preferences
  await execute(
    `INSERT INTO user_preferences (user_id, card_density, graph_verbosity, updated_at)
     VALUES (?, ?, ?, NOW())
     ON CONFLICT(user_id) DO UPDATE SET
       card_density = excluded.card_density,
       graph_verbosity = excluded.graph_verbosity,
       updated_at = excluded.updated_at`,
    [
      session.id,
      card_density ?? 20,
      graph_verbosity ?? 'standard',
    ]
  );

  return NextResponse.json({ success: true });
}
