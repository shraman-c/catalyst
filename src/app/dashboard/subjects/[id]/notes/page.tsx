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
              gridTemplateColumns: '1fr 100px 100px 100px 100px',
              backgroundColor: 'var(--mono-panel)',
              border: '2px solid var(--ink)',
            }}
          >
            <span className="text-mono">FILENAME</span>
            <span className="text-mono">SOURCE</span>
            <span className="text-mono">CONCEPTS</span>
            <span className="text-mono">CARDS</span>
            <span className="text-mono">ACTIONS</span>
          </div>

          {notes.map((note) => (
            <div
              key={note.id}
              className="bento-tile bento-tile-hoverable data-row-grid"
              style={{
                gridTemplateColumns: '1fr 100px 100px 100px 100px',
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
              <Link
                href={`/dashboard/subjects/${subjectId}/notes/${note.id}`}
                className="btn btn-ghost"
                style={{ fontSize: '11px', textDecoration: 'none', padding: '6px 10px', width: 'fit-content' }}
                id={`note-view-${note.id}`}
              >
                VIEW →
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
