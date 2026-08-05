import { NextRequest, NextResponse } from 'next/server';
import { createUser, findUserByEmail, hashPassword, createSession, COOKIE_NAME_EXPORT } from '@/lib/auth';

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
    if (!dbUser || dbUser.password_hash !== hashPassword(password)) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

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
