// ============================================================
// Note-editor draft autosave (localStorage).
//
// The paste-note editor's content is saved here so unsaved text survives
// anything that navigates away or closes the tab: the cross-tab logout
// sync, an accidental reload, or a closed browser window. Drafts are
// keyed per subject so editing several subjects never collides.
//
// Storage can be blocked (private mode) or full, so every access is
// best-effort and never throws. Note: drafts share the per-origin
// localStorage quota (~5MB) — a single note at the 2MB upload cap plus
// other subjects' drafts can approach it, in which case the write is
// silently skipped.
// ============================================================

export interface NoteDraft {
  content: string;
  filename: string;
  savedAt: number;
}

const DRAFT_PREFIX = 'catalyst-note-draft:';

function draftKey(subjectId: string): string {
  return `${DRAFT_PREFIX}${subjectId}`;
}

/** Load a previously saved draft for a subject, or null when absent/corrupt. */
export function loadDraft(subjectId: string): NoteDraft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(subjectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<NoteDraft>;
    if (typeof parsed.content !== 'string') return null;
    return {
      content: parsed.content,
      filename: typeof parsed.filename === 'string' ? parsed.filename : '',
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

/**
 * Persist the current editor state. Empty content is deliberately NOT a
 * deletion here — clearing only happens through the explicit paths
 * (successful upload / DISCARD). This keeps a just-restored draft safe
 * during the mount/unmount churn React StrictMode performs in dev.
 */
export function saveDraft(subjectId: string, content: string, filename: string): void {
  try {
    if (!content.trim()) return;
    window.localStorage.setItem(
      draftKey(subjectId),
      JSON.stringify({ content, filename, savedAt: Date.now() } satisfies NoteDraft)
    );
  } catch {
    // Best-effort.
  }
}

/** Remove the saved draft (after a successful upload or explicit discard). */
export function clearDraft(subjectId: string): void {
  try {
    window.localStorage.removeItem(draftKey(subjectId));
  } catch {
    // Best-effort.
  }
}
