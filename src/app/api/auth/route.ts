import { NextRequest, NextResponse } from 'next/server';
import { createUser, findUserByEmail, verifyPassword, migrateLegacyPasswordHash, createSession, COOKIE_NAME_EXPORT, SENTINEL_PASSWORD_HASH } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const { action, email, password, name } = await request.json();

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
  }

  if (action === 'signup') {
    const user = await createUser(email, password, name || '');
    if (!user) {
      return NextResponse.json({ error: 'Email already registered. Try logging in instead.' }, { status: 409 });
    }

    const token = await createSession(user);
    const response = NextResponse.json({ success: true, user });
    response.cookies.set(COOKIE_NAME_EXPORT, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
      path: '/',
    });
    return response;
  }

  if (action === 'login') {
    const dbUser = await findUserByEmail(email);
    // A row healed from a legacy (SQLite-era) session has a sentinel hash and
    // no known password. Tell the user instead of a confusing 401.
    if (dbUser && dbUser.password_hash === SENTINEL_PASSWORD_HASH) {
      return NextResponse.json(
        { error: 'This account was created before the database migration and has no password. Please sign up with a new email, or clear your browser cookies if you had an active session.' },
        { status: 401 }
      );
    }
    if (!dbUser) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }
    const valid = await verifyPassword(password, dbUser.password_hash);
    if (!valid) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }
    // Legacy SHA-256 accounts upgrade to argon2 on their next successful login.
    await migrateLegacyPasswordHash(dbUser.id, password, dbUser.password_hash);

    const user = { id: dbUser.id as string, email: dbUser.email as string, name: dbUser.name as string | null };
    const token = await createSession(user);
    const response = NextResponse.json({ success: true, user });
    response.cookies.set(COOKIE_NAME_EXPORT, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
      path: '/',
    });
    return response;
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.delete(COOKIE_NAME_EXPORT);
  return response;
}
