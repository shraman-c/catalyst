'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTheme } from '@/lib/ThemeProvider';

interface Preferences {
  card_density: number;
  graph_verbosity: string;
}

interface UserInfo {
  id: string;
  email: string;
  name: string | null;
}

const DENSITY_OPTIONS = [
  { value: 10, label: 'FEWER', description: '10 new cards per day' },
  { value: 20, label: 'STANDARD', description: '20 new cards per day (default)' },
  { value: 40, label: 'MORE', description: '40 new cards per day' },
];

const VERBOSITY_OPTIONS = [
  { value: 'concise', label: 'CONCISE', description: 'Short relationship labels' },
  { value: 'standard', label: 'STANDARD', description: 'Descriptive relationship labels (default)' },
  { value: 'detailed', label: 'DETAILED', description: 'Full relationship explanations' },
];

export default function SettingsPage() {
  const router = useRouter();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [prefs, setPrefs] = useState<Preferences>({ card_density: 20, graph_verbosity: 'standard' });
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);

  const fetchSettings = useCallback(async () => {
    const res = await fetch('/api/settings');
    if (res.status === 401) { router.push('/'); return; }
    if (res.ok) {
      const data = await res.json();
      setPrefs(data.prefs);
      setUser(data.user);
    }
    setLoading(false);
  }, [router]);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  async function saveSettings() {
    setSaving(true);
    setSaved(false);
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prefs),
    });
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  async function handleExport(format: 'json' | 'csv') {
    setExporting(true);
    try {
      const res = await fetch(`/api/export?format=${format}`);
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `synthesizer-export-${new Date().toISOString().split('T')[0]}.${format}`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
    } catch (err) {
      console.error('Export failed:', err);
    }
    setExporting(false);
  }

  async function handleDeleteAccount() {
    if (deleteConfirm !== user?.email) return;
    
    setDeleting(true);
    try {
      const res = await fetch('/api/delete?type=account', { method: 'DELETE' });
      if (res.ok) {
        // Account deleted, redirect to home
        router.push('/');
      }
    } catch (err) {
      console.error('Delete failed:', err);
    }
    setDeleting(false);
  }

  return (
    <div className="page-container" style={{ maxWidth: '800px', margin: '0 auto' }}>

      {/* Breadcrumb */}
      <div className="breadcrumb">
        <Link href="/dashboard" className="text-mono" style={{ opacity: 0.6, textDecoration: 'none' }}>DASHBOARD</Link>
        <span className="text-mono" style={{ opacity: 0.4 }}>›</span>
        <span className="text-mono">SETTINGS</span>
      </div>

      <h1 className="text-display-lg" style={{ marginBottom: '28px' }}>SETTINGS</h1>

      {loading ? (
        <div className="processing-block">LOADING...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

          {/* Account section */}
          <div className="bento-tile">
            <h2 className="text-display-md" style={{ marginBottom: '16px' }}>ACCOUNT</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '12px', alignItems: 'center' }}>
              <span className="text-mono" style={{ opacity: 0.6 }}>EMAIL</span>
              <span className="text-body-sm">{user?.email ?? '—'}</span>
              <span className="text-mono" style={{ opacity: 0.6 }}>NAME</span>
              <span className="text-body-sm">{user?.name ?? '—'}</span>
            </div>
          </div>

          {/* Theme section */}
          <div className="bento-tile">
            <h2 className="text-display-md" style={{ marginBottom: '6px' }}>APPEARANCE</h2>
            <p className="text-body-sm" style={{ opacity: 0.6, marginBottom: '16px' }}>
              Choose your preferred color theme. System will follow your OS setting.
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              {([
                { value: 'light' as const, label: 'LIGHT', icon: '☀️' },
                { value: 'dark' as const, label: 'DARK', icon: '🌙' },
                { value: 'system' as const, label: 'SYSTEM', icon: '💻' },
              ]).map(opt => (
                <button
                  key={opt.value}
                  className={`btn ${theme === opt.value ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setTheme(opt.value)}
                  style={{ flex: 1, flexDirection: 'column', padding: '12px 8px', height: 'auto' }}
                >
                  <span style={{ fontSize: '20px' }}>{opt.icon}</span>
                  <div style={{ fontWeight: 700, marginTop: '4px' }}>{opt.label}</div>
                  {opt.value === 'system' && (
                    <div style={{ fontSize: '11px', opacity: 0.7, marginTop: '2px' }}>
                      Currently: {resolvedTheme.toUpperCase()}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Card density section */}
          <div className="bento-tile">
            <h2 className="text-display-md" style={{ marginBottom: '6px' }}>CARD DENSITY</h2>
            <p className="text-body-sm" style={{ opacity: 0.6, marginBottom: '16px' }}>
              How many new cards to introduce per day. Cards already in your review schedule are not affected.
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              {DENSITY_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  className={`btn ${prefs.card_density === opt.value ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setPrefs(p => ({ ...p, card_density: opt.value }))}
                  id={`density-${opt.label.toLowerCase()}`}
                  style={{ flex: 1, flexDirection: 'column', padding: '12px 8px', height: 'auto' }}
                >
                  <div style={{ fontWeight: 700 }}>{opt.label}</div>
                  <div style={{ fontSize: '11px', opacity: 0.7, marginTop: '4px' }}>{opt.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Graph verbosity section */}
          <div className="bento-tile">
            <h2 className="text-display-md" style={{ marginBottom: '6px' }}>GRAPH VERBOSITY</h2>
            <p className="text-body-sm" style={{ opacity: 0.6, marginBottom: '16px' }}>
              Controls how detailed the relationship labels are on graph edges generated by the AI.
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              {VERBOSITY_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  className={`btn ${prefs.graph_verbosity === opt.value ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setPrefs(p => ({ ...p, graph_verbosity: opt.value }))}
                  id={`verbosity-${opt.value}`}
                  style={{ flex: 1, flexDirection: 'column', padding: '12px 8px', height: 'auto' }}
                >
                  <div style={{ fontWeight: 700 }}>{opt.label}</div>
                  <div style={{ fontSize: '11px', opacity: 0.7, marginTop: '4px' }}>{opt.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Devices section */}
          <div className="bento-tile">
            <h2 className="text-display-md" style={{ marginBottom: '6px' }}>WATCHER DEVICES</h2>
            <p className="text-body-sm" style={{ opacity: 0.6, marginBottom: '16px' }}>
              Connect desktop watcher instances to automatically sync local note folders.
            </p>
            <Link href="/dashboard/devices" className="btn btn-secondary" style={{ textDecoration: 'none' }}>
              MANAGE DEVICES →
            </Link>
          </div>

          {/* Data Export (Stage 5) */}
          <div className="bento-tile">
            <h2 className="text-display-md" style={{ marginBottom: '6px' }}>DATA EXPORT</h2>
            <p className="text-body-sm" style={{ opacity: 0.6, marginBottom: '16px' }}>
              Export all your notes, graph, and flashcards. Your data belongs to you.
            </p>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                className="btn btn-secondary"
                onClick={() => handleExport('json')}
                disabled={exporting}
                style={{ flex: 1, minWidth: '120px' }}
              >
                {exporting ? 'EXPORTING...' : 'EXPORT JSON'}
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => handleExport('csv')}
                disabled={exporting}
                style={{ flex: 1, minWidth: '120px' }}
              >
                {exporting ? 'EXPORTING...' : 'EXPORT CSV'}
              </button>
            </div>
          </div>

          {/* Data & Privacy (Stage 5) */}
          <div className="bento-tile" style={{ borderStyle: 'dashed' }}>
            <h2 className="text-display-md" style={{ marginBottom: '6px' }}>DATA & PRIVACY</h2>
            <p className="text-body-sm" style={{ opacity: 0.6, marginBottom: '12px' }}>
              Delete your account and all associated notes, graph, and cards. This action cannot be undone.
            </p>
            <div className="alert-block" style={{ marginBottom: '12px' }}>
              WARNING: This will permanently delete all your data including:
              <ul style={{ marginTop: '8px', paddingLeft: '20px' }}>
                <li>All subjects and notes</li>
                <li>Knowledge graphs and relationships</li>
                <li>Flashcards and review history</li>
                <li>Device connections</li>
              </ul>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                className="input-ink"
                type="email"
                placeholder="Type your email to confirm"
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                style={{ flex: 1, maxWidth: '300px' }}
              />
              <button
                className="btn btn-destructive"
                onClick={handleDeleteAccount}
                disabled={deleteConfirm !== user?.email || deleting}
              >
                {deleting ? 'DELETING...' : 'DELETE ACCOUNT'}
              </button>
            </div>
          </div>

          {/* Save button */}
          <div className="flex gap-3 items-center">
            <button
              className="btn btn-primary"
              onClick={saveSettings}
              disabled={saving}
              id="save-settings-btn"
            >
              {saving ? 'SAVING...' : 'SAVE SETTINGS'}
            </button>
            {saved && <span className="mono-tag mono-tag-link">SAVED ✓</span>}
          </div>

        </div>
      )}
    </div>
  );
}