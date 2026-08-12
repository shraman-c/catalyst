// ============================================================
// Client-side helpers for PWA installability (Part 1 of the
// PWA Install / Offline Sync / Device Sessions bundle).
//
// All functions are safe to call during SSR (they no-op when
// `window` is unavailable). UI for these lives in
// src/components/PWAInstall.tsx.
// ============================================================

/** Set once a student finishes their first review session. */
export const REVIEW_COMPLETED_KEY = 'catalyst-review-completed';

/** Set when the user dismisses the one-time dashboard install card. */
export const INSTALL_DISMISSED_KEY = 'catalyst-install-dismissed';

/** True when the app is already running as an installed PWA. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** True on iPhone / iPad / iPod (Safari has no beforeinstallprompt). */
export function isIOS(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS 13+ reports as a Mac in the UA; touch + MacIntel is the giveaway.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

export function markReviewCompleted(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(REVIEW_COMPLETED_KEY, '1');
  } catch {
    // storage unavailable (private mode) — degrade gracefully
  }
}

export function hasCompletedReview(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(REVIEW_COMPLETED_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissInstallPrompt(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
  } catch {
    // ignore
  }
}

export function wasInstallPromptDismissed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(INSTALL_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}
