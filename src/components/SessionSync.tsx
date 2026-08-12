'use client';

// ============================================================
// Cross-tab session sync (soft).
//
// The auth cookie is shared across tabs of the same browser, but a tab
// that was already open before a login/logout never re-renders — so it
// stays on the landing page and looks signed out (or keeps a stale
// dashboard after a logout elsewhere).
//
// Unlike a full page reload, this sync is deliberately non-destructive:
//  - When the change arrives, it is only *recorded*. A hidden/backgrounded
//    tab (where you might have unsaved form work) is never touched.
//  - The change is applied only when the user is actively using the tab
//    (focused) or the moment they return to it, using a soft client-side
//    navigation (router.push) instead of a reload:
//      login  + not on a dashboard page → go to /dashboard
//      logout + on a dashboard page      → go to /
//    Pages that already match the new auth state are left untouched.
//
// The `storage` event fires in EVERY OTHER tab (never the origin tab), so
// there is no self-trigger. The key is namespaced and filtered so unrelated
// localStorage writes (theme, PWA install flags) never trigger a sync.
// ============================================================

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

const AUTH_SYNC_KEY = 'catalyst-auth-sync';

type AuthChange = 'login' | 'logout';

/** Tell other open tabs that the session changed (login / logout / revoke). */
export function notifyAuthChanged(kind: AuthChange): void {
  try {
    // Value encodes the direction so the receiving tab can sync without a
    // server round-trip. The timestamp keeps the value unique so the
    // storage event always fires.
    window.localStorage.setItem(AUTH_SYNC_KEY, `${kind}:${Date.now()}`);
  } catch {
    // Best-effort — never break the auth flow (e.g. blocked storage).
  }
}

export default function SessionSync() {
  const router = useRouter();
  const pendingRef = useRef<AuthChange | null>(null);

  useEffect(() => {
    const applyPending = () => {
      const kind = pendingRef.current;
      if (!kind) return;
      pendingRef.current = null;

      const onDashboard = window.location.pathname.startsWith('/dashboard');
      if (kind === 'login' && !onDashboard) {
        router.push('/dashboard');
      } else if (kind === 'logout' && onDashboard) {
        router.push('/');
      }
    };

    const handleStorage = (e: StorageEvent) => {
      if (e.key !== AUTH_SYNC_KEY) return;
      // Value is `login:<ts>` or `logout:<ts>`; ignore clears (newValue null).
      const value = e.newValue;
      if (!value) return;
      if (value.startsWith('login')) pendingRef.current = 'login';
      else if (value.startsWith('logout')) pendingRef.current = 'logout';
      else return;

      // Apply now only if the user is actively using this tab (it has focus);
      // otherwise defer to the focus/visibility handlers below so a
      // backgrounded or split-screen tab with unsaved work is never yanked.
      if (document.hasFocus()) applyPending();
    };

    // Catch the moment the user returns to a tab that had a pending change.
    // Listen to both signals: window focus (desktop) and visibilitychange
    // (the reliable signal on iOS/Android tab switches).
    const handleFocus = () => applyPending();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') applyPending();
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [router]);

  return null;
}
