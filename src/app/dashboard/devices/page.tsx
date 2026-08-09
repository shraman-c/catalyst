'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface UnifiedDevice {
  id: string;
  type: 'browser_session' | 'sync_watcher';
  label: string;
  detail: string | null;
  ip_address: string | null;
  last_active_at: string | null;
  created_at: string;
}

function formatAgo(ts: string | null): string {
  if (!ts) return 'never';
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

export default function DevicesPage() {
  const router = useRouter();
  const [devices, setDevices] = useState<UnifiedDevice[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);

  // Collapsed watcher pairing (kept functional, de-emphasized — Part 3 moved
  // the page's focus to the unified device list).
  const [pairingOpen, setPairingOpen] = useState(false);
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [codeExpiry, setCodeExpiry] = useState(0);

  const fetchDevices = useCallback(async () => {
    const res = await fetch('/api/devices');
    if (res.status === 401) { router.push('/'); return; }
    if (res.ok) {
      const data = await res.json();
      setDevices(data.devices ?? []);
      setCurrentSessionId(data.current_session_id ?? null);
    }
    setLoading(false);
  }, [router]);

  useEffect(() => { fetchDevices(); }, [fetchDevices]);

  // Countdown timer for the pairing code (5 min, mirrors the server's TTL)
  useEffect(() => {
    if (!pendingCode) return;
    setCodeExpiry(300);
    const interval = setInterval(() => {
      setCodeExpiry(t => {
        if (t <= 1) {
          clearInterval(interval);
          setPendingCode(null);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [pendingCode]);

  async function generateCode() {
    setGenerating(true);
    try {
      const res = await fetch('/api/devices/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate_code' }),
      });
      if (res.status === 401) { router.push('/'); return; }
      if (res.ok) {
        const data = await res.json();
        setPendingCode(data.pairing_code);
      }
    } finally {
      setGenerating(false);
    }
  }

  async function revokeDevice(device: UnifiedDevice) {
    const which = device.type === 'sync_watcher' ? `"${device.label}"` : device.label;
    const suffix = device.type === 'browser_session'
      ? 'It will be signed out immediately and must log in again.'
      : 'It will stop syncing immediately.';
    if (!confirm(`Revoke ${which}? ${suffix}`)) return;

    setRevoking(device.id);
    try {
      const res = await fetch(
        `/api/devices/${encodeURIComponent(device.id)}?type=${device.type}`,
        { method: 'DELETE' }
      );
      if (res.status === 401) { router.push('/'); return; }
      if (res.ok) {
        const data = await res.json();
        if (data.revoked_current) {
          // Revoked our own session — the server cleared the cookie.
          router.push('/');
          router.refresh();
          return;
        }
        await fetchDevices();
      }
    } finally {
      setRevoking(null);
    }
  }

  const browserCount = devices.filter(d => d.type === 'browser_session').length;
  const watcherCount = devices.filter(d => d.type === 'sync_watcher').length;
  const minutesLeft = Math.floor(codeExpiry / 60);
  const secondsLeft = codeExpiry % 60;

  return (
    <div className="page-container" style={{ maxWidth: '760px', margin: '0 auto' }}>

      {/* Breadcrumb */}
      <div className="breadcrumb">
        <Link href="/dashboard" className="text-mono" style={{ opacity: 0.6, textDecoration: 'none' }}>DASHBOARD</Link>
        <span className="text-mono" style={{ opacity: 0.4 }}>›</span>
        <span className="text-mono">DEVICES</span>
      </div>

      <h1 className="text-display-lg" style={{ marginBottom: '8px' }}>DEVICES &amp; SESSIONS</h1>
      <p className="text-body-sm" style={{ opacity: 0.6, marginBottom: '28px' }}>
        Every browser logged into your account and every paired watcher instance.
        Revoke anything you don&rsquo;t recognize — it is signed out immediately.
      </p>

      {loading ? (
        <div className="processing-block">LOADING DEVICES...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* Summary strip */}
          <div className="mono-tag" style={{ width: 'fit-content' }}>
            {browserCount} BROWSER{browserCount === 1 ? '' : 'S'} · {watcherCount} WATCHER{watcherCount === 1 ? '' : 'S'}
          </div>

          {/* Device list */}
          {devices.length === 0 ? (
            <div className="empty-state" style={{ padding: '32px' }}>
              <p className="empty-state__text" style={{ marginBottom: '8px' }}>NO OTHER ACTIVE SESSIONS.</p>
              <p className="text-body-sm" style={{ opacity: 0.6 }}>
                You&rsquo;re only signed in on this device right now. New logins and paired watchers will appear here.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {devices.map(device => {
                const isCurrent = device.type === 'browser_session' && device.id === currentSessionId;
                const isBrowser = device.type === 'browser_session';
                const isWatcher = !isBrowser;
                return (
                  <div
                    key={device.id}
                    className="bento-tile"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '14px',
                      padding: '16px',
                      borderStyle: isCurrent ? 'solid' : undefined,
                    }}
                  >
                    {/* Type mark */}
                    <span
                      aria-hidden="true"
                      style={{
                        width: '40px',
                        height: '40px',
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: '3px solid var(--ink)',
                        backgroundColor: isBrowser ? 'var(--signal)' : 'var(--mono-panel)',
                        fontSize: '18px',
                        fontWeight: 700,
                        boxShadow: '3px 3px 0 var(--ink)',
                      }}
                    >
                      {isBrowser ? '⌁' : '⊞'}
                    </span>

                    {/* Label + meta */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="text-body-sm" style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        {device.label}
                        {isWatcher && <span className="mono-tag">WATCHER</span>}
                        {isCurrent && (
                          <span className="mono-tag" style={{ backgroundColor: 'var(--signal)', borderColor: 'var(--ink)' }} id="this-device-tag">
                            THIS DEVICE
                          </span>
                        )}
                      </div>
                      <div className="text-mono" style={{ opacity: 0.5, fontSize: '11px', marginTop: '4px' }}>
                        {isBrowser
                          ? `${device.detail ?? 'IP —'} · ACTIVE ${formatAgo(device.last_active_at).toUpperCase()}`
                          : `${device.detail ?? 'NO FOLDER'} · LAST SYNC ${formatAgo(device.last_active_at).toUpperCase()}`}
                      </div>
                    </div>

                    {/* Revoke */}
                    <button
                      className="btn btn-destructive"
                      style={{ fontSize: '12px', flexShrink: 0 }}
                      onClick={() => revokeDevice(device)}
                      disabled={revoking === device.id}
                      id={`revoke-${device.type}-${device.id}`}
                    >
                      {revoking === device.id ? 'REVOKING...' : 'REVOKE'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="divider-ink" style={{ margin: '8px 0' }} />

          {/* Collapsed watcher pairing (kept functional, de-emphasized) */}
          <div className="bento-tile">
            <button
              className="btn btn-ghost"
              onClick={() => setPairingOpen(o => !o)}
              aria-expanded={pairingOpen}
              style={{ width: '100%', justifyContent: 'space-between', fontSize: '13px' }}
            >
              <span>⊞ PAIR A NEW WATCHER</span>
              <span aria-hidden="true">{pairingOpen ? '▴' : '▾'}</span>
            </button>

            {pairingOpen && (
              <div style={{ marginTop: '16px' }}>
                {pendingCode ? (
                  <div>
                    <p className="text-body-sm" style={{ opacity: 0.7, marginBottom: '16px' }}>
                      Run <span className="mono-tag">node index.js --pair</span> in the watcher folder and enter this code:
                    </p>
                    <div
                      style={{
                        display: 'inline-block',
                        backgroundColor: 'var(--ink)',
                        color: 'var(--base)',
                        padding: '14px 28px',
                        fontSize: '32px',
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 700,
                        letterSpacing: '0.25em',
                        border: '4px solid var(--ink)',
                        boxShadow: '6px 6px 0 var(--signal)',
                        marginBottom: '16px',
                      }}
                      id="pairing-code-display"
                    >
                      {pendingCode}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                      <span className="text-mono" style={{ opacity: 0.6 }}>
                        EXPIRES IN {minutesLeft}:{String(secondsLeft).padStart(2, '0')}
                      </span>
                      <button className="btn btn-ghost" style={{ fontSize: '12px' }} onClick={generateCode}>
                        REGENERATE
                      </button>
                      <button className="btn btn-ghost" style={{ fontSize: '12px' }} onClick={() => setPendingCode(null)}>
                        HIDE CODE
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <p className="text-body-sm" style={{ opacity: 0.7, marginBottom: '16px' }}>
                      Generate a 6-character code, then run the watcher script on your computer and enter it to connect
                      it to this account.
                    </p>
                    <button
                      className="btn btn-primary"
                      onClick={generateCode}
                      disabled={generating}
                      id="generate-code-btn"
                    >
                      {generating ? 'GENERATING...' : 'GENERATE PAIRING CODE'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}
