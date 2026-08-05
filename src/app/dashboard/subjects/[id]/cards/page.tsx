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
  next_review_at: string | null;
  interval: number;
  ease_factor: number;
  review_count: number;
  created_at: string;
}

type FilterMode = 'all' | 'new' | 'due' | 'deleted';

export default function CardsPage() {
  const params = useParams();
  const router = useRouter();
  const subjectId = params.id as string;

  const [cards, setCards] = useState<Flashcard[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<FilterMode>('all');
  const [subjectName, setSubjectName] = useState('');
  const [editingCard, setEditingCard] = useState<Flashcard | null>(null);
  const [editFront, setEditFront] = useState('');
  const [editBack, setEditBack] = useState('');
  const [saving, setSaving] = useState(false);
  const [bulkAccepting, setBulkAccepting] = useState(false);
  const [dailyCap, setDailyCap] = useState(20);

  const fetchCards = useCallback(async (filterMode: FilterMode = mode) => {
    const [cardsRes, subjectRes] = await Promise.all([
      fetch(`/api/cards/${subjectId}?mode=${filterMode}`),
      fetch(`/api/subjects/${subjectId}`),
    ]);
    if (cardsRes.status === 401) { router.push('/'); return; }
    if (cardsRes.ok) {
      const data = await cardsRes.json();
      setCards(data.cards);
      setDailyCap(data.daily_cap ?? 20);
    }
    if (subjectRes.ok) {
      const data = await subjectRes.json();
      setSubjectName(data.subject.name);
    }
    setLoading(false);
  }, [subjectId, router, mode]);

  useEffect(() => { fetchCards(mode); }, [mode]); // eslint-disable-line

  function openEdit(card: Flashcard) {
    setEditingCard(card);
    setEditFront(card.front);
    setEditBack(card.back);
  }

  function closeEdit() {
    setEditingCard(null);
    setEditFront('');
    setEditBack('');
  }

  async function saveEdit() {
    if (!editingCard) return;
    setSaving(true);
    await fetch(`/api/cards/${subjectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'edit', card_id: editingCard.id, front: editFront, back: editBack }),
    });
    setSaving(false);
    closeEdit();
    fetchCards(mode);
  }

  async function acceptCard(cardId: string) {
    await fetch(`/api/cards/${subjectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'accept', card_id: cardId }),
    });
    fetchCards(mode);
  }

  async function deleteCard(cardId: string) {
    await fetch(`/api/cards/${subjectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', card_id: cardId }),
    });
    setCards(prev => prev.filter(c => c.id !== cardId));
  }

  async function bulkAccept() {
    if (!confirm('Accept all new cards? They will enter your review schedule.')) return;
    setBulkAccepting(true);
    await fetch(`/api/cards/${subjectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'accept' }),
    });
    setBulkAccepting(false);
    fetchCards(mode);
  }

  const newCount = cards.filter(c => c.status === 'new').length;

  const tabs: { key: FilterMode; label: string }[] = [
    { key: 'all', label: 'ALL' },
    { key: 'new', label: 'NEW' },
    { key: 'due', label: 'DUE TODAY' },
    { key: 'deleted', label: 'DELETED' },
  ];

  return (
    <div className="page-container">

      {/* Breadcrumb */}
      <div className="breadcrumb">
        <Link href="/dashboard" className="text-mono" style={{ opacity: 0.6, textDecoration: 'none' }}>DASHBOARD</Link>
        <span className="text-mono" style={{ opacity: 0.4 }}>›</span>
        <Link href={`/dashboard/subjects/${subjectId}`} className="text-mono" style={{ opacity: 0.6, textDecoration: 'none' }}>
          {subjectName.toUpperCase() || '...'}
        </Link>
        <span className="text-mono" style={{ opacity: 0.4 }}>›</span>
        <span className="text-mono">CARDS</span>
      </div>

      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="text-display-lg">FLASHCARDS</h1>
          <p className="text-mono" style={{ marginTop: '4px', opacity: 0.6 }}>
            {cards.length} CARDS · {dailyCap} NEW/DAY CAP
          </p>
        </div>
        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
          {mode === 'all' && newCount > 0 && (
            <button
              className="btn btn-secondary"
              onClick={bulkAccept}
              disabled={bulkAccepting}
              id="bulk-accept-btn"
            >
              {bulkAccepting ? 'ACCEPTING...' : `ACCEPT ALL NEW (${newCount})`}
            </button>
          )}
          <Link
            href={`/dashboard/subjects/${subjectId}/review`}
            className="btn btn-primary"
            style={{ textDecoration: 'none' }}
          >
            START REVIEW →
          </Link>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="filter-tabs">
        {tabs.map(({ key, label }, i) => (
          <button
            key={key}
            className="btn btn-ghost"
            onClick={() => setMode(key)}
            style={{
              borderRight: i < tabs.length - 1 ? '2px solid var(--ink)' : 'none',
              borderRadius: 0,
              backgroundColor: mode === key ? 'var(--ink)' : 'var(--surface)',
              color: mode === key ? 'var(--base)' : 'var(--ink)',
              padding: '8px 16px',
              fontSize: '13px',
            }}
            id={`filter-${key}`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="processing-block">LOADING CARDS...</div>
      ) : cards.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state__text" style={{ marginBottom: '12px' }}>NO CARDS IN THIS VIEW.</p>
          <Link href={`/dashboard/subjects/${subjectId}`} className="btn btn-secondary" style={{ textDecoration: 'none' }}>
            ADD NOTES →
          </Link>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {/* Column header — hidden on mobile */}
          <div
            className="data-row-grid hide-on-mobile"
            style={{
              gridTemplateColumns: '1fr 80px 120px 160px',
              backgroundColor: 'var(--mono-panel)',
              border: '2px solid var(--ink)',
            }}
          >
            <span className="text-mono">CARD</span>
            <span className="text-mono">TYPE</span>
            <span className="text-mono">STATUS</span>
            <span className="text-mono">ACTIONS</span>
          </div>

          {cards.map((card) => (
            <div
              key={card.id}
              className="bento-tile data-row-grid"
              style={{
                gridTemplateColumns: '1fr 80px 120px 160px',
                borderColor: card.status === 'new' ? 'var(--signal)' : 'var(--ink)',
              }}
            >
              <div>
                <p className="text-body-sm" style={{ fontWeight: 600, marginBottom: '4px' }}>{card.front}</p>
                <p className="text-mono" style={{ opacity: 0.55, fontSize: '12px', marginTop: '2px' }}>{card.back.slice(0, 80)}{card.back.length > 80 ? '…' : ''}</p>
              </div>

              <span className="mono-tag" style={{ alignSelf: 'center' }}>
                {card.card_type === 'cloze' ? 'CLOZE' : 'Q&A'}
              </span>

              <div style={{ alignSelf: 'center' }}>
                <span className={`mono-tag ${card.status === 'new' ? 'mono-tag-signal' : card.status === 'deleted' ? '' : 'mono-tag-link'}`}>
                  {card.status.toUpperCase()}
                </span>
                {card.next_review_at && card.status !== 'deleted' && (
                  <div className="text-mono" style={{ opacity: 0.5, fontSize: '11px', marginTop: '4px' }}>
                    DUE {new Date(card.next_review_at).toLocaleDateString()}
                  </div>
                )}
              </div>

              <div className="flex gap-1" style={{ alignSelf: 'center', flexWrap: 'wrap' }}>
                {card.status === 'new' && (
                  <button
                    className="btn btn-secondary"
                    style={{ fontSize: '11px', padding: '4px 8px' }}
                    onClick={() => acceptCard(card.id)}
                    id={`accept-${card.id}`}
                  >
                    ACCEPT
                  </button>
                )}
                {card.status !== 'deleted' && (
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: '11px', padding: '4px 8px' }}
                    onClick={() => openEdit(card)}
                    id={`edit-${card.id}`}
                  >
                    EDIT
                  </button>
                )}
                {card.status !== 'deleted' && (
                  <button
                    className="btn btn-destructive"
                    style={{ fontSize: '11px', padding: '4px 8px' }}
                    onClick={() => deleteCard(card.id)}
                    id={`delete-${card.id}`}
                  >
                    DEL
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit modal */}
      {editingCard && (
        <div
          className="modal-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) closeEdit(); }}
        >
          <div className="modal-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 className="text-display-md">EDIT CARD</h2>
              <button className="btn btn-ghost" onClick={closeEdit} style={{ fontSize: '18px', padding: '4px 8px' }}>✕</button>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <div className="mono-tag" style={{ marginBottom: '8px' }}>FRONT</div>
              <textarea
                className="textarea-ink"
                value={editFront}
                onChange={(e) => setEditFront(e.target.value)}
                style={{ minHeight: '90px', fontSize: '14px' }}
                id="edit-front"
              />
            </div>

            <div style={{ marginBottom: '24px' }}>
              <div className="mono-tag" style={{ marginBottom: '8px' }}>BACK (ANSWER)</div>
              <textarea
                className="textarea-ink"
                value={editBack}
                onChange={(e) => setEditBack(e.target.value)}
                style={{ minHeight: '90px', fontSize: '14px' }}
                id="edit-back"
              />
            </div>

            <div className="flex gap-2">
              <button
                className="btn btn-primary"
                onClick={saveEdit}
                disabled={saving || !editFront.trim() || !editBack.trim()}
                id="save-edit-btn"
              >
                {saving ? 'SAVING...' : 'SAVE CHANGES'}
              </button>
              <button className="btn btn-ghost" onClick={closeEdit}>CANCEL</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
