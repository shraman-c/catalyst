'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { marked } from 'marked';

interface NoteDetail {
  note: { id: string; filename: string; source: string; updated_at: string };
  content: string;
  concepts: Array<{ id: string; name: string; definition: string; reference_count: number }>;
  cards: Array<{ id: string; front: string; back: string; card_type: string; status: string }>;
}

export default function NoteDetailPage() {
  const params = useParams();
  const router = useRouter();
  const noteId = params.noteId as string;
  const subjectId = params.id as string;

  const [data, setData] = useState<NoteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'rendered' | 'raw' | 'concepts' | 'cards'>('rendered');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchNote = useCallback(async () => {
    const res = await fetch(`/api/notes/${noteId}`);
    if (res.status === 401) { router.push('/'); return; }
    if (res.ok) setData(await res.json());
    setLoading(false);
  }, [noteId, router]);

  useEffect(() => { fetchNote(); }, [fetchNote]);

  async function handleDeleteNote() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/delete?type=notes&id=${noteId}`, { method: 'DELETE' });
      if (res.ok) {
        router.push(`/dashboard/subjects/${subjectId}/notes`);
        return;
      }
      console.error('Delete failed:', res.status);
    } catch (err) {
      console.error('Delete note failed:', err);
    }
    setDeleting(false);
    setConfirmDelete(false);
  }

  return (
    <div className="page-container">

      {/* Breadcrumb */}
      <div className="flex items-center gap-2" style={{ marginBottom: '16px', flexWrap: 'wrap' }}>
        <Link href="/dashboard" className="text-mono" style={{ opacity: 0.6, textDecoration: 'none' }}>DASHBOARD</Link>
        <span className="text-mono" style={{ opacity: 0.4 }}>›</span>
        <Link href={`/dashboard/subjects/${subjectId}`} className="text-mono" style={{ opacity: 0.6, textDecoration: 'none' }}>SUBJECT</Link>
        <span className="text-mono" style={{ opacity: 0.4 }}>›</span>
        <Link href={`/dashboard/subjects/${subjectId}/notes`} className="text-mono" style={{ opacity: 0.6, textDecoration: 'none' }}>NOTES</Link>
        <span className="text-mono" style={{ opacity: 0.4 }}>›</span>
        <span className="text-mono">{data?.note.filename || '...'}</span>
      </div>

      {loading ? (
        <div className="processing-block">LOADING NOTE...</div>
      ) : !data ? (
        <div className="alert-block">NOTE NOT FOUND</div>
      ) : (
        <>
          {/* Note header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', gap: '16px', flexWrap: 'wrap' }}>
            <div>
              <h1 className="text-display-md" style={{ overflowWrap: 'anywhere' }}>{data.note.filename}</h1>
              <div className="flex gap-2" style={{ marginTop: '8px', flexWrap: 'wrap' }}>
                <span className="mono-tag">{data.note.source.toUpperCase()}</span>
                <span className="mono-tag">{new Date(data.note.updated_at).toLocaleDateString()}</span>
                <span className="mono-tag">{data.concepts.length} CONCEPTS</span>
                <span className="mono-tag">{data.cards.length} CARDS</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
              {confirmDelete ? (
                <button
                  className="btn btn-destructive"
                  onClick={handleDeleteNote}
                  disabled={deleting}
                  id="note-delete-confirm"
                >
                  {deleting ? 'DELETING...' : 'CONFIRM DELETE?'}
                </button>
              ) : (
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    setConfirmDelete(true);
                    window.setTimeout(() => setConfirmDelete(false), 5000);
                  }}
                  style={{ color: 'var(--alert)' }}
                  id="note-delete-btn"
                >
                  DELETE NOTE
                </button>
              )}
            </div>
          </div>

          {/* Tab bar */}
          <div style={{ display: 'flex', border: '3px solid var(--ink)', marginBottom: '20px', width: 'fit-content', maxWidth: '100%', flexWrap: 'wrap' }}>
            {[
              { key: 'rendered', label: 'RENDERED' },
              { key: 'raw', label: 'RAW' },
              { key: 'concepts', label: `CONCEPTS (${data.concepts.length})` },
              { key: 'cards', label: `CARDS (${data.cards.length})` },
            ].map(({ key, label }) => (
              <button
                key={key}
                className="btn btn-ghost"
                onClick={() => setActiveTab(key as any)}
                style={{
                  borderRight: key !== 'cards' ? '2px solid var(--ink)' : 'none',
                  borderRadius: 0,
                  backgroundColor: activeTab === key ? 'var(--ink)' : 'var(--surface)',
                  color: activeTab === key ? 'var(--base)' : 'var(--ink)',
                  padding: '8px 16px',
                  fontSize: '13px',
                }}
                id={`tab-${key}`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {activeTab === 'rendered' && (
            <div className="bento-tile" style={{ backgroundColor: 'var(--surface)' }}>
              {data.content ? (
                <div
                  className="markdown-content"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(data.content) }}
                />
              ) : (
                <div className="text-body-sm" style={{ opacity: 0.6 }}>No content available.</div>
              )}
            </div>
          )}

          {activeTab === 'raw' && (
            <div className="bento-tile" style={{ backgroundColor: 'var(--surface)' }}>
              <div
                style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', lineHeight: 1.7, whiteSpace: 'pre-wrap', overflowX: 'auto' }}
              >
                {data.content || 'No content available.'}
              </div>
            </div>
          )}

          {activeTab === 'concepts' && (
            <div>
              {data.concepts.length === 0 ? (
                <div className="processing-block">NO CONCEPTS EXTRACTED FROM THIS NOTE YET.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {data.concepts.map((concept) => (
                    <div key={concept.id} className="bento-tile">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                        <h3 className="text-body" style={{ fontWeight: 700 }}>{concept.name}</h3>
                        <span className="mono-tag">{concept.reference_count}× REFERENCED</span>
                      </div>
                      <p className="text-body-sm" style={{ opacity: 0.8 }}>{concept.definition}</p>
                      <div className="structural-tag">↳ LINKED TO: GRAPH</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'cards' && (
            <div>
              {data.cards.length === 0 ? (
                <div className="processing-block">NO CARDS GENERATED FROM THIS NOTE YET.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {data.cards.map((card) => (
                    <div key={card.id} className="bento-tile">
                      <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                        <span className="mono-tag">{card.card_type === 'cloze' ? 'CLOZE' : 'Q&A'}</span>
                        <span className={`mono-tag ${card.status === 'new' ? 'mono-tag-signal' : ''}`}>
                          {card.status.toUpperCase()}
                        </span>
                      </div>
                      <div style={{ borderBottom: '2px solid var(--ink)', paddingBottom: '10px', marginBottom: '10px' }}>
                        <div className="text-mono" style={{ opacity: 0.5, marginBottom: '4px', fontSize: '11px' }}>FRONT</div>
                        <p className="text-body-sm" style={{ fontWeight: 600 }}>{card.front}</p>
                      </div>
                      <div>
                        <div className="text-mono" style={{ opacity: 0.5, marginBottom: '4px', fontSize: '11px' }}>BACK</div>
                        <p className="text-body-sm">{card.back}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const UNSAFE_PROTOCOL = /^(javascript|vbscript|data|file):/i;

function renderMarkdown(content: string): string {
  // Escape raw HTML so notes can't inject markup (`>` is kept so blockquote syntax
  // still parses; `<` alone can't open a tag). Unsafe link/image protocols are
  // dropped in the renderer overrides below (marked v12 no longer strips them).
  const escaped = content.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return marked.parse(escaped, {
    gfm: true,
    breaks: true,
    renderer: {
      link({ href, title, text }: { href: string; title: string | null; text: string }) {
        if (!href || UNSAFE_PROTOCOL.test(href.trim())) return text;
        const safeHref = href.replace(/"/g, '&quot;');
        const safeTitle = title ? ` title="${title.replace(/"/g, '&quot;')}"` : '';
        return `<a href="${safeHref}"${safeTitle}>${text}</a>`;
      },
      image({ href, title, text }: { href: string; title: string | null; text: string }) {
        if (!href || UNSAFE_PROTOCOL.test(href.trim())) return text;
        const safeSrc = href.replace(/"/g, '&quot;');
        const safeTitle = title ? ` title="${title.replace(/"/g, '&quot;')}"` : '';
        return `<img src="${safeSrc}" alt="${text.replace(/"/g, '&quot;')}"${safeTitle}>`;
      },
    } as any,
  }) as string;
}
