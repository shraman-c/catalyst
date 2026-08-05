import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { queryOne, execute, generateId, initializeSchema } from './db';
import type { SessionUser } from './types';

const SECRET = new TextEncoder().encode(
  process.env.NEXTAUTH_SECRET || 'synthesizer-dev-secret-change-in-prod-32chars'
);

export const COOKIE_NAME_EXPORT = 'synthesizer_session';

// Use a global symbol so HMR doesn't reset the flag mid-request,
// but a real server restart (new process) always runs migrations.
const SCHEMA_KEY = Symbol.for('synthesizer_schema_v3');
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

export function hashPassword(password: string): string {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + 'synthesizer-salt');
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data[i];
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36) + data.length.toString(36);
}

export async function createUser(email: string, password: string, name: string) {
  await ensureSchema();
  const id = generateId();
  const password_hash = hashPassword(password);

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