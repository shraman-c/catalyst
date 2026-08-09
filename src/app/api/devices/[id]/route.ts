import { NextRequest, NextResponse } from 'next/server';
import { getSession, getSessionJti, COOKIE_NAME_EXPORT } from '@/lib/auth';
import { revokeDevice } from '@/lib/devices';
import type { DeviceType } from '@/lib/types';

/**
 * DELETE /api/devices/[id]?type=browser_session|sync_watcher (Part 3).
 * Revokes a session/device server-side. Revocation is enforced on the NEXT
 * authenticated request from that device:
 *   - browser sessions: verifySession() rejects revoked rows (audit 2.6).
 *   - watchers: the signed token no longer matches any device row, so the
 *     sync/files route rejects it.
 * If the revoked session IS the current one, the cookie is deleted and the
 * client is told so it can redirect to login immediately.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const type = new URL(request.url).searchParams.get('type');
  if (type !== 'browser_session' && type !== 'sync_watcher') {
    return NextResponse.json({ error: 'Invalid device type' }, { status: 400 });
  }

  const ok = await revokeDevice(session.id, id, type as DeviceType);
  if (!ok) return NextResponse.json({ error: 'Device not found' }, { status: 404 });

  // If the user just revoked their own active session, log them out now.
  const currentJti = await getSessionJti();
  const revokedCurrent = currentJti === id;

  const response = NextResponse.json({ success: true, revoked_current: revokedCurrent });
  if (revokedCurrent) {
    response.cookies.delete(COOKIE_NAME_EXPORT);
  }
  return response;
}
