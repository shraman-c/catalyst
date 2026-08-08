import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
// Argon2id (prebuilt native binary, @node-rs/argon2) — kept external to
// webpack via serverExternalPackages in next.config.js.
import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';
import { queryOne, execute, generateId, initializeSchema } from './db';
import type { SessionUser } from './types';

const secretStr = process.env.NEXTAUTH_SECRET;
if (!secretStr) {
  throw new Error(
    'NEXTAUTH_SECRET environment variable is required. ' +
    'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))" ' +
    'and add it to .env.local'
  );
}
const SECRET = new TextEncoder().encode(secretStr);

export const COOKIE_NAME_EXPORT = 'synthesizer_session';

// Use a global flag so HMR doesn't reset the flag mid-request,
// but a real server restart (new process) always runs migrations.
declare global {
  // eslint-disable-next-line no-var
  var __catalystSchemaInit: boolean | undefined;
}

export async function ensureSchema() {
  if (global.__catalystSchemaInit) return;
  await initializeSchema();
  global.__catalystSchemaInit = true;
}

export async function createSession(user: SessionUser): Promise<string> {
  const token = await new SignJWT({ user })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(SECRET);
  return token;
}

export async function verifySession(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return payload.user as SessionUser;
  } catch {
    return null;
  }
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
 * of `password + 'synthesizer-salt-v2'`. Detect them so existing accounts
 * still log in and can be upgraded to argon2 in place.
 */
function isLegacySha256Hash(storedHash: string): boolean {
  return /^[0-9a-f]{64}$/.test(storedHash);
}

async function verifyLegacySha256(password: string, storedHash: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + 'synthesizer-salt-v2');
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
  const password_hash = await hashPassword(password);

  try {
    await execute(
      "INSERT INTO users (id, email, name, password_hash, created_at) VALUES ($1, $2, $3, $4, NOW())",
      [id, email, name || null, password_hash]
    );
    return { id, email, name: name || null };
  } catch (err) {
    console.error('createUser error:', err);
    return null; // email already exists or other error
  }
}

export async function findUserByEmail(email: string): Promise<any> {
  await ensureSchema();
  return queryOne('SELECT * FROM users WHERE email = $1', [email]);
}