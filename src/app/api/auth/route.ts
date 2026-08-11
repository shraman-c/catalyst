import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession, createUser, findUserByEmail, verifyPassword, migrateLegacyPasswordHash, createSession, revokeSession, revokeAllSessions, COOKIE_NAME_EXPORT, SENTINEL_PASSWORD_HASH } from '@/lib/auth';
import { checkRateLimit, clientIp, registerFailedAttempt, resetFailedAttempts } from '@/lib/rate-limit';
import { parseBody, authBodySchema } from '@/lib/validation';
import { parseDeviceLabel } from '@/lib/devices';

// Rate limits (audit 1.3): sliding window per IP and per email.
const LOGIN_IP_LIMIT = 10; // 10 login attempts/min per IP
const LOGIN_EMAIL_LIMIT = 5; // 5 login attempts/min per email (targeted attacks)
const SIGNUP_IP_LIMIT = 5; // 5 signups/min per IP

export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  // Part 3: record which browser/device this session belongs to, so it shows
  // up in the unified Devices list ("Chrome on Android", etc.).
  const deviceLabel = parseDeviceLabel(request.headers.get('user-agent'));

  // ---- Rate limiting BEFORE touching the DB (audit 1.3) ----
  const actionGuess = await parseAction(request);
  if (actionGuess === 'signup') {
    const rl = checkRateLimit(`signup:${ip}`, SIGNUP_IP_LIMIT);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many signup attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
      );
    }
  } else if (actionGuess === 'login') {
    const rlIp = checkRateLimit(`login:${ip}`, LOGIN_IP_LIMIT);
    if (!rlIp.allowed) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(rlIp.retryAfterSeconds) } }
      );
    }
  }

  const body = await request.json().catch(() => null);
  const parsed = parseBody(authBodySchema, body);
  if (!parsed.ok) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const { action } = parsed.data;

  // Email-scoped login rate limit (targeted brute force).
  if (action === 'login') {
    const { email } = parsed.data;
    const rlEmail = checkRateLimit(`login-email:${email}`, LOGIN_EMAIL_LIMIT);
    if (!rlEmail.allowed) {
      return NextResponse.json(
        { error: 'Too many login attempts for this account. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(rlEmail.retryAfterSeconds) } }
      );
    }
  }

  // ---- Cookie options: always persistent. 30 days with "Remember Me", 1 day
  // without. A bare session cookie dies with the browser (and on some mobile
  // browsers when tabs close), silently dropping the login — so Max-Age is
  // always set. The server-side `sessions` row is still the source of truth
  // (revocation/expiry enforced by verifySession), so a shorter cookie TTL
  // only shortens how long the browser keeps it. ----
  const cookieOptions: Record<string, any> = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
  };
  if (action === 'login' || action === 'signup') {
    cookieOptions.maxAge =
      parsed.data.remember === false
        ? 60 * 60 * 24 // 1 day — "don't remember me" still survives tab/browser closes
        : 60 * 60 * 24 * 30; // 30 days (matches SESSION_DAYS in lib/auth.ts)
  }

  if (action === 'logout_all') {
    const session = await getSession();
    if (session) {
      await revokeAllSessions(session.id);
    }
    const response = NextResponse.json({ success: true });
    response.cookies.delete(COOKIE_NAME_EXPORT);
    return response;
  }

  if (action === 'signup') {
    const { email, password, name } = parsed.data;

    // Duplicate-email pre-check (audit 7.4): the DB layer swallows unique-
    // violation errors, so rely on an explicit check, not the INSERT result.
    // Both this path and the generic failure path return the SAME generic 409
    // so the response never confirms whether the account exists.
    const existing = await findUserByEmail(email);
    if (existing) {
      return NextResponse.json(
        { error: 'Signup could not be completed. Please try again or log in if you already have an account.' },
        { status: 409 }
      );
    }

    // Server-side password validation (audit 1.2) — enforced at the API layer,
    // not just the client form. 1-char raw POSTs are rejected with a 400.
    const user = await createUser(email, password, name || '');
    if (!user) {
      // Generic message (audit 7.4) — does not confirm whether the email exists.
      return NextResponse.json(
        { error: 'Signup could not be completed. Please try again or log in if you already have an account.' },
        { status: 409 }
      );
    }

    const token = await createSession(user, { device_label: deviceLabel, ip_address: ip });
    const response = NextResponse.json({ success: true, user });
    response.cookies.set(COOKIE_NAME_EXPORT, token, cookieOptions);
    return response;
  }

  if (action === 'login') {
    const { email, password } = parsed.data;
    const dbUser = await findUserByEmail(email);

    // Account lockout (audit 1.8): check lock BEFORE verifying. locked_until
    // is already on the row fetched above — computing it here avoids an extra
    // round-trip on every login.
    if (dbUser) {
      const remaining = dbUser.locked_until
        ? Math.max(0, Math.ceil((new Date(dbUser.locked_until).getTime() - Date.now()) / 1000))
        : 0;
      if (remaining > 0) {
        return NextResponse.json(
          { error: 'Account temporarily locked due to too many failed attempts. Try again later.' },
          { status: 423, headers: { 'Retry-After': String(remaining) } }
        );
      }
    }

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
      // Register the failure for lockout backoff (audit 1.8).
      await registerFailedAttempt(dbUser.id);
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }
    // Success — clear the failure counter, but only when there were failures
    // (the row from findUserByEmail already carries the current count).
    if (Number(dbUser.failed_attempts) > 0) {
      await resetFailedAttempts(dbUser.id);
    }
    // Legacy SHA-256 accounts upgrade to argon2 on their next successful login.
    await migrateLegacyPasswordHash(dbUser.id, password, dbUser.password_hash);

    const user = { id: dbUser.id as string, email: dbUser.email as string, name: dbUser.name as string | null };
    const token = await createSession(user, { device_label: deviceLabel, ip_address: ip });
    const response = NextResponse.json({ success: true, user });
    response.cookies.set(COOKIE_NAME_EXPORT, token, cookieOptions);
    return response;
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}

/** Lightweight action peek for the rate-limit pre-check (never throws). */
async function parseAction(request: NextRequest): Promise<string | null> {
  try {
    const body = await request.clone().json();
    return typeof body?.action === 'string' ? body.action : null;
  } catch {
    return null;
  }
}

export async function DELETE() {
  // Revoke the session server-side (audit 1.6) — not just clear the cookie.
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME_EXPORT)?.value;
  if (token) await revokeSession(token);

  const response = NextResponse.json({ success: true });
  response.cookies.delete(COOKIE_NAME_EXPORT);
  return response;
}
