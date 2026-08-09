'use client';

// ============================================================
// Connection status indicator (Part 2 — offline support).
//
// Shows a fixed banner when the browser reports being offline
// ("SHOWING SAVED DATA" — the service worker serves cached pages),
// and a brief "BACK ONLINE" toast when connectivity returns.
// navigator.onLine is re-checked on visibility change because
// mobile browsers can report a stale value.
// ============================================================

import { useEffect, useState } from 'react';

const BACK_ONLINE_DURATION_MS = 2500;

export default function ConnectionStatus() {
  const [offline, setOffline] = useState(false);
  const [justBackOnline, setJustBackOnline] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let backOnlineTimer: ReturnType<typeof setTimeout> | undefined;

    // Single source of truth for the current connectivity state.
    const syncState = () => setOffline(!navigator.onLine);

    const handleOnline = () => {
      syncState();
      setJustBackOnline(true);
      if (backOnlineTimer) clearTimeout(backOnlineTimer);
      backOnlineTimer = setTimeout(() => setJustBackOnline(false), BACK_ONLINE_DURATION_MS);
    };

    const handleOffline = () => {
      syncState();
      setJustBackOnline(false);
      if (backOnlineTimer) clearTimeout(backOnlineTimer);
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') syncState();
    };

    syncState();

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibility);
      if (backOnlineTimer) clearTimeout(backOnlineTimer);
    };
  }, []);

  if (offline) {
    return (
      <div className="connection-banner connection-banner--offline" role="status" id="conn-offline">
        OFFLINE — SHOWING SAVED DATA. CHANGES SYNC WHEN YOU&rsquo;RE BACK.
      </div>
    );
  }

  if (justBackOnline) {
    return (
      <div className="connection-banner connection-banner--online" role="status" id="conn-online">
        BACK ONLINE ✓ — SYNC RESUMED
      </div>
    );
  }

  return null;
}
