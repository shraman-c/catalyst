import { queryOne, execute } from './db';

/**
 * In-memory sliding-window rate limiter.
 *
 * NOTE (audit 1.3): an in-memory limiter is correct for a single Node
 * instance (local dev / one Node process). On serverless (e.g. Vercel)
 * it must be swapped for a shared store — see the "swap path" note in
 * progress.md (Upstash Ratelimit + Redis, or Vercel's built-in limits).
 *
 * Buckets are pruned opportunistically so the map can't grow unbounded.
 */

const WINDOW_MS = 60_000; // 1-minute window
const MAX_BUCKETS = 10_000;
const buckets = new Map<string, number[]>();

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

function pruneExpired(now: number): void {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [key, times] of buckets) {
    const live = times.filter((t) => now - t < WINDOW_MS);
    if (live.length === 0) buckets.delete(key);
    else buckets.set(key, live);
  }
}

/**
 * Check a sliding-window limit for `key`. Records the hit when allowed.
 * Returns retryAfterSeconds (seconds until the window opens) when blocked.
 */
export function checkRateLimit(key: string, limit: number, windowMs: number = WINDOW_MS): RateLimitResult {
  const now = Date.now();
  pruneExpired(now);

  const times = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (times.length >= limit) {
    const oldest = times[0];
    buckets.set(key, times);
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) };
  }

  times.push(now);
  buckets.set(key, times);
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Best-effort IP extraction from the request (proxy-aware). */
export function clientIp(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

// ---------------------------------------------------------------------------
// Account lockout — DB-backed (works across instances).
// Uses `users.failed_attempts` / `users.locked_until` columns (schema in db.ts).
// Exponential backoff: 5m, 10m, 20m, 40m, ... capped at 24h.
// ---------------------------------------------------------------------------

export const LOCKOUT_THRESHOLD = 5;
const BACKOFF_BASE_MINUTES = 5;
const BACKOFF_CAP_MINUTES = 24 * 60;

export async function registerFailedAttempt(userId: string): Promise<void> {
  await execute('UPDATE users SET failed_attempts = failed_attempts + 1 WHERE id = $1', [userId]);
  const row = await queryOne<{ failed_attempts: number }>(
    'SELECT failed_attempts FROM users WHERE id = $1',
    [userId]
  );
  const n = row?.failed_attempts ?? 1;
  if (n >= LOCKOUT_THRESHOLD) {
    const exponent = n - LOCKOUT_THRESHOLD;
    const minutes = Math.min(BACKOFF_BASE_MINUTES * Math.pow(2, exponent), BACKOFF_CAP_MINUTES);
    await execute(
      "UPDATE users SET locked_until = NOW() + ($1 * INTERVAL '1 minute') WHERE id = $2",
      [Math.round(minutes), userId]
    );
  }
}

export async function resetFailedAttempts(userId: string): Promise<void> {
  await execute('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1', [userId]);
}

