'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

interface NoteFile {
  id: string;
  filename: string;
  source: string;
  content_hash: string;
  created_at: string;
  updated_at: string;
  card_count: number;
  node_count: number;
}

export default function NotesListPage() {
  const params = useParams();
  const router = useRouter();
  const subjectId = params.id as string;

  const [notes, setNotes] = useState<NoteFile[]>([]);
  const [subjectName, setSubjectName] = useState('');
  const [loading, setLoading] = useState(true);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchNotes = useCallback(async () => {
    const [notesRes, subjectRes] = await Promise.all([
      fetch(`/api/notes?subject_id=${subjectId}`),
      fetch(`/api/subjects/${subjectId}`),
    ]);
    if (notesRes.status === 401) { router.push('/'); return; }
    if (notesRes.ok) {
      const data = await notesRes.json();
      setNotes(data.notes || []);
    }
    if (subjectRes.ok) {
      const data = await subjectRes.json();
      setSubjectName(data.subject.name);
    }
    setLoading(false);
  }, [subjectId, router]);

  useEffect(() => { fetchNotes(); }, [fetchNotes]);

  async function handleDeleteNote(noteId: string) {
    setDeletingId(noteId);
    try {
      const res = await fetch(`/api/delete?type=notes&id=${noteId}`, { method: 'DELETE' });
      if (res.ok) {
        setNotes((prev) => prev.filter((n) => n.id !== noteId));
      } else {
        console.error('Delete failed:', res.status);
      }
    } catch (err) {
      console.error('Delete note failed:', err);
    }
    setDeletingId(null);
    setConfirmDeleteId(null);
  }

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
        <span className="text-mono">NOTES</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="text-display-lg">NOTE FILES</h1>
          <p className="text-mono" style={{ opacity: 0.6, marginTop: '4px' }}>{notes.length} FILES SYNCED</p>
        </div>
        <Link href={`/dashboard/subjects/${subjectId}`} className="btn btn-primary" style={{ textDecoration: 'none' }}>
          + ADD NOTE
        </Link>
      </div>

      {loading ? (
        <div className="processing-block">LOADING NOTES...</div>
      ) : notes.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state__text" style={{ marginBottom: '16px' }}>NO NOTES YET.</p>
          <Link href={`/dashboard/subjects/${subjectId}`} className="btn btn-primary" style={{ textDecoration: 'none' }}>
            UPLOAD YOUR FIRST NOTE →
          </Link>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {/* Column headers — hidden on mobile */}
          <div
            className="data-row-grid hide-on-mobile"
            style={{
              gridTemplateColumns: '1fr 90px 90px 90px 170px',
              backgroundColor: 'var(--mono-panel)',
              border: '2px solid var(--ink)',
            }}
          >
            <span className="text-mono">FILENAME</span>
            <span className="text-mono">SOURCE</span>
            <span className="text-mono">CONCEPTS</span>
            <span className="text-mono">CARDS</span>
            <span className="text-mono" style={{ textAlign: 'right' }}>ACTIONS</span>
          </div>

          {notes.map((note) => (
            <div
              key={note.id}
              className="bento-tile bento-tile-hoverable data-row-grid"
              style={{
                gridTemplateColumns: '1fr 90px 90px 90px 170px',
                borderColor: 'var(--ink)',
              }}
            >
              <div>
                <div className="text-body-sm" style={{ fontWeight: 600 }}>{note.filename}</div>
                <div className="text-mono" style={{ opacity: 0.4, fontSize: '11px' }}>
                  {new Date(note.updated_at).toLocaleDateString()} · {note.content_hash.slice(0, 8)}...
                </div>
              </div>
              <span className="mono-tag" style={{ alignSelf: 'center', width: 'fit-content' }}>
                {note.source.replace('-deleted', '').toUpperCase()}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span className="hide-on-mobile text-mono" style={{ opacity: 0.5, fontSize: '11px' }}>CONCEPTS:</span>
                <span className="text-mono" style={{ opacity: 0.7 }}>{note.node_count}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span className="hide-on-mobile text-mono" style={{ opacity: 0.5, fontSize: '11px' }}>CARDS:</span>
                <span className="text-mono" style={{ opacity: 0.7 }}>{note.card_count}</span>
              </div>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', justifySelf: 'end' }}>
                <Link
                  href={`/dashboard/subjects/${subjectId}/notes/${note.id}`}
                  className="btn btn-ghost"
                  style={{ padding: '6px 8px', width: 'fit-content', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
                  id={`note-view-${note.id}`}
                  title="View note"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </Link>
                {confirmDeleteId === note.id ? (
                  <button
                    className="btn btn-destructive"
                    onClick={() => handleDeleteNote(note.id)}
                    disabled={deletingId === note.id}
                    style={{ fontSize: '11px', padding: '6px 10px', width: 'fit-content' }}
                    id={`note-delete-confirm-${note.id}`}
                  >
                    {deletingId === note.id ? 'DELETING...' : 'SURE?'}
                  </button>
                ) : (
                  <button
                    className="btn btn-ghost"
                    onClick={() => {
                      setConfirmDeleteId(note.id);
                      window.setTimeout(() => {
                        setConfirmDeleteId((c) => (c === note.id ? null : c));
                      }, 4000);
                    }}
                    style={{ padding: '6px 8px', width: 'fit-content', color: '#D64545', display: 'inline-flex', alignItems: 'center' }}
                    id={`note-delete-${note.id}`}
                    title="Delete note"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      <line x1="10" y1="11" x2="10" y2="17" />
                      <line x1="14" y1="11" x2="14" y2="17" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
