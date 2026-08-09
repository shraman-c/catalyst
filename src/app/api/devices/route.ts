import { NextResponse } from 'next/server';
import { getSession, getSessionJti } from '@/lib/auth';
import { listDevicesForUser } from '@/lib/devices';

/**
 * GET /api/devices — unified Devices list (Part 3).
 * Every live browser session + paired watcher for the current user, plus the
 * id of the current session so the UI can flag "this device".
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [devices, currentSessionId] = await Promise.all([
    listDevicesForUser(session.id),
    getSessionJti(),
  ]);

  return NextResponse.json({ devices, current_session_id: currentSessionId });
}
