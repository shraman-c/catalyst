'use client';

// ============================================================
// PWA install UI (Part 1 — PWA Installability).
//
// Captures `beforeinstallprompt`, suppresses the browser's
// automatic banner, and lets the app surface its own install
// button (design.md §4.1 styling) in two places:
//   - PWAInstallCard: a dismissible one-time card on the
//     dashboard, shown only after a student's first successful
//     review session (never on first page load).
//   - PWAInstallSection: an always-available "Install App" row
//     in Settings, with an iOS "Add to Home Screen" fallback.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import {
  isStandalone,
  isIOS,
  dismissInstallPrompt,
  hasCompletedReview,
  wasInstallPromptDismissed,
} from '@/lib/pwa';

/** Shape of Chrome/Edge's `beforeinstallprompt` event. */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function usePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    setIsInstalled(isStandalone());

    const onBeforeInstallPrompt = (e: Event) => {
      // Suppress the automatic browser banner; we trigger the prompt
      // ourselves from app UI (settings / post-review dashboard card).
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const onAppInstalled = () => setIsInstalled(true);

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<boolean> => {
    if (!deferredPrompt) return false;
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      return choice.outcome === 'accepted';
    } catch {
      // prompt() can reject if the prompt was already used or is unavailable.
      return false;
    } finally {
      // A deferred prompt can only be used once — discard it either way.
      setDeferredPrompt(null);
    }
  }, [deferredPrompt]);

  return { canInstall: !!deferredPrompt, isInstalled, promptInstall };
}

/* ------------------------------------------------------------------ */
/* Dashboard card — one-time, dismissible, post-first-review           */
/* ------------------------------------------------------------------ */

export function PWAInstallCard() {
  const { canInstall, isInstalled, promptInstall } = usePwaInstall();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Gated on a completed review session + not dismissed + not installed,
    // so it never appears on a first page load. Symmetric: hides again once
    // the native prompt is consumed, the app gets installed, or the user
    // dismisses the card.
    const eligible =
      canInstall && !isInstalled && hasCompletedReview() && !wasInstallPromptDismissed();
    setVisible(eligible);
  }, [canInstall, isInstalled]);

  if (!visible) return null;

  return (
    <div
      className="bento-tile bento-tile-signal shadow-hard"
      style={{
        marginBottom: '16px',
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        flexWrap: 'wrap',
      }}
      id="install-pwa-card"
    >
      <img
        src="/icons/icon-192x192.png"
        alt="Catalyst app icon"
        width={48}
        height={48}
        style={{ border: '3px solid var(--ink)', flexShrink: 0 }}
      />
      <div style={{ flex: '1 1 240px', minWidth: 0 }}>
        <h2 className="text-display-md" style={{ marginBottom: '4px' }}>
          INSTALL CATALYST
        </h2>
        <p className="text-body-sm" style={{ opacity: 0.85 }}>
          Add Catalyst to your home screen for one-tap access to your notes, graphs, and
          flashcards — it opens in its own app window.
        </p>
      </div>
      <div className="flex gap-2" style={{ flexShrink: 0 }}>
        <button
          className="btn btn-primary"
          onClick={async () => {
            const accepted = await promptInstall();
            if (accepted) setVisible(false);
          }}
          id="install-pwa-accept"
        >
          INSTALL APP
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => {
            dismissInstallPrompt();
            setVisible(false);
          }}
          id="install-pwa-dismiss"
        >
          NOT NOW
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Settings section — always reachable, with iOS fallback              */
/* ------------------------------------------------------------------ */

export function PWAInstallSection() {
  const { canInstall, isInstalled, promptInstall } = usePwaInstall();
  const [ios, setIos] = useState(false);

  useEffect(() => {
    setIos(isIOS());
  }, []);

  return (
    <div className="bento-tile">
      <h2 className="text-display-md" style={{ marginBottom: '6px' }}>INSTALL APP</h2>
      <p className="text-body-sm" style={{ opacity: 0.6, marginBottom: '16px' }}>
        Run Catalyst from your home screen like a native app. Works offline-first and opens in
        its own window.
      </p>

      {isInstalled ? (
        <div className="flex gap-2 items-center">
          <span className="mono-tag mono-tag-link">INSTALLED ✓</span>
          <span className="text-body-sm" style={{ opacity: 0.6 }}>
            Catalyst is installed on this device.
          </span>
        </div>
      ) : canInstall ? (
        <button
          className="btn btn-primary"
          onClick={() => { void promptInstall(); }}
          style={{ width: 'fit-content' }}
          id="install-app-btn"
        >
          INSTALL APP
        </button>
      ) : ios ? (
        <div className="processing-block" style={{ maxWidth: '480px' }}>
          ON IPHONE / IPAD: OPEN THIS PAGE IN SAFARI, TAP THE SHARE BUTTON, THEN
          &ldquo;ADD TO HOME SCREEN&rdquo;.
        </div>
      ) : (
        <p className="text-mono" style={{ opacity: 0.6 }}>
          INSTALL IS AVAILABLE IN CHROME / EDGE ON ANDROID AND DESKTOP.
        </p>
      )}
    </div>
  );
}
