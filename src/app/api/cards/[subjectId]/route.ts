import { NextRequest, NextResponse } from 'next/server';
import { getSession, ensureSchema } from '@/lib/auth';
import { queryAll, queryOne, execute, generateId } from '@/lib/db';
import { deleteEmbedding, cardsNamespace } from '@/lib/ai/vector';
import type { Flashcard, Subject } from '@/lib/types';

export async function GET(
  request: NextRequest,
  { params }: { params: { subjectId: string } }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureSchema();

  const subject = await queryOne<Subject>(
    'SELECT * FROM subjects WHERE id = ? AND user_id = ?',
    [params.subjectId, session.id]
  );
  if (!subject) return NextResponse.json({ error: 'Subject not found' }, { status: 404 });

  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode') || 'all';

  // Get user's card density preference (default 20 new cards/day)
  const prefs = await queryOne<{ card_density: number }>(
    'SELECT card_density FROM user_preferences WHERE user_id = ?',
    [session.id]
  );
  const dailyCap = prefs?.card_density ?? 20;

  let sql = "SELECT * FROM flashcards WHERE subject_id = ? AND status != 'deleted'";
  const args: any[] = [params.subjectId];

  if (mode === 'due') {
    // Due = already-reviewed cards whose interval has elapsed
    sql += " AND status != 'new' AND (next_review_at IS NULL OR next_review_at <= NOW())";
    sql += ' ORDER BY CASE WHEN next_review_at IS NULL THEN 0 ELSE 1 END, next_review_at ASC LIMIT 200';
    const dueCards = await queryAll<Flashcard>(sql, args);

    // How many new cards were already reviewed today?
    const today = new Date().toISOString().slice(0, 10);
    const newReviewedToday = await queryOne<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM review_history
       WHERE user_id = ? AND reviewed_at >= ? AND card_id IN (
         SELECT id FROM flashcards WHERE subject_id = ? AND status = 'accepted' AND review_count = 1
       )`,
      [session.id, today, params.subjectId]
    );
    const alreadyIntroducedToday = newReviewedToday?.cnt ?? 0;
    const newCardSlots = Math.max(0, dailyCap - alreadyIntroducedToday);

    // New cards (never reviewed) — limited by daily cap
    const newCards = await queryAll<Flashcard>(
      `SELECT * FROM flashcards WHERE subject_id = ? AND status = 'new'
       ORDER BY created_at ASC LIMIT ?`,
      [params.subjectId, newCardSlots]
    );

    return NextResponse.json({ cards: [...newCards, ...dueCards], daily_cap: dailyCap });
  } else if (mode === 'new') {
    sql += " AND status = 'new'";
    sql += ' ORDER BY created_at ASC LIMIT 200';
  } else if (mode === 'deleted') {
    sql = "SELECT * FROM flashcards WHERE subject_id = ? AND status = 'deleted' ORDER BY updated_at DESC LIMIT 200";
  } else {
    sql += " ORDER BY CASE WHEN status = 'new' THEN 0 ELSE 1 END, next_review_at ASC, created_at DESC LIMIT 200";
  }

  const cards = await queryAll<Flashcard>(sql, args);
  return NextResponse.json({ cards, daily_cap: dailyCap });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { subjectId: string } }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureSchema();

  const subject = await queryOne<Subject>(
    'SELECT * FROM subjects WHERE id = ? AND user_id = ?',
    [params.subjectId, session.id]
  );
  if (!subject) return NextResponse.json({ error: 'Subject not found' }, { status: 404 });

  const { action, card_id, front, back, rating } = await request.json();

  if (action === 'edit') {
    await execute(
      "UPDATE flashcards SET front = ?, back = ?, status = 'edited', updated_at = NOW() WHERE id = ? AND subject_id = ?",
      [front, back, card_id, params.subjectId]
    );
  }

  if (action === 'accept') {
    if (card_id) {
      // Accept a single card
      await execute(
        "UPDATE flashcards SET status = 'accepted', updated_at = NOW() WHERE id = ? AND subject_id = ? AND status = 'new'",
        [card_id, params.subjectId]
      );
    } else {
      // Bulk accept all new cards for this subject
      await execute(
        "UPDATE flashcards SET status = 'accepted', updated_at = NOW() WHERE subject_id = ? AND status = 'new'",
        [params.subjectId]
      );
    }
  }

  if (action === 'delete') {
    await execute(
      "UPDATE flashcards SET status = 'deleted', updated_at = NOW() WHERE id = ? AND subject_id = ?",
      [card_id, params.subjectId]
    );
    // Remove the card's embedding so it can't suppress future (legitimately new) cards in dedup
    await deleteEmbedding(cardsNamespace(params.subjectId), card_id);
  }

  if (action === 'review') {
    const card = await queryOne<Flashcard>(
      'SELECT * FROM flashcards WHERE id = ? AND subject_id = ?',
      [card_id, params.subjectId]
    );
    if (!card) return NextResponse.json({ error: 'Card not found' }, { status: 404 });

    const { newInterval, newEaseFactor } = calculateSM2(
      rating,
      card.interval,
      card.ease_factor,
      card.review_count
    );

    const nextReviewDate = new Date();
    nextReviewDate.setDate(nextReviewDate.getDate() + newInterval);

    await execute(
      `UPDATE flashcards SET
        status = CASE WHEN status = 'new' THEN 'accepted' ELSE status END,
        next_review_at = ?,
        interval = ?,
        ease_factor = ?,
        review_count = review_count + 1,
        updated_at = NOW()
       WHERE id = ? AND subject_id = ?`,
      [nextReviewDate.toISOString(), newInterval, newEaseFactor, card_id, params.subjectId]
    );

    const historyId = generateId();
    await execute(
      "INSERT INTO review_history (id, card_id, user_id, rating, reviewed_at, next_review_at, interval, ease_factor) VALUES (?, ?, ?, ?, NOW(), ?, ?, ?)",
      [historyId, card_id, session.id, rating, nextReviewDate.toISOString(), newInterval, newEaseFactor]
    );
  }

  return NextResponse.json({ success: true });
}

function calculateSM2(
  rating: 'again' | 'hard' | 'good' | 'easy',
  currentInterval: number,
  currentEaseFactor: number,
  reviewCount: number
): { newInterval: number; newEaseFactor: number } {
  const qualityMap = { again: 0, hard: 2, good: 4, easy: 5 };
  const q = qualityMap[rating];

  let newEaseFactor = currentEaseFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  newEaseFactor = Math.max(1.3, newEaseFactor);

  let newInterval: number;
  if (q < 3) {
    newInterval = 1;
  } else if (reviewCount === 0) {
    newInterval = 1;
  } else if (reviewCount === 1) {
    newInterval = 6;
  } else {
    newInterval = Math.round(currentInterval * newEaseFactor);
  }

  return { newInterval, newEaseFactor };
}
