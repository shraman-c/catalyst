'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface Device {
  id: string;
  name: string | null;
  folder_path: string | null;
  subject_id: string | null;
  last_sync_at: string | null;
}

export default function DevicesPage() {
  const router = useRouter();
  const [devices, setDevices] = useState<Device[]>([]);
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [codeExpiry, setCodeExpiry] = useState(0);

  const fetchDevices = useCallback(async () => {
    const res = await fetch('/api/devices/pair');
    if (res.status === 401) { router.push('/'); return; }
    if (res.ok) {
      const data = await res.json();
      setDevices(data.devices ?? []);
      setPendingCode(data.pending_code);
    }
    setLoading(false);
  }, [router]);

  useEffect(() => { fetchDevices(); }, [fetchDevices]);

  // Countdown timer for pairing code expiry
  useEffect(() => {
    if (!pendingCode) return;
    setCodeExpiry(300); // 5 min
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
    const res = await fetch('/api/devices/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'generate_code' }),
    });
    if (res.ok) {
      const data = await res.json();
      setPendingCode(data.pairing_code);
    }
    setGenerating(false);
  }

  async function revokeDevice(deviceId: string, name: string | null) {
    if (!confirm(`Disconnect "${name || 'this device'}"? It will stop syncing.`)) return;
    setRevoking(deviceId);
    await fetch('/api/devices/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'revoke', device_id: deviceId }),
    });
    setRevoking(null);
    fetchDevices();
  }

  function formatLastSync(ts: string | null): string {
    if (!ts) return 'never';
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  const minutesLeft = Math.floor(codeExpiry / 60);
  const secondsLeft = codeExpiry % 60;

  return (
    <div style={{ padding: '32px 40px', maxWidth: '760px' }}>

      {/* Breadcrumb */}
      <div className="flex items-center gap-2" style={{ marginBottom: '16px' }}>
        <Link href="/dashboard" className="text-mono" style={{ opacity: 0.6, textDecoration: 'none' }}>DASHBOARD</Link>
        <span className="text-mono" style={{ opacity: 0.4 }}>›</span>
        <Link href="/dashboard/settings" className="text-mono" style={{ opacity: 0.6, textDecoration: 'none' }}>SETTINGS</Link>
        <span className="text-mono" style={{ opacity: 0.4 }}>›</span>
        <span className="text-mono">DEVICES</span>
      </div>

      <h1 className="text-display-lg" style={{ marginBottom: '8px' }}>WATCHER DEVICES</h1>
      <p className="text-body-sm" style={{ opacity: 0.6, marginBottom: '28px' }}>
        The watcher is a lightweight script that monitors a local folder and automatically syncs note changes to your dashboard.
      </p>

      {loading ? (
        <div className="processing-block">LOADING DEVICES...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

          {/* Pairing section */}
          <div className="bento-tile">
            <h2 className="text-display-md" style={{ marginBottom: '12px' }}>PAIR A NEW DEVICE</h2>

            {pendingCode ? (
              <div>
                <p className="text-body-sm" style={{ opacity: 0.7, marginBottom: '16px' }}>
                  Run the watcher on your computer and enter this code when prompted:
                </p>
                <div
                  style={{
                    display: 'inline-block',
                    backgroundColor: 'var(--ink)',
                    color: 'var(--base)',
                    padding: '16px 32px',
                    fontSize: '36px',
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span className="text-mono" style={{ opacity: 0.6 }}>
                    EXPIRES IN {minutesLeft}:{String(secondsLeft).padStart(2, '0')}
                  </span>
                  <button className="btn btn-ghost" style={{ fontSize: '12px' }} onClick={generateCode}>
                    REGENERATE
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <p className="text-body-sm" style={{ opacity: 0.7, marginBottom: '16px' }}>
                  Generate a pairing code, then run the watcher script and enter the code.
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

          {/* Watcher setup instructions */}
          <div className="bento-tile bento-tile-mono">
            <h2 className="text-display-md" style={{ marginBottom: '12px' }}>SETUP INSTRUCTIONS</h2>
            <ol style={{ paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {[
                'Install Node.js 18+ on your computer',
                'Download the watcher script from the watcher/ folder in the repo',
                'Run: npm install (in the watcher/ directory)',
                `Run: node index.js --server ${typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3001'}`,
                'Enter the pairing code shown above when prompted',
                'Choose which local folder to watch and which Subject to sync it to',
                'The watcher will run in the background — edit notes normally and watch your dashboard update',
              ].map((step, i) => (
                <li key={i} className="text-body-sm" style={{ opacity: 0.8 }}>
                  <span className="mono-tag" style={{ marginRight: '8px', display: 'inline-block', minWidth: '24px', textAlign: 'center' }}>{i + 1}</span>
                  {step}
                </li>
              ))}
            </ol>
          </div>

          {/* Connected devices */}
          <div>
            <h2 className="text-display-md" style={{ marginBottom: '12px' }}>CONNECTED DEVICES ({devices.length})</h2>
            {devices.length === 0 ? (
              <div className="empty-state" style={{ padding: '32px' }}>
                <p className="empty-state__text" style={{ marginBottom: '8px' }}>NO DEVICES CONNECTED.</p>
                <p className="text-body-sm" style={{ opacity: 0.6 }}>Pair a device above to start auto-syncing.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {devices.map(device => (
                  <div
                    key={device.id}
                    className="bento-tile"
                    style={{ display: 'grid', gridTemplateColumns: '1fr 140px 120px', gap: '12px', alignItems: 'center', padding: '16px' }}
                  >
                    <div>
                      <div className="text-body-sm" style={{ fontWeight: 700, marginBottom: '4px' }}>
                        {device.name || 'Unnamed Device'}
                      </div>
                      <div className="text-mono" style={{ opacity: 0.5, fontSize: '12px' }}>
                        {device.folder_path || 'No folder configured'}
                      </div>
                    </div>
                    <div>
                      <div className="mono-tag mono-tag-link" style={{ marginBottom: '4px' }}>CONNECTED</div>
                      <div className="text-mono" style={{ opacity: 0.5, fontSize: '11px' }}>
                        LAST SYNC: {formatLastSync(device.last_sync_at)}
                      </div>
                    </div>
                    <button
                      className="btn btn-destructive"
                      style={{ fontSize: '12px' }}
                      onClick={() => revokeDevice(device.id, device.name)}
                      disabled={revoking === device.id}
                      id={`revoke-${device.id}`}
                    >
                      {revoking === device.id ? 'DISCONNECTING...' : 'DISCONNECT'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}
