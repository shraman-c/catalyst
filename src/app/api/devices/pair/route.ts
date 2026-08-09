import { NextRequest, NextResponse } from 'next/server';
import { getSession, ensureSchema } from '@/lib/auth';
import { queryOne, queryAll, execute, generateId } from '@/lib/db';
import { parseBody, deviceActionSchema } from '@/lib/validation';
import { SignJWT } from 'jose';

const jwtSecretStr = process.env.JWT_SECRET;
if (!jwtSecretStr) {
  throw new Error(
    'JWT_SECRET environment variable is required for device pairing. Add it to .env.local'
  );
}
const JWT_SECRET = new TextEncoder().encode(jwtSecretStr);

interface Device {
  id: string;
  user_id: string;
  name: string | null;
  pairing_code: string | null;
  token: string | null;
  folder_path: string | null;
  subject_id: string | null;
  last_sync_at: string | null;
  created_at: string;
}

/** Generate a random 6-char alphanumeric pairing code */
function generatePairingCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export async function POST(request: NextRequest) {
  await ensureSchema();

  const body = await request.json().catch(() => null);
  const parsed = parseBody(deviceActionSchema, body);
  if (!parsed.ok) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  const { action } = parsed.data;

  // --- action: generate_code ---
  // Called by dashboard UI. Requires an authenticated session.
  // Creates a pending device entry with a pairing code and returns it.
  if (action === 'generate_code') {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Expire any old unused codes for this user
    await execute(
      'DELETE FROM devices WHERE user_id = ? AND token IS NULL',
      [session.id]
    );

    const code = generatePairingCode();
    const deviceId = generateId();

    await execute(
      `INSERT INTO devices (id, user_id, pairing_code, created_at)
       VALUES (?, ?, ?, NOW())`,
      [deviceId, session.id, code]
    );

    return NextResponse.json({ pairing_code: code, expires_in_seconds: 300 });
  }

  // --- action: redeem_code ---
  // Called by the watcher on first run. No session needed — uses the pairing code.
  // Exchanges pairing code for a signed device JWT token.
  if (action === 'redeem_code') {
    const { pairing_code, device_name, folder_path, subject_id } = parsed.data;

    if (!pairing_code) {
      return NextResponse.json({ error: 'pairing_code is required' }, { status: 400 });
    }

    const device = await queryOne<Device>(
      'SELECT * FROM devices WHERE pairing_code = ? AND token IS NULL',
      [pairing_code]
    );

    if (!device) {
      return NextResponse.json({ error: 'Invalid or expired pairing code' }, { status: 400 });
    }

    // Generate a signed device token (no expiry — revocable by deleting DB row)
    const token = await new SignJWT({
      device_id: device.id,
      user_id: device.user_id,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .sign(JWT_SECRET);

    // Redeem: clear the pairing code, set the token and metadata
    await execute(
      `UPDATE devices SET
         pairing_code = NULL,
         token = ?,
         name = ?,
         folder_path = ?,
         subject_id = ?
       WHERE id = ?`,
      [token, device_name || 'Watcher', folder_path || null, subject_id || null, device.id]
    );

    return NextResponse.json({ device_token: token, device_id: device.id });
  }

  // --- action: revoke ---
  // Called by dashboard to revoke a device. Requires session.
  if (action === 'revoke') {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { device_id } = parsed.data;
    await execute(
      'DELETE FROM devices WHERE id = ? AND user_id = ?',
      [device_id, session.id]
    );

    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

/** GET — list devices for the authenticated user */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureSchema();

  const devices = await queryAll<Device>(
    `SELECT id, user_id, name, folder_path, subject_id, last_sync_at, created_at
     FROM devices WHERE user_id = ? AND token IS NOT NULL
     ORDER BY created_at DESC`,
    [session.id]
  );

  // Also check if there's a pending pairing code
  const pending = await queryOne<{ pairing_code: string }>(
    'SELECT pairing_code FROM devices WHERE user_id = ? AND token IS NULL ORDER BY created_at DESC LIMIT 1',
    [session.id]
  );

  return NextResponse.json({ devices, pending_code: pending?.pairing_code ?? null });
}
