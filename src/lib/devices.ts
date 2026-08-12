import { queryOne, execute, queryAll } from './db';
import type { DeviceType } from './types';

/**
 * Device/session management (Part 3).
 *
 * The unified Devices UI shows BOTH kinds of device attached to an account:
 *  - browser sessions (rows in `sessions`, identified by the JWT jti) and
 *  - paired watcher instances (rows in `devices`, identified by device id).
 *
 * Design decision (logged in progress.md): keep the two tables separate rather
 * than physically merging them. `sessions` is the security-audit enforcement
 * store woven into verifySession()/createSession()/revokeSession(); `devices`
 * is the watcher pairing store with its own token auth (sync/files route).
 * Merging them would rewrite audit-critical code and require a production data
 * migration for zero security gain. The UI is one unified list either way.
 */

export interface UnifiedDevice {
  id: string;
  type: DeviceType;
  /** Display name: "Chrome on Android" (browser) or the watcher's device name. */
  label: string;
  /** Secondary line: watcher folder path, or the client IP for a browser. */
  detail: string | null;
  ip_address: string | null;
  last_active_at: string | null;
  created_at: string;
}

interface BrowserSessionRow {
  id: string;
  device_label: string | null;
  ip_address: string | null;
  created_at: string;
  last_active_at: string | null;
}

interface WatcherDeviceRow {
  id: string;
  name: string | null;
  folder_path: string | null;
  created_at: string;
  last_sync_at: string | null;
}

/**
 * Parse a User-Agent into a human label like "Chrome on Android".
 * Dependency-free; ordering matters (Edg before Chrome, SamsungBrowser before
 * Chrome, OPR before Chrome — Edge/Opera UAs contain the Chrome token).
 */
export function parseDeviceLabel(userAgent: string | null): string {
  const ua = userAgent || '';

  let os = 'Unknown OS';
  if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/CrOS/i.test(ua)) os = 'Chrome OS';
  else if (/Linux/i.test(ua)) os = 'Linux';

  let browser = 'Browser';
  // iOS browsers use vendor-specific tokens (CriOS/FxiOS/EdgiOS) and otherwise
  // fall through to the generic Safari token — check them before Safari.
  if (/EdgiOS\//i.test(ua)) browser = 'Edge';
  else if (/FxiOS\//i.test(ua)) browser = 'Firefox';
  else if (/CriOS\//i.test(ua)) browser = 'Chrome';
  else if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/SamsungBrowser/i.test(ua)) browser = 'Samsung Internet';
  else if (/OPR\//i.test(ua)) browser = 'Opera';
  else if (/Chrome\//i.test(ua)) browser = 'Chrome';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua)) browser = 'Safari';

  return `${browser} on ${os}`;
}

/**
 * All live devices for a user, newest activity first, unified shape.
 * Browser sessions: every non-revoked session row. Watchers: every paired
 * device (a row with a redeemed token — pending pairing rows are excluded).
 */
export async function listDevicesForUser(userId: string): Promise<UnifiedDevice[]> {
  // Expired sessions are dead per verifySession() (expires_at < NOW()); keep the
  // list consistent with enforcement by only showing sessions that are still live.
  const sessions = await queryAll<BrowserSessionRow>(
    `SELECT id, device_label, ip_address, created_at, last_active_at
     FROM sessions
     WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
     ORDER BY COALESCE(last_active_at, created_at) DESC`,
    [userId]
  );

  const watchers = await queryAll<WatcherDeviceRow>(
    `SELECT id, name, folder_path, created_at, last_sync_at
     FROM devices
     WHERE user_id = $1 AND token IS NOT NULL
     ORDER BY COALESCE(last_sync_at, created_at) DESC`,
    [userId]
  );

  const browserDevices: UnifiedDevice[] = sessions.map((s) => ({
    id: s.id,
    type: 'browser_session' as const,
    label: s.device_label || 'Unknown browser',
    detail: s.ip_address ? `IP ${s.ip_address}` : null,
    ip_address: s.ip_address,
    last_active_at: s.last_active_at,
    created_at: s.created_at,
  }));

  const watcherDevices: UnifiedDevice[] = watchers.map((w) => ({
    id: w.id,
    type: 'sync_watcher' as const,
    label: w.name || 'Watcher',
    detail: w.folder_path || null,
    ip_address: null,
    last_active_at: w.last_sync_at,
    created_at: w.created_at,
  }));

  return [...browserDevices, ...watcherDevices].sort((a, b) => {
    const ta = new Date(a.last_active_at ?? a.created_at).getTime();
    const tb = new Date(b.last_active_at ?? b.created_at).getTime();
    return tb - ta;
  });
}

/**
 * Revoke a device, ownership-checked.
 *  - browser_session: soft-revoke the session row — verifySession() rejects
 *    the token on its next request (this IS the audit 2.6 enforcement, applied
 *    via the UI).
 *  - sync_watcher: delete the row — its signed token no longer matches any
 *    device row, so the sync/files route rejects it (same as the old
 *    pair-route revoke).
 * Returns false when the id doesn't belong to the user (or doesn't exist).
 */
export async function revokeDevice(userId: string, id: string, type: DeviceType): Promise<boolean> {
  if (type === 'browser_session') {
    const row = await queryOne<{ id: string }>(
      'SELECT id FROM sessions WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    if (!row) return false;
    return execute('UPDATE sessions SET revoked_at = NOW() WHERE id = $1', [id]);
  }

  const row = await queryOne<{ id: string }>(
    'SELECT id FROM devices WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  if (!row) return false;
  return execute('DELETE FROM devices WHERE id = $1', [id]);
}
