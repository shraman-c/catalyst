/**
 * Shared review-scheduling helpers.
 *
 * These mirror the exact logic of GET /api/cards/[subjectId]?mode=due so the
 * "cards due" counts shown on the dashboard / subject pages always match what
 * the review queue actually returns. Keeping the cap logic in one place (here)
 * prevents the two from drifting apart again.
 */
import { queryOne } from './db';

const DEFAULT_DAILY_CAP = 20;
// Matches the review queue's hard cap on overdue cards per request.
const DUE_QUEUE_LIMIT = 200;

/** User's new-cards-per-day preference (default 20). */
export async function getDailyCap(userId: string): Promise<number> {
  const prefs = await queryOne<{ card_density: number }>(
    'SELECT card_density FROM user_preferences WHERE user_id = ?',
    [userId]
  );
  return Number(prefs?.card_density ?? DEFAULT_DAILY_CAP);
}

/**
 * How many new cards were already introduced (first-reviewed) today for this
 * subject. Mirrors the review route's accounting of the daily-cap allowance.
 */
export async function countNewIntroducedToday(userId: string, subjectId: string): Promise<number> {
  // "Start of today" computed in the DB so it always agrees with the other
  // NOW() comparisons in this app, regardless of the database session timezone.
  const row = await queryOne<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM review_history
     WHERE user_id = ? AND reviewed_at >= date_trunc('day', NOW()) AND card_id IN (
       SELECT id FROM flashcards WHERE subject_id = ? AND status = 'accepted' AND review_count = 1
     )`,
    [userId, subjectId]
  );
  // COUNT(*) comes back as a string from Postgres (bigint) — coerce to a
  // number so callers can do arithmetic instead of string concatenation.
  return Number(row?.cnt ?? 0);
}

/**
 * Number of cards the review queue would return for this subject right now:
 * overdue already-reviewed cards (capped at DUE_QUEUE_LIMIT) plus new cards
 * that fit under today's remaining daily-cap allowance.
 */
export async function getCardsDueCount(subjectId: string, userId: string): Promise<number> {
  const [dueReviewed, newCount, dailyCap, introducedToday] = await Promise.all([
    queryOne<{ c: number }>(
      `SELECT COUNT(*) as c FROM (
         SELECT id FROM flashcards
         WHERE subject_id = ? AND status != 'new' AND status != 'deleted'
           AND (next_review_at IS NULL OR next_review_at <= NOW())
         ORDER BY CASE WHEN next_review_at IS NULL THEN 0 ELSE 1 END, next_review_at ASC
         LIMIT ${DUE_QUEUE_LIMIT}
       ) sub`,
      [subjectId]
    ),
    queryOne<{ c: number }>(
      "SELECT COUNT(*) as c FROM flashcards WHERE subject_id = ? AND status = 'new'",
      [subjectId]
    ),
    getDailyCap(userId),
    countNewIntroducedToday(userId, subjectId),
  ]);

  // COUNT(*) values arrive as strings from Postgres — coerce before adding
  // (otherwise "5" + 20 becomes "520" instead of 25).
  const dueCount = Number(dueReviewed?.c ?? 0);
  const newCountNum = Number(newCount?.c ?? 0);
  const newSlots = Math.max(0, dailyCap - introducedToday);
  return dueCount + Math.min(newCountNum, newSlots);
}
