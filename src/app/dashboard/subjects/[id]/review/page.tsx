'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

interface Flashcard {
  id: string;
  front: string;
  back: string;
  card_type: string;
  status: string;
  note_file_id?: string;
  next_review_at: string | null;
  interval: number;
  ease_factor: number;
  review_count: number;
}

type Rating = 'again' | 'hard' | 'good' | 'easy';

export default function ReviewPage() {
  const params = useParams();
  const router = useRouter();
  const subjectId = params.id as string;

  const [cards, setCards] = useState<Flashcard[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [sessionComplete, setSessionComplete] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [subjectName, setSubjectName] = useState('');
  const [rating, setRating] = useState<string | null>(null);
  // Inline edit state
  const [editingCard, setEditingCard] = useState<Flashcard | null>(null);
  const [editFront, setEditFront] = useState('');
  const [editBack, setEditBack] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const fetchCards = useCallback(async () => {
    const [cardsRes, subjectRes] = await Promise.all([
      fetch(`/api/cards/${subjectId}?mode=due`),
      fetch(`/api/subjects/${subjectId}`),
    ]);

    if (cardsRes.status === 401) { router.push('/'); return; }

    if (cardsRes.ok) {
      const data = await cardsRes.json();
      setCards(data.cards);
    }
    if (subjectRes.ok) {
      const data = await subjectRes.json();
      setSubjectName(data.subject.name);
    }
    setLoading(false);
  }, [subjectId, router]);

  useEffect(() => { fetchCards(); }, [fetchCards]);

  const currentCard = cards[currentIndex];
  const totalCards = cards.length;
  const progress = totalCards > 0 ? Math.round((reviewed / totalCards) * 100) : 0;

  async function handleRate(r: Rating) {
    if (!currentCard) return;
    setRating(r);

    await fetch(`/api/cards/${subjectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'review', card_id: currentCard.id, rating: r }),
    });

    // Advance after a brief moment
    setTimeout(() => {
      setReviewed((prev) => prev + 1);
      setRating(null);
      setRevealed(false);

      if (currentIndex + 1 >= cards.length) {
        setSessionComplete(true);
      } else {
        setCurrentIndex((prev) => prev + 1);
      }
    }, 300);
  }

  return (
    <div className="page-container" style={{ maxWidth: '800px', margin: '0 auto' }}>

      {/* Breadcrumb */}
      <div className="breadcrumb">
        <Link href="/dashboard" className="text-mono" style={{ opacity: 0.6, textDecoration: 'none' }}>DASHBOARD</Link>
        <span className="text-mono" style={{ opacity: 0.4 }}>›</span>
        <Link href={`/dashboard/subjects/${subjectId}`} className="text-mono" style={{ opacity: 0.6, textDecoration: 'none' }}>
          {subjectName.toUpperCase() || '...'}
        </Link>
        <span className="text-mono" style={{ opacity: 0.4 }}>›</span>
        <span className="text-mono">REVIEW</span>
      </div>

      {loading ? (
        <div className="processing-block">LOADING CARDS...</div>
      ) : cards.length === 0 ? (
        <NothingDue subjectId={subjectId} />
      ) : sessionComplete ? (
        <SessionSummary reviewed={reviewed} subjectId={subjectId} subjectName={subjectName} />
      ) : currentCard ? (
        <>
          {/* Progress bar */}
          <div style={{ marginBottom: '20px' }}>
            <div className="flex justify-between items-center" style={{ marginBottom: '6px' }}>
              <span className="text-mono" style={{ opacity: 0.6 }}>
                {reviewed + 1} OF {totalCards}
              </span>
              <span className="mono-tag">{progress}% DONE</span>
            </div>
            {/* Progress track — simple bordered block fill */}
            <div style={{ height: '8px', border: '2px solid var(--ink)', backgroundColor: 'var(--surface)' }}>
              <div style={{
                height: '100%',
                width: `${progress}%`,
                backgroundColor: 'var(--ink)',
                transition: 'width 0.15s',
              }} />
            </div>
          </div>

          {/* Card type tag */}
          <div className="flex gap-2 items-center" style={{ marginBottom: '12px' }}>
            <span className="mono-tag">{currentCard.card_type === 'cloze' ? 'FILL IN THE BLANK' : 'QUESTION & ANSWER'}</span>
            {currentCard.status === 'new' && <span className="mono-tag mono-tag-signal">NEW</span>}
            {currentCard.review_count > 0 && (
              <span className="mono-tag">INTERVAL: {currentCard.interval}D</span>
            )}
          </div>

          {/* Flashcard (design.md §4.3) */}
          <div className="flashcard" id="flashcard-front" style={{
            borderColor: rating === 'again' ? 'var(--alert)' :
                         rating === 'hard' ? 'var(--signal)' :
                         rating === 'good' || rating === 'easy' ? 'var(--link)' :
                         'var(--ink)',
          }}>
            {/* Front */}
            <div style={{ marginBottom: revealed ? '24px' : 0 }}>
              <div className="mono-tag" style={{ marginBottom: '12px' }}>FRONT</div>
              <p className="text-body" style={{ fontSize: '18px', lineHeight: 1.5 }}>
                {currentCard.front}
              </p>
            </div>

            {/* Answer reveal */}
            {revealed ? (
              <>
                <div className="divider-ink" style={{ margin: '0 -40px 24px' }} />
                <div>
                  <div className="mono-tag" style={{ marginBottom: '12px' }}>ANSWER</div>
                  <p className="text-body" style={{ fontSize: '18px', lineHeight: 1.5 }}>
                    {currentCard.back}
                  </p>
                </div>
              </>
            ) : (
              <button
                className="btn btn-secondary"
                onClick={() => setRevealed(true)}
                id="reveal-btn"
                style={{ alignSelf: 'flex-start', marginTop: '24px' }}
              >
                REVEAL ANSWER
              </button>
            )}
          </div>

          {/* Rating buttons — responsive row, wraps to 2x2 on mobile */}
          {revealed && (
            <div className="rating-row" style={{ marginTop: '16px' }}>
              {[
                { label: 'AGAIN', key: 'again', cls: 'btn-rating-again' },
                { label: 'HARD', key: 'hard', cls: 'btn-rating-hard' },
                { label: 'GOOD', key: 'good', cls: 'btn-rating-good' },
                { label: 'EASY', key: 'easy', cls: 'btn-rating-easy' },
              ].map(({ label, key, cls }) => (
                <button
                  key={key}
                  className={`btn ${cls}`}
                  onClick={() => handleRate(key as Rating)}
                  disabled={!!rating}
                  id={`rate-${key}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* Card actions */}
          <div className="flex gap-2" style={{ marginTop: '12px' }}>
            <button
              className="btn btn-ghost"
              style={{ fontSize: '12px' }}
              onClick={() => {
                setEditingCard(currentCard);
                setEditFront(currentCard.front);
                setEditBack(currentCard.back);
              }}
              id="edit-card-btn"
            >
              EDIT CARD
            </button>
            <button
              className="btn btn-ghost"
              style={{ fontSize: '12px' }}
              onClick={async () => {
                await fetch(`/api/cards/${subjectId}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'delete', card_id: currentCard.id }),
                });
                setCards((prev) => prev.filter((c) => c.id !== currentCard.id));
                setRevealed(false);
                if (currentIndex >= cards.length - 1) setSessionComplete(true);
              }}
              id="delete-card-btn"
            >
              DELETE CARD
            </button>
          </div>
        </>
      ) : null}

      {/* Inline edit modal */}
      {editingCard && (
        <div
          style={{
            position: 'fixed', inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 999,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setEditingCard(null); }}
        >
          <div className="bento-tile shadow-hard-lg" style={{ width: '560px', maxWidth: '92vw', padding: '28px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 className="text-display-md">EDIT CARD</h2>
              <button className="btn btn-ghost" onClick={() => setEditingCard(null)} style={{ fontSize: '18px', padding: '4px 8px' }}>✕</button>
            </div>
            <div style={{ marginBottom: '12px' }}>
              <div className="mono-tag" style={{ marginBottom: '6px' }}>FRONT</div>
              <textarea
                className="textarea-ink"
                value={editFront}
                onChange={(e) => setEditFront(e.target.value)}
                style={{ minHeight: '80px', fontSize: '14px' }}
                id="review-edit-front"
              />
            </div>
            <div style={{ marginBottom: '20px' }}>
              <div className="mono-tag" style={{ marginBottom: '6px' }}>BACK</div>
              <textarea
                className="textarea-ink"
                value={editBack}
                onChange={(e) => setEditBack(e.target.value)}
                style={{ minHeight: '80px', fontSize: '14px' }}
                id="review-edit-back"
              />
            </div>
            <div className="flex gap-2">
              <button
                className="btn btn-primary"
                disabled={savingEdit}
                onClick={async () => {
                  if (!editingCard) return;
                  setSavingEdit(true);
                  await fetch(`/api/cards/${subjectId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'edit', card_id: editingCard.id, front: editFront, back: editBack }),
                  });
                  // Update card in local state
                  setCards(prev => prev.map(c => c.id === editingCard.id ? { ...c, front: editFront, back: editBack } : c));
                  setSavingEdit(false);
                  setEditingCard(null);
                }}
                id="save-card-edit-btn"
              >
                {savingEdit ? 'SAVING...' : 'SAVE'}
              </button>
              <button className="btn btn-ghost" onClick={() => setEditingCard(null)}>CANCEL</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NothingDue({ subjectId }: { subjectId: string }) {
  return (
    <div className="empty-state">
      <p className="empty-state__text" style={{ marginBottom: '16px' }}>NOTHING DUE. CHECK BACK LATER.</p>
      <p className="text-body-sm" style={{ opacity: 0.7, marginBottom: '24px' }}>
        All caught up! New cards will appear when their review interval is up.
      </p>
      <Link href={`/dashboard/subjects/${subjectId}`} className="btn btn-secondary" style={{ textDecoration: 'none' }}>
        BACK TO SUBJECT
      </Link>
    </div>
  );
}

function SessionSummary({ reviewed, subjectId, subjectName }: { reviewed: number; subjectId: string; subjectName: string }) {
  return (
    <div className="bento-tile shadow-hard-lg" style={{ textAlign: 'center', padding: '48px 40px' }}>
      <div className="stat-block" style={{ alignItems: 'center', marginBottom: '20px' }}>
        <span className="stat-block__number">{reviewed}</span>
        <span className="stat-block__label">CARDS REVIEWED</span>
      </div>
      <p className="text-body-sm" style={{ opacity: 0.7, marginBottom: '28px' }}>
        SESSION COMPLETE. YOUR SCHEDULE HAS BEEN UPDATED.
      </p>
      <div className="flex gap-3 justify-center">
        <Link href={`/dashboard/subjects/${subjectId}`} className="btn btn-secondary" style={{ textDecoration: 'none' }}>
          BACK TO {subjectName.toUpperCase()}
        </Link>
        <Link href="/dashboard" className="btn btn-primary" style={{ textDecoration: 'none' }}>
          DASHBOARD
        </Link>
      </div>
    </div>
  );
}
