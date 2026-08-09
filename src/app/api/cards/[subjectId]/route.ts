import { NextRequest, NextResponse } from 'next/server';
import { getSession, ensureSchema } from '@/lib/auth';
import { queryAll, queryOne, execute, generateId } from '@/lib/db';
import { deleteEmbedding, cardsNamespace } from '@/lib/ai/vector';
import { parseBody, cardActionSchema } from '@/lib/validation';
import { getDailyCap, countNewIntroducedToday } from '@/lib/review';
import type { Flashcard, Subject } from '@/lib/types';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ subjectId: string }> }
) {
  const { subjectId } = await params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureSchema();

  const subject = await queryOne<Subject>(
    'SELECT * FROM subjects WHERE id = ? AND user_id = ?',
    [subjectId, session.id]
  );
  if (!subject) return NextResponse.json({ error: 'Subject not found' }, { status: 404 });

  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode') || 'all';

  // Get user's card density preference (default 20 new cards/day)
  const dailyCap = await getDailyCap(session.id);

  let sql = "SELECT * FROM flashcards WHERE subject_id = ? AND status != 'deleted'";
  const args: any[] = [subjectId];

  if (mode === 'due') {
    // Due = already-reviewed cards whose interval has elapsed
    sql += " AND status != 'new' AND (next_review_at IS NULL OR next_review_at <= NOW())";
    sql += ' ORDER BY CASE WHEN next_review_at IS NULL THEN 0 ELSE 1 END, next_review_at ASC LIMIT 200';
    const dueCards = await queryAll<Flashcard>(sql, args);

    // How many new cards were already introduced (first-reviewed) today?
    const alreadyIntroducedToday = await countNewIntroducedToday(session.id, subjectId);
    const newCardSlots = Math.max(0, dailyCap - alreadyIntroducedToday);

    // New cards (never reviewed) — limited by daily cap
    const newCards = await queryAll<Flashcard>(
      `SELECT * FROM flashcards WHERE subject_id = ? AND status = 'new'
       ORDER BY created_at ASC LIMIT ?`,
      [subjectId, newCardSlots]
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
  { params }: { params: Promise<{ subjectId: string }> }
) {
  const { subjectId } = await params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureSchema();

  const subject = await queryOne<Subject>(
    'SELECT * FROM subjects WHERE id = ? AND user_id = ?',
    [subjectId, session.id]
  );
  if (!subject) return NextResponse.json({ error: 'Subject not found' }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = parseBody(cardActionSchema, body);
  if (!parsed.ok) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  const { action } = parsed.data;

  if (action === 'edit') {
    const { card_id, front, back } = parsed.data;
    await execute(
      "UPDATE flashcards SET front = ?, back = ?, status = 'edited', updated_at = NOW() WHERE id = ? AND subject_id = ?",
      [front, back, card_id, subjectId]
    );
  }

  if (action === 'accept') {
    const { card_id } = parsed.data;
    if (card_id) {
      // Accept a single card
      await execute(
        "UPDATE flashcards SET status = 'accepted', updated_at = NOW() WHERE id = ? AND subject_id = ? AND status = 'new'",
        [card_id, subjectId]
      );
    } else {
      // Bulk accept all new cards for this subject
      await execute(
        "UPDATE flashcards SET status = 'accepted', updated_at = NOW() WHERE subject_id = ? AND status = 'new'",
        [subjectId]
      );
    }
  }

  if (action === 'delete') {
    const { card_id } = parsed.data;
    await execute(
      "UPDATE flashcards SET status = 'deleted', updated_at = NOW() WHERE id = ? AND subject_id = ?",
      [card_id, subjectId]
    );
    // Remove the card's embedding so it can't suppress future (legitimately new) cards in dedup
    await deleteEmbedding(cardsNamespace(subjectId), card_id);
  }

  if (action === 'review') {
    const { card_id, rating } = parsed.data;
    const card = await queryOne<Flashcard>(
      'SELECT * FROM flashcards WHERE id = ? AND subject_id = ?',
      [card_id, subjectId]
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
      [nextReviewDate.toISOString(), newInterval, newEaseFactor, card_id, subjectId]
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
