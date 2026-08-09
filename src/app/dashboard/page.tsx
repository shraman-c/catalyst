'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface SubjectStats {
  note_count: number;
  graph_node_count: number;
  card_count: number;
  cards_due_today: number;
  last_synced_at: string | null;
}

interface Subject {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  stats: SubjectStats;
}

export default function DashboardPage() {
  const router = useRouter();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewSubject, setShowNewSubject] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState('');
  const [newSubjectDesc, setNewSubjectDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    fetchSubjects();
  }, []);

  async function fetchSubjects() {
    setLoading(true);
    try {
      const res = await fetch('/api/subjects');
      if (res.status === 401) { router.push('/'); return; }
      if (res.ok) {
        const data = await res.json();
        setSubjects(data.subjects ?? []);
      }
    } catch (err) {
      console.error('Failed to fetch subjects:', err);
    }
    setLoading(false);
  }

  async function createSubject(e: React.FormEvent) {
    e.preventDefault();
    if (!newSubjectName.trim()) return;
    setCreating(true);
    setCreateError('');

    try {
      const res = await fetch('/api/subjects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newSubjectName.trim(), description: newSubjectDesc.trim() || undefined }),
      });

      if (res.ok) {
        const data = await res.json();
        // Append new subject to list immediately
        setSubjects((prev) => [
          { ...data.subject, stats: { note_count: 0, graph_node_count: 0, card_count: 0, cards_due_today: 0, last_synced_at: null } },
          ...prev,
        ]);
        setNewSubjectName('');
        setNewSubjectDesc('');
        setShowNewSubject(false);
        router.push(`/dashboard/subjects/${data.subject.id}`);
      } else {
        const err = await res.json().catch(() => ({}));
        setCreateError(err.error || 'Failed to create subject. Please try again.');
      }
    } catch {
      setCreateError('Network error. Please check your connection.');
    }
    setCreating(false);
  }

  async function deleteSubject(subjectId: string, subjectName: string) {
    if (!confirm(`Are you sure you want to delete "${subjectName}"? This will permanently delete all associated notes, concepts, and flashcards.`)) {
      return;
    }
    setDeletingId(subjectId);
    try {
      const res = await fetch(`/api/subjects/${subjectId}`, { method: 'DELETE' });
      if (res.ok) {
        setSubjects((prev) => prev.filter((s) => s.id !== subjectId));
      } else {
        alert('Failed to delete subject.');
      }
    } catch (err) {
      console.error(err);
      alert('Network error while deleting subject.');
    }
    setDeletingId(null);
    setOpenMenuId(null);
  }

  const totalDue = subjects.reduce((sum, s) => sum + s.stats.cards_due_today, 0);

  return (
    <div className="page-container">

      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="text-display-lg">YOUR SUBJECTS</h1>
          <p className="text-mono" style={{ marginTop: '4px', opacity: 0.6 }}>
            {subjects.length} SUBJECT{subjects.length !== 1 ? 'S' : ''} · {totalDue} CARDS DUE TODAY
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => { setShowNewSubject(true); setCreateError(''); }}
          id="new-subject-btn"
        >
          + NEW SUBJECT
        </button>
      </div>

      {/* New subject form — modal overlay */}
      {showNewSubject && (
        <div
          className="modal-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) setShowNewSubject(false); }}
        >
          <div className="modal-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 className="text-display-md">NEW SUBJECT</h2>
              <button className="btn btn-ghost" onClick={() => setShowNewSubject(false)} style={{ padding: '4px 8px', fontSize: '18px' }}>✕</button>
            </div>
            <form onSubmit={createSubject}>
              <div style={{ marginBottom: '12px' }}>
                <div className="mono-tag" style={{ marginBottom: '6px' }}>SUBJECT NAME *</div>
                <input
                  className="input-ink"
                  type="text"
                  value={newSubjectName}
                  onChange={(e) => setNewSubjectName(e.target.value)}
                  placeholder="e.g. Organic Chemistry"
                  autoFocus
                  id="new-subject-input"
                />
              </div>
              <div style={{ marginBottom: '20px' }}>
                <div className="mono-tag" style={{ marginBottom: '6px' }}>DESCRIPTION (OPTIONAL)</div>
                <input
                  className="input-ink"
                  type="text"
                  value={newSubjectDesc}
                  onChange={(e) => setNewSubjectDesc(e.target.value)}
                  placeholder="e.g. Spring 2026, Prof. Johnson"
                  id="new-subject-desc"
                />
              </div>
              {createError && (
                <div className="alert-block" style={{ marginBottom: '12px' }}>
                  {createError}
                </div>
              )}
              <div className="flex gap-2">
                <button className="btn btn-primary" type="submit" disabled={creating || !newSubjectName.trim()} id="new-subject-submit">
                  {creating ? 'CREATING...' : 'CREATE SUBJECT'}
                </button>
                <button className="btn btn-ghost" type="button" onClick={() => setShowNewSubject(false)}>
                  CANCEL
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="processing-block" style={{ maxWidth: '300px' }}>
          LOADING SUBJECTS...
        </div>
      ) : subjects.length === 0 ? (
        /* Empty state — but always show the "add" prompt */
        <div>
          <div className="empty-state" style={{ maxWidth: '480px', marginBottom: '20px' }}>
            <p className="empty-state__text" style={{ marginBottom: '16px' }}>NO SUBJECTS YET.</p>
            <p className="text-body-sm" style={{ opacity: 0.7, marginBottom: '24px' }}>
              Create a subject for each course or topic you are studying.
              Then paste or upload your notes to start building your knowledge graph.
            </p>
            <button className="btn btn-primary" onClick={() => setShowNewSubject(true)} id="empty-add-subject">
              + CREATE FIRST SUBJECT
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Due-today banner */}
          {totalDue > 0 && (
            <div className="bento-tile bento-tile-signal" style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
              <div className="stat-block">
                <span className="stat-block__number">{totalDue}</span>
                <span className="stat-block__label">CARDS DUE TODAY · ACROSS ALL SUBJECTS</span>
              </div>
              <p className="text-body-sm" style={{ opacity: 0.8 }}>Review due cards from any subject below to stay on schedule.</p>
            </div>
          )}

          {/* Subject grid */}
          <div className="subject-grid">
            {subjects.map((subject) => (
              <Link
                key={subject.id}
                href={`/dashboard/subjects/${subject.id}`}
                style={{ textDecoration: 'none', color: 'inherit' }}
                id={`subject-tile-${subject.id}`}
              >
                <div className="bento-tile bento-tile-hoverable shadow-hard subject-card" style={{ position: 'relative' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                    <h2 className="text-display-md subject-card__name" style={{ paddingRight: '30px' }}>
                      {subject.name.toUpperCase()}
                    </h2>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {subject.stats.cards_due_today > 0 && (
                        <div className="mono-tag mono-tag-signal" style={{ flexShrink: 0 }}>{subject.stats.cards_due_today} DUE</div>
                      )}
                      
                      {/* Hamburger Menu */}
                      <div style={{ position: 'relative' }}>
                        <button 
                          className="btn btn-ghost" 
                          style={{ padding: '4px', height: '28px', width: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink)' }}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setOpenMenuId(openMenuId === subject.id ? null : subject.id);
                          }}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="1"></circle>
                            <circle cx="12" cy="5" r="1"></circle>
                            <circle cx="12" cy="19" r="1"></circle>
                          </svg>
                        </button>
                        
                        {openMenuId === subject.id && (
                          <div 
                            className="bento-tile shadow-hard" 
                            style={{ 
                              position: 'absolute', 
                              top: '100%', 
                              right: 0, 
                              marginTop: '4px',
                              padding: '4px', 
                              zIndex: 10,
                              minWidth: '140px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '2px'
                            }}
                          >
                            <button
                              className="btn btn-ghost"
                              style={{ width: '100%', justifyContent: 'flex-start', padding: '6px 12px', fontSize: '13px', color: 'var(--signal)' }}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                deleteSubject(subject.id, subject.name);
                              }}
                              disabled={deletingId === subject.id}
                            >
                              {deletingId === subject.id ? 'DELETING...' : 'DELETE SUBJECT'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {subject.description && (
                    <p className="text-body-sm" style={{ opacity: 0.65, marginBottom: '12px' }}>{subject.description}</p>
                  )}

                  {/* Stats row */}
                  <div className="subject-card__stats">
                    <div className="stat-block">
                      <span className="stat-block__number stat-block__number--sm">{subject.stats.note_count}</span>
                      <span className="stat-block__label">NOTES</span>
                    </div>
                    <div className="stat-block">
                      <span className="stat-block__number stat-block__number--sm">{subject.stats.graph_node_count}</span>
                      <span className="stat-block__label">CONCEPTS</span>
                    </div>
                    <div className="stat-block">
                      <span className="stat-block__number stat-block__number--sm">{subject.stats.card_count}</span>
                      <span className="stat-block__label">CARDS</span>
                    </div>
                  </div>

                  {subject.stats.last_synced_at && (
                    <div className="structural-tag">
                      SYNCED {formatRelativeTime(subject.stats.last_synced_at)}
                    </div>
                  )}
                </div>
              </Link>
            ))}

            {/* Add new tile */}
            <div
              className="bento-tile bento-tile-hoverable add-subject-tile"
              onClick={() => { setShowNewSubject(true); setCreateError(''); }}
              id="add-subject-tile"
            >
              <span className="text-display-md">+</span>
              <span className="text-mono" style={{ marginTop: '8px', opacity: 0.6 }}>NEW SUBJECT</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'JUST NOW';
  if (diffMins < 60) return `${diffMins}M AGO`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}H AGO`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}D AGO`;
}
