'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

interface SubjectData {
  subject: { id: string; name: string; description: string | null };
  stats: {
    note_count: number;
    graph_node_count: number;
    graph_edge_count: number;
    card_count: number;
    cards_due_today: number;
    last_synced_at: string | null;
  };
  recent_notes: Array<{ id: string; filename: string; updated_at: string }>;
}

interface PipelineResult {
  nodes_created: number;
  nodes_merged: number;
  edges_created: number;
  cards_created: number;
  cards_deduplicated: number;
  processing_time_ms: number;
}

export default function SubjectPage() {
  const params = useParams();
  const router = useRouter();
  const subjectId = params.id as string;

  const [data, setData] = useState<SubjectData | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [pasteContent, setPasteContent] = useState('');
  const [pasteFilename, setPasteFilename] = useState('lecture-notes.md');
  const [uploadResult, setUploadResult] = useState<PipelineResult | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [uploadTab, setUploadTab] = useState<'paste' | 'file'>('paste');
  const [syncStatus, setSyncStatus] = useState<{ watcher_connected: boolean; last_sync_at: string | null; folder_path: string | null } | null>(null);

  const fetchData = useCallback(async () => {
    const [subjectRes, syncRes] = await Promise.all([
      fetch(`/api/subjects/${subjectId}`),
      fetch(`/api/sync/status?subject_id=${subjectId}`),
    ]);
    if (subjectRes.status === 401) { router.push('/'); return; }
    if (subjectRes.ok) {
      setData(await subjectRes.json());
    }
    if (syncRes.ok) {
      setSyncStatus(await syncRes.json());
    }
    setLoading(false);
  }, [subjectId, router]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function handlePasteUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!pasteContent.trim()) return;
    setUploading(true);
    setUploadError('');
    setUploadResult(null);

    try {
      const res = await fetch('/api/notes/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject_id: subjectId,
          filename: pasteFilename || 'pasted-note.md',
          content: pasteContent,
        }),
      });

      const result = await res.json();
      if (!res.ok) {
        setUploadError(result.error || result.detail || 'Upload failed');
      } else {
        setUploadResult(result.pipeline);
        setPasteContent('');
        fetchData(); // Refresh stats
      }
    } catch {
      setUploadError('NETWORK ERROR — CHECK YOUR CONNECTION');
    } finally {
      setUploading(false);
    }
  }

  async function handleFileUpload(files: FileList | File[]) {
    setUploading(true);
    setUploadError('');
    setUploadResult(null);
    setUploadProgress({ current: 0, total: files.length });

    const accumulatedResult: PipelineResult = {
      nodes_created: 0,
      nodes_merged: 0,
      edges_created: 0,
      cards_created: 0,
      cards_deduplicated: 0,
      processing_time_ms: 0,
    };
    
    let hasError = false;
    let anySuccess = false;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const formData = new FormData();
      formData.append('subject_id', subjectId);
      formData.append('file', file);

      try {
        const res = await fetch('/api/notes/upload', {
          method: 'POST',
          body: formData,
        });

        const result = await res.json();
        if (!res.ok) {
          setUploadError(prev => (prev ? prev + '\n' : '') + `Failed ${file.name}: ${result.error || result.detail || 'Upload failed'}`);
          hasError = true;
        } else {
          accumulatedResult.nodes_created += result.pipeline.nodes_created;
          accumulatedResult.nodes_merged += result.pipeline.nodes_merged;
          accumulatedResult.edges_created += result.pipeline.edges_created;
          accumulatedResult.cards_created += result.pipeline.cards_created;
          accumulatedResult.cards_deduplicated += result.pipeline.cards_deduplicated;
          accumulatedResult.processing_time_ms += result.pipeline.processing_time_ms;
          anySuccess = true;
        }
      } catch {
        setUploadError(prev => (prev ? prev + '\n' : '') + `NETWORK ERROR for ${file.name}`);
        hasError = true;
      }
      
      setUploadProgress(prev => ({ ...prev, current: prev.current + 1 }));
    }

    if (anySuccess) {
      setUploadResult(accumulatedResult);
      fetchData();
    }
    
    setUploading(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files);
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '40px' }}>
        <div className="processing-block" style={{ maxWidth: '300px' }}>LOADING SUBJECT...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="page-container">
        <div className="alert-block">SUBJECT NOT FOUND</div>
      </div>
    );
  }

  const { subject, stats, recent_notes } = data;

  return (
    <div className="page-container">

      {/* Breadcrumb */}
      <div className="breadcrumb">
        <Link href="/dashboard" className="text-mono" style={{ opacity: 0.6, textDecoration: 'none' }}>DASHBOARD</Link>
        <span className="text-mono" style={{ opacity: 0.4 }}>›</span>
        <span className="text-mono">{subject.name.toUpperCase()}</span>
      </div>

      {/* Subject name + actions */}
      <div className="page-header">
        <div>
          <h1 className="text-display-lg">{subject.name.toUpperCase()}</h1>
          {syncStatus?.watcher_connected && (
            <div className="flex gap-2 items-center" style={{ marginTop: '8px', flexWrap: 'wrap' }}>
              <span className="mono-tag mono-tag-link">● WATCHER ACTIVE</span>
              {syncStatus.last_sync_at && (
                <span className="text-mono" style={{ opacity: 0.5, fontSize: '12px' }}>
                  LAST SYNC: {new Date(syncStatus.last_sync_at).toLocaleString()}
                </span>
              )}
              {syncStatus.folder_path && (
                <span className="text-mono" style={{ opacity: 0.4, fontSize: '11px' }}>({syncStatus.folder_path})</span>
              )}
            </div>
          )}
        </div>
        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
          <Link href={`/dashboard/subjects/${subjectId}/graph`} className="btn btn-secondary" id="view-graph-btn" style={{ textDecoration: 'none' }}>
            VIEW GRAPH
          </Link>
          <Link href={`/dashboard/subjects/${subjectId}/review`} className="btn btn-primary" id="review-btn" style={{ textDecoration: 'none' }}>
            REVIEW ({stats.cards_due_today} DUE)
          </Link>
        </div>
      </div>

      {/* Stats row */}
      <div className="stats-row-4">
        {[
          { value: stats.note_count, label: 'NOTES SYNCED' },
          { value: stats.cards_due_today, label: 'CARDS DUE', highlight: stats.cards_due_today > 0 },
          { value: stats.graph_node_count, label: 'GRAPH NODES' },
          { value: stats.card_count, label: 'TOTAL CARDS' },
        ].map(({ value, label, highlight }) => (
          <div
            key={label}
            style={{ backgroundColor: highlight ? 'var(--signal)' : 'transparent' }}
          >
            <div className="stat-block">
              <span className="stat-block__number">{value}</span>
              <span className="stat-block__label">{label}</span>
            </div>
            {stats.last_synced_at && label === 'NOTES SYNCED' && (
              <div className="text-mono" style={{ marginTop: '8px', opacity: 0.5, fontSize: '11px' }}>
                LAST: {new Date(stats.last_synced_at).toLocaleDateString()}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Main layout: upload + recent notes — stacks on mobile */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: '12px', marginBottom: '20px' }}
           className="upload-notes-grid">

        {/* Upload / Paste zone */}
        <div className="bento-tile" id="upload-zone">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 className="text-display-md">ADD NOTES</h2>
            <div className="flex gap-1">
              <button
                className={`btn ${uploadTab === 'paste' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ padding: '6px 12px', fontSize: '12px' }}
                onClick={() => setUploadTab('paste')}
                id="tab-paste"
              >
                PASTE
              </button>
              <button
                className={`btn ${uploadTab === 'file' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ padding: '6px 12px', fontSize: '12px' }}
                onClick={() => setUploadTab('file')}
                id="tab-file"
              >
                UPLOAD FILE
              </button>
            </div>
          </div>

          {uploadTab === 'paste' ? (
            <form onSubmit={handlePasteUpload} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <input
                className="input-ink"
                type="text"
                value={pasteFilename}
                onChange={(e) => setPasteFilename(e.target.value)}
                placeholder="Note filename (e.g. week3-lecture.md)"
                id="paste-filename"
              />
              <textarea
                className="textarea-ink"
                value={pasteContent}
                onChange={(e) => setPasteContent(e.target.value)}
                placeholder="Paste your lecture notes here (Markdown or plain text)..."
                style={{ minHeight: '240px' }}
                id="paste-content"
              />
              <button
                className="btn btn-primary"
                type="submit"
                disabled={uploading || !pasteContent.trim()}
                id="paste-submit"
                style={{ alignSelf: 'flex-start' }}
              >
                {uploading ? 'PROCESSING...' : 'SYNTHESIZE NOTES →'}
              </button>
            </form>
          ) : (
            <div
              className={`upload-zone ${dragOver ? 'dragging' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              id="file-dropzone"
            >
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                <span className="text-display-md" style={{ opacity: 0.4 }}>↓</span>
                <p className="text-body-sm" style={{ opacity: 0.7 }}>
                  DROP .MD OR .TXT FILES HERE
                </p>
                <span className="text-mono" style={{ opacity: 0.5 }}>OR</span>
                <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
                  BROWSE FILES
                  <input
                    type="file"
                    multiple
                    accept=".md,.txt"
                    style={{ display: 'none' }}
                    onChange={(e) => { if (e.target.files?.length) handleFileUpload(e.target.files); }}
                    id="file-input"
                  />
                </label>
                <p className="text-mono" style={{ opacity: 0.4 }}>MAX 2MB · .MD OR .TXT</p>
              </div>
            </div>
          )}

          {/* Processing state */}
          {uploading && (
            <div className="processing-block" style={{ marginTop: '12px' }}>
              <div style={{ marginBottom: '8px' }}>
                STRUCTURING YOUR NOTES... THIS MIGHT TAKE SOME TIME
              </div>
              {uploadProgress.total > 1 && (
                <>
                  <div style={{ width: '100%', height: '8px', border: '2px solid var(--ink)', backgroundColor: 'var(--surface)' }}>
                    <div style={{
                      height: '100%',
                      width: `${Math.round((uploadProgress.current / uploadProgress.total) * 100)}%`,
                      backgroundColor: 'var(--ink)',
                      transition: 'width 0.2s',
                    }} />
                  </div>
                  <div className="text-mono" style={{ marginTop: '4px', textAlign: 'center', fontSize: '11px' }}>
                    {uploadProgress.current} OF {uploadProgress.total} PROCESSED
                  </div>
                </>
              )}
            </div>
          )}

          {/* Error state (design.md §6) */}
          {uploadError && (
            <div className="alert-block" style={{ marginTop: '12px' }}>
              {uploadError}
            </div>
          )}

          {/* Success result */}
          {uploadResult && (
            <div className="success-block" style={{ marginTop: '12px' }}>
              <div className="text-mono" style={{ marginBottom: '8px' }}>NOTES PROCESSED SUCCESSFULLY</div>
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                <span className="mono-tag mono-tag-link">{uploadResult.nodes_created} NEW CONCEPTS</span>
                <span className="mono-tag">{uploadResult.nodes_merged} MERGED</span>
                <span className="mono-tag mono-tag-link">{uploadResult.cards_created} NEW CARDS</span>
                {uploadResult.cards_deduplicated > 0 && (
                  <span className="mono-tag">{uploadResult.cards_deduplicated} DEDUPED</span>
                )}
                <span className="mono-tag">{Math.round(uploadResult.processing_time_ms / 1000)}S</span>
              </div>
              <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
                <Link href={`/dashboard/subjects/${subjectId}/graph`} className="btn btn-secondary" style={{ fontSize: '12px' }}>
                  VIEW GRAPH →
                </Link>
                <Link href={`/dashboard/subjects/${subjectId}/review`} className="btn btn-primary" style={{ fontSize: '12px' }}>
                  STUDY CARDS →
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* Recent notes sidebar */}
        <div className="bento-tile bento-tile-mono">
          <h2 className="text-display-md" style={{ marginBottom: '16px' }}>RECENT NOTES</h2>
          {recent_notes.length === 0 ? (
            <p className="text-mono" style={{ opacity: 0.5 }}>NO NOTES YET. ADD ONE ←</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {recent_notes.map((note) => (
                <Link
                  key={note.id}
                  href={`/dashboard/subjects/${subjectId}/notes/${note.id}`}
                  style={{ textDecoration: 'none' }}
                  id={`note-${note.id}`}
                >
                  <div
                    className="bento-tile bento-tile-hoverable"
                    style={{ padding: '12px 14px', backgroundColor: 'var(--surface)' }}
                  >
                    <div className="text-body-sm" style={{ fontWeight: 600, marginBottom: '4px' }}>
                      {note.filename}
                    </div>
                    <div className="text-mono" style={{ opacity: 0.5, fontSize: '11px' }}>
                      {new Date(note.updated_at).toLocaleDateString()}
                    </div>
                  </div>
                </Link>
              ))}
              <Link
                href={`/dashboard/subjects/${subjectId}/notes`}
                className="btn btn-ghost"
                style={{ fontSize: '12px', marginTop: '4px', textDecoration: 'none', textAlign: 'center' }}
                id="view-all-notes"
              >
                VIEW ALL NOTES →
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Quick links row */}
      <div className="quick-links-grid">
        <Link href={`/dashboard/subjects/${subjectId}/graph`} style={{ textDecoration: 'none' }}>
          <div className="bento-tile bento-tile-hoverable" style={{ textAlign: 'center', padding: '20px' }}>
            <div className="text-display-md" style={{ marginBottom: '6px' }}>◈</div>
            <div className="text-mono">KNOWLEDGE GRAPH</div>
            <div className="text-mono" style={{ opacity: 0.5, marginTop: '4px' }}>{stats.graph_node_count} NODES</div>
          </div>
        </Link>
        <Link href={`/dashboard/subjects/${subjectId}/review`} style={{ textDecoration: 'none' }}>
          <div className={`bento-tile bento-tile-hoverable ${stats.cards_due_today > 0 ? 'bento-tile-signal' : ''}`} style={{ textAlign: 'center', padding: '20px' }}>
            <div className="text-display-md" style={{ marginBottom: '6px' }}>⊡</div>
            <div className="text-mono">FLASHCARD REVIEW</div>
            <div className="text-mono" style={{ opacity: 0.7, marginTop: '4px' }}>{stats.cards_due_today} DUE TODAY</div>
          </div>
        </Link>
        <Link href={`/dashboard/subjects/${subjectId}/cards`} style={{ textDecoration: 'none' }}>
          <div className="bento-tile bento-tile-hoverable" style={{ textAlign: 'center', padding: '20px' }}>
            <div className="text-display-md" style={{ marginBottom: '6px' }}>⊞</div>
            <div className="text-mono">MANAGE CARDS</div>
            <div className="text-mono" style={{ opacity: 0.5, marginTop: '4px' }}>{stats.card_count} TOTAL</div>
          </div>
        </Link>
        <Link href={`/dashboard/subjects/${subjectId}/notes`} style={{ textDecoration: 'none' }}>
          <div className="bento-tile bento-tile-hoverable" style={{ textAlign: 'center', padding: '20px' }}>
            <div className="text-display-md" style={{ marginBottom: '6px' }}>≡</div>
            <div className="text-mono">ALL NOTES</div>
            <div className="text-mono" style={{ opacity: 0.5, marginTop: '4px' }}>{stats.note_count} FILES</div>
          </div>
        </Link>
      </div>
    </div>
  );
}
