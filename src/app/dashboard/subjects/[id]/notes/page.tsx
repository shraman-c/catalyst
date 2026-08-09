'use client';

import { useEffect, useState, useCallback, useRef, type KeyboardEvent } from 'react';
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

interface SearchResult {
  id: string;
  filename: string;
  updated_at: string;
  subject_name: string;
  match_count: number;
  filename_matched: boolean;
  snippets: string[];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Renders `text` with case-insensitive occurrences of `query` wrapped in <mark>. */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  // escapeRegExp output is regex-safe by construction, so this cannot throw.
  const re = new RegExp(`(${escapeRegExp(q)})`, 'gi');
  const needle = q.toLowerCase();
  return (
    <>
      {text.split(re).map((part, i) =>
        part.toLowerCase() === needle ? (
          <mark key={i} className="search-highlight">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
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

  // Full-text content search (audit-adjacent feature; decrypt-then-scan on the server)
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Sequence guard: drops responses from stale (superseded) search requests
  // so a slow older request can't overwrite newer results.
  const searchSeqRef = useRef(0);
  // Keyboard navigation over the visible result list (arrows / Enter / Esc).
  // -1 = nothing selected; otherwise an index into searchResults.
  const [activeIndex, setActiveIndex] = useState(-1);

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

  // Clear any pending debounce timer on unmount
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  // Reset the active row whenever a new result set arrives (auto-select first).
  useEffect(() => {
    setActiveIndex(searchResults && searchResults.length > 0 ? 0 : -1);
  }, [searchResults]);

  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) {
      searchSeqRef.current++;
      setSearchResults(null);
      setSearching(false);
      return;
    }
    const seq = ++searchSeqRef.current;
    setSearching(true);
    try {
      const res = await fetch(
        `/api/notes/search?q=${encodeURIComponent(trimmed)}&subject_id=${encodeURIComponent(subjectId)}`
      );
      if (seq !== searchSeqRef.current) return; // superseded by a newer search
      if (res.status === 401) {
        setSearching(false);
        router.push('/');
        return;
      }
      const data = res.ok ? await res.json() : { results: [] };
      if (seq !== searchSeqRef.current) return;
      setSearchResults(data.results || []);
    } catch {
      if (seq !== searchSeqRef.current) return;
      setSearchResults([]);
    }
    if (seq === searchSeqRef.current) setSearching(false);
  }, [subjectId, router]);

  function handleSearchChange(value: string) {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(value), 300);
  }

  function clearSearch() {
    searchSeqRef.current++; // invalidate any in-flight search
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSearchQuery('');
    setSearchResults(null);
    setSearching(false);
  }

  function openResult(result: SearchResult | undefined) {
    if (!result) return;
    router.push(`/dashboard/subjects/${subjectId}/notes/${result.id}`);
  }

  /** Arrow keys move the active row (wrapping), Enter opens it, Esc clears. */
  function handleSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      if (searchQuery) {
        e.preventDefault();
        clearSearch();
      }
      return;
    }
    // Don't navigate while a search is in flight: the listbox still shows the
    // previous query's results, and Enter could open a stale note.
    if (searching) return;
    const results = searchResults ?? [];
    if (results.length === 0) return;
    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const next = activeIndex < 0 ? 0 : (activeIndex + 1) % results.length;
        setActiveIndex(next);
        // Scroll imperatively here (not in an effect) so the page only moves
        // on manual arrow navigation — never on auto-select of a new batch.
        document.getElementById(`search-result-${next}`)?.scrollIntoView({ block: 'nearest' });
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const next = activeIndex <= 0 ? results.length - 1 : activeIndex - 1;
        setActiveIndex(next);
        document.getElementById(`search-result-${next}`)?.scrollIntoView({ block: 'nearest' });
        break;
      }
      case 'Enter':
        e.preventDefault();
        openResult(results[activeIndex >= 0 ? activeIndex : 0]);
        break;
    }
  }

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

  const searchingActive = searchQuery.trim().length > 0;

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
          <p className="text-mono" style={{ opacity: 0.6, marginTop: '4px' }}>
            {searchingActive
              ? 'SEARCH RESULTS'
              : `${notes.length} FILES SYNCED`}
          </p>
        </div>
        <Link href={`/dashboard/subjects/${subjectId}`} className="btn btn-primary" style={{ textDecoration: 'none' }}>
          + ADD NOTE
        </Link>
      </div>

      {/* Full-text content search — a form so the mobile keyboard's Search/Go
          key works (it fires submit, not keydown); Enter here runs instantly. */}
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (debounceRef.current) clearTimeout(debounceRef.current);
          runSearch(searchQuery);
        }}
        style={{ marginBottom: '20px', display: 'flex', gap: '8px', alignItems: 'center' }}
      >
        <input
          className="input-ink"
          type="search"
          placeholder="SEARCH NOTE CONTENT…"
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          aria-label="Search note content"
          role="combobox"
          aria-expanded={searchingActive && (searchResults?.length ?? 0) > 0}
          aria-controls="search-results"
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? `search-result-${activeIndex}` : undefined}
          style={{ maxWidth: '480px' }}
        />
        {searchQuery && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={clearSearch}
            aria-label="Clear search"
            style={{ padding: '10px 14px', fontSize: '14px' }}
          >
            ✕
          </button>
        )}
      </form>

      {loading && !searchingActive ? (
        <div className="processing-block">LOADING NOTES...</div>
      ) : searchingActive ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <p className="text-mono" style={{ opacity: 0.6, marginBottom: '4px' }}>
            {searching
              ? `SEARCHING FOR "${searchQuery.trim().toUpperCase()}"…`
              : `${searchResults?.length ?? 0} MATCH(ES) FOR "${searchQuery.trim().toUpperCase()}"`}
          </p>

          {!searching && (searchResults?.length ?? 0) === 0 ? (
            <div className="empty-state">
              <p className="empty-state__text">NO MATCHES.</p>
              <p className="text-mono" style={{ opacity: 0.5, marginTop: '8px' }}>
                SEARCH FILENAMES AND NOTE CONTENT
              </p>
            </div>
          ) : (
            <div id="search-results" role="listbox" aria-label="Note search results" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {(searchResults ?? []).map((result, resultIndex) => (
                <Link
                  key={result.id}
                  id={`search-result-${resultIndex}`}
                  href={`/dashboard/subjects/${subjectId}/notes/${result.id}`}
                  className="bento-tile bento-tile-hoverable"
                  role="option"
                  aria-selected={resultIndex === activeIndex}
                  style={{
                    textDecoration: 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    borderColor: resultIndex === activeIndex ? 'var(--signal)' : undefined,
                    backgroundColor: resultIndex === activeIndex ? 'var(--mono-panel)' : undefined,
                  }}
                >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span className="text-body-sm" style={{ fontWeight: 600 }}>{result.filename}</span>
                  <span className="mono-tag">
                    {result.match_count} MATCH{result.match_count === 1 ? '' : 'ES'}
                  </span>
                </div>
                {result.filename_matched && (
                  <span className="mono-tag mono-tag-signal" style={{ width: 'fit-content' }}>FILENAME MATCH</span>
                )}
                {result.snippets.map((snippet, i) => (
                  <p key={i} className="text-body-sm" style={{ opacity: 0.85, margin: 0 }}>
                    <Highlight text={snippet} query={searchQuery} />
                  </p>
                ))}
              </Link>
              ))}
            </div>
          )}
        </div>
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
