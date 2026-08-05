import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
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
  return verifySession(token);
}

/**
 * Hash a password using SHA-256. Returns a hex-encoded hash.
 * This is a significant improvement over the previous DJB2 hash but for
 * production use, consider migrating to bcrypt or argon2.
 */
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + 'synthesizer-salt-v2');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
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