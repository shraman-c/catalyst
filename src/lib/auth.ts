import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
// Argon2id (prebuilt native binary, @node-rs/argon2) — kept external to
// webpack via serverExternalPackages in next.config.js.
import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';
import { queryOne, execute, executeStrict, generateId, initializeSchema, ensureDeviceMigrations } from './db';
import type { SessionUser } from './types';

const secretStr = process.env.NEXTAUTH_SECRET;

function getSecret(): Uint8Array {
  if (!secretStr) {
    throw new Error(
      'NEXTAUTH_SECRET environment variable is required. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))" ' +
      'and add it to .env.local'
    );
  }
  return new TextEncoder().encode(secretStr);
}

// Dual-key verification (audit 1.7 / fix 3.2): during a secret rotation window,
// set NEXTAUTH_SECRET_PREVIOUS to the old value so existing sessions still
// verify while new sessions are signed with the current secret. Remove the
// previous value once all old JWTs have expired.
function getVerifySecrets(): Uint8Array[] {
  const previousSecretStr = process.env.NEXTAUTH_SECRET_PREVIOUS;
  const secrets = [getSecret()];
  if (previousSecretStr) {
    secrets.push(new TextEncoder().encode(previousSecretStr));
  }
  return secrets;
}

export const COOKIE_NAME_EXPORT = 'catalyst_session';

// Use a global flag so HMR doesn't reset the flag mid-request,
// but a real server restart (new process) always runs migrations.
declare global {
  // eslint-disable-next-line no-var
  var __catalystSchemaInit: boolean | undefined;
}

export async function ensureSchema() {
  if (global.__catalystSchemaInit) return;
  // One cheap catalog probe instead of the ~30-statement initializeSchema()
  // DDL sweep. On serverless (Vercel) every cold instance used to run the full
  // DDL on its first request — multi-second latency on login AND on every data
  // fetch. Only a genuinely fresh database (no `users` table) runs migrations now.
  // Note: this short-circuits the idempotent ALTER-column backfills in
  // initializeSchema() for pre-existing tables — if you ever add a column to
  // the schema, run the DDL once manually on the production DB.
  const probe = await queryOne<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = 'users') AS exists"
  );
  if (probe?.exists) {
    // Existing DB: run only the additive column backfills (Part 3), never the
    // full DDL sweep — keeps the cold-start win while self-migrating.
    await ensureDeviceMigrations();
    global.__catalystSchemaInit = true;
    return;
  }
  await initializeSchema();
  global.__catalystSchemaInit = true;
}

const SESSION_DAYS = 30;

export interface SessionMeta {
  device_label?: string | null;
  ip_address?: string | null;
}

/**
 * Create a session: sign a JWT (with a jti) AND persist a row in the sessions
 * table. The DB row is the source of truth — see verifySession().
 *
 * `meta` carries the device fingerprint (parsed User-Agent + client IP) so
 * browser sessions appear in the unified Devices list (Part 3).
 */
export async function createSession(user: SessionUser, meta?: SessionMeta): Promise<string> {
  // The sessions table must exist before the row insert (fresh-DB first login).
  await ensureSchema();
  const jti = crypto.randomUUID();
  const token = await new SignJWT({ user })
    .setProtectedHeader({ alg: 'HS256' })
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(getSecret());

  // Best-effort row insert. If the write fails the token still verifies but
  // has no backing row, so verifySession() will reject it — fail closed.
  await execute(
    `INSERT INTO sessions (id, user_id, device_label, ip_address, created_at, expires_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW() + INTERVAL '${SESSION_DAYS} days')`,
    [jti, user.id, meta?.device_label ?? null, meta?.ip_address ?? null]
  );
  return token;
}

// Throttled last-active bookkeeping (Part 3): sessions.last_active_at is the
// "last seen" value shown on the Devices page. Updating it on EVERY request
// would add a write to every authenticated call, so it's throttled per jti to
// once per 10 minutes per serverless instance (best-effort — the PRD asks for
// 10–15 min granularity, not request-accurate timestamps).
const lastActiveUpdates = new Map<string, number>();
const LAST_ACTIVE_THROTTLE_MS = 10 * 60 * 1000;
const MAX_LAST_ACTIVE_ENTRIES = 5000;
const LAST_ACTIVE_TTL_MS = 24 * 60 * 60 * 1000;

async function touchSession(jti: string): Promise<void> {
  const now = Date.now();
  const last = lastActiveUpdates.get(jti);
  if (last !== undefined && now - last <= LAST_ACTIVE_THROTTLE_MS) return;

  // Bound memory: drop entries not seen in 24h; if still over budget, reset.
  if (lastActiveUpdates.size >= MAX_LAST_ACTIVE_ENTRIES) {
    for (const [k, t] of lastActiveUpdates) {
      if (now - t > LAST_ACTIVE_TTL_MS) lastActiveUpdates.delete(k);
    }
    if (lastActiveUpdates.size >= MAX_LAST_ACTIVE_ENTRIES) lastActiveUpdates.clear();
  }
  lastActiveUpdates.set(jti, now);
  await execute('UPDATE sessions SET last_active_at = NOW() WHERE id = $1', [jti]);
}

/**
 * Verify a JWT and check its backing session row is present, unrevoked, and
 * unexpired. A token that verifies cryptographically but has no live session
 * row (revoked, deleted, or legacy pre-migration) is rejected.
 */
export async function verifySession(token: string): Promise<SessionUser | null> {
  await ensureSchema();
  let payload: any;
  try {
    for (const secret of getVerifySecrets()) {
      try {
        const result = await jwtVerify(token, secret);
        payload = result.payload;
        break;
      } catch {
        // try next key
      }
    }
    if (!payload) return null;
  } catch {
    return null;
  }

  const jti = payload.jti as string | undefined;
  if (!jti) return null; // legacy token without a session row

  const session = await queryOne<{ id: string; revoked_at: string | null; expires_at: string }>(
    'SELECT id, revoked_at, expires_at FROM sessions WHERE id = $1',
    [jti]
  );
  if (!session) return null;
  if (session.revoked_at) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) return null;

  // Best-effort throttled "last seen" update (Part 3) — execute() swallows
  // errors internally, so this never blocks or fails a request.
  await touchSession(jti);

  return payload.user as SessionUser;
}

/** Revoke a single session server-side (logout). */
export async function revokeSession(token: string): Promise<void> {
  try {
    let jti: string | undefined;
    for (const secret of getVerifySecrets()) {
      try {
        const { payload } = await jwtVerify(token, secret);
        jti = payload.jti as string | undefined;
        break;
      } catch {
        // try next key
      }
    }
    if (!jti) return;
    await execute('UPDATE sessions SET revoked_at = NOW() WHERE id = $1', [jti]);
  } catch {
    // Token unreadable — nothing to revoke.
  }
}

/** Revoke every session for a user (password change / "log out all devices"). */
export async function revokeAllSessions(userId: string): Promise<void> {
  await execute('UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
}

export async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME_EXPORT)?.value;
  if (!token) return null;
  const user = await verifySession(token);
  if (!user) return null;
  await ensureUserRow(user);
  return user;
}

/**
 * Decode the CURRENT request's session jti without a DB round-trip.
 * Used by the Devices page to flag "this device" and by the revoke route to
 * detect when a user revokes their own active session (audit 2.6 / Part 3).
 */
export async function getSessionJti(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME_EXPORT)?.value;
  if (!token) return null;
  for (const secret of getVerifySecrets()) {
    try {
      const { payload } = await jwtVerify(token, secret);
      return (payload.jti as string) ?? null;
    } catch {
      // try next key
    }
  }
  return null;
}

/**
 * Sentinel password hash used for user rows healed from a session.
 * It can never match a real login — see ensureUserRow().
 */
export const SENTINEL_PASSWORD_HASH = '!healed-session-no-password!';

/**
 * Ensure the session user has a row in the users table.
 *
 * After the SQLite → Postgres migration, sessions created under the old
 * SQLite DB still verify (the JWT is self-contained and signed) but reference
 * a user_id that has no matching row in Postgres, causing FK violations on
 * writes (e.g. subjects_user_id_fkey). This heals the row so writes succeed.
 *
 * Note: a healed row gets a sentinel password hash, so password login won't
 * work for it — the user should sign up again if their session expires.
 */
async function ensureUserRow(user: SessionUser): Promise<void> {
  // Atomic upsert: no-op when the row already exists, so no SELECT or race
  // window. Best-effort — execute() swallows errors (e.g. email collision
  // with a different Postgres user), and the FK error will surface loudly
  // on the write that depends on this row.
  await execute(
    'INSERT INTO users (id, email, name, password_hash, created_at) VALUES ($1, $2, $3, $4, NOW()) ON CONFLICT (id) DO NOTHING',
    [user.id, user.email, user.name ?? null, SENTINEL_PASSWORD_HASH]
  );
}

// Argon2id with OWASP-recommended parameters (memory 19 MiB, 2 iterations).
const ARGON2_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

/**
 * Hash a password with Argon2id. Output is a PHC-format string
 * (e.g. $argon2id$v=19$m=19456,t=2,p=1$...) with a random salt —
 * two hashes of the same password are never equal.
 */
export async function hashPassword(password: string): Promise<string> {
  return argon2Hash(password, ARGON2_OPTIONS);
}

/**
 * Legacy pre-argon2 hashes were SHA-256 hex digests (64 lowercase hex chars)
 * of `password + 'catalyst-salt-v2'`. Detect them so existing accounts
 * still log in and can be upgraded to argon2 in place.
 */
function isLegacySha256Hash(storedHash: string): boolean {
  return /^[0-9a-f]{64}$/.test(storedHash);
}

async function verifyLegacySha256(password: string, storedHash: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + 'catalyst-salt-v2');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hex === storedHash;
}

/**
 * Verify a password against a stored hash. Handles both argon2 PHC hashes
 * and legacy SHA-256 hashes (returns true for a match, so login works).
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (isLegacySha256Hash(storedHash)) {
    return verifyLegacySha256(password, storedHash);
  }
  try {
    return await argon2Verify(storedHash, password);
  } catch {
    // Malformed/unknown hash format (e.g. the sentinel) — never authenticates.
    return false;
  }
}

/**
 * Upgrade a legacy SHA-256 hash to argon2 in place. Call after a successful
 * legacy verification so the account moves to the strong hash on next login.
 */
export async function migrateLegacyPasswordHash(userId: string, password: string, currentHash: string): Promise<void> {
  if (!isLegacySha256Hash(currentHash)) return;
  const newHash = await hashPassword(password);
  await execute('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, userId]);
}

export async function createUser(email: string, password: string, name: string) {
  await ensureSchema();
  const id = generateId();
  const normalizedEmail = email.trim().toLowerCase();
  const password_hash = await hashPassword(password);

  try {
    // executeStrict so a unique-violation on email actually throws and is
    // caught below — the error-swallowing execute() would silently "succeed".
    await executeStrict(
      "INSERT INTO users (id, email, name, password_hash, created_at) VALUES ($1, $2, $3, $4, NOW())",
      [id, normalizedEmail, name || null, password_hash]
    );
    return { id, email: normalizedEmail, name: name || null };
  } catch (err) {
    console.error('createUser error:', err);
    return null; // email already exists or other error
  }
}

export async function findUserByEmail(email: string): Promise<any> {
  await ensureSchema();
  // Case-insensitive lookup (emails are stored lowercase for new signups;
  // this also covers accounts created before normalization).
  return queryOne('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email]);
}