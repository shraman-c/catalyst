'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from '@/lib/ThemeProvider';

export default function HomePage() {
  const router = useRouter();
  const [mode, setMode] = useState<'landing' | 'login' | 'signup'>('landing');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const { resolvedTheme, toggleTheme } = useTheme();

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: mode, email, password, name, remember: mode === 'signup' ? true : rememberMe }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Something went wrong');
      } else {
        router.push('/dashboard');
      }
    } catch {
      setError('Network error — check your connection');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--base)', display: 'flex', flexDirection: 'column' }}>
      {/* Nav */}
      <nav className="nav-bar">
        <span className="nav-logo">CATALYST</span>
        <div className="flex gap-3 items-center" style={{ marginLeft: 'auto' }}>
          {/* Theme Toggle */}
          <button
            className="btn btn-ghost"
            onClick={toggleTheme}
            aria-label={resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            {resolvedTheme === 'dark' ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
            <span className="hide-on-mobile" style={{ fontSize: '12px', fontWeight: 600 }}>
              {resolvedTheme === 'dark' ? 'LIGHT' : 'DARK'}
            </span>
          </button>

          {mode !== 'login' && (
            <button className="btn btn-ghost" onClick={() => { setMode('login'); setError(''); }}>
              LOG IN
            </button>
          )}
          {mode !== 'signup' && (
            <button className="btn btn-primary" onClick={() => { setMode('signup'); setError(''); }}>
              GET STARTED
            </button>
          )}
        </div>
      </nav>

      {mode === 'landing' ? (
        <LandingHero onGetStarted={() => setMode('signup')} onLogin={() => setMode('login')} />
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
          <div style={{ width: '100%', maxWidth: '420px' }}>
            {/* Auth form tile */}
            <div className="bento-tile shadow-hard-lg">
              <h1 className="text-display-md" style={{ marginBottom: '24px' }}>
                {mode === 'signup' ? 'CREATE ACCOUNT' : 'WELCOME BACK'}
              </h1>

              {error && (
                <div className="alert-block" style={{ marginBottom: '16px' }}>
                  {error.toUpperCase()}
                </div>
              )}

              <form onSubmit={handleAuth} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {mode === 'signup' && (
                  <div>
                    <label className="text-mono" style={{ display: 'block', marginBottom: '4px', opacity: 0.7 }}>
                      NAME (OPTIONAL)
                    </label>
                    <input
                      className="input-ink"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your name"
                      id="auth-name"
                    />
                  </div>
                )}

                <div>
                  <label className="text-mono" style={{ display: 'block', marginBottom: '4px', opacity: 0.7 }}>
                    EMAIL
                  </label>
                  <input
                    className="input-ink"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@university.edu"
                    required
                    id="auth-email"
                  />
                </div>

                <div>
                  <label className="text-mono" style={{ display: 'block', marginBottom: '4px', opacity: 0.7 }}>
                    PASSWORD
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      className="input-ink"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      minLength={8}
                      id="auth-password"
                      style={{ paddingRight: '44px' }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      style={{
                        position: 'absolute',
                        right: '8px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: '2px',
                        color: 'var(--ink)',
                      }}
                      onFocus={(e) => {
                        e.currentTarget.style.outline = '2px solid var(--signal)';
                        e.currentTarget.style.outlineOffset = '2px';
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.outline = 'none';
                      }}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      id="toggle-password"
                    >
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{ opacity: resolvedTheme === 'dark' ? 0.9 : 0.6 }}
                      >
                        {showPassword ? (
                          <>
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </>
                        ) : (
                          <>
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                            <line x1="1" y1="1" x2="23" y2="23" />
                          </>
                        )}
                      </svg>
                    </button>
                  </div>
                </div>

                {mode === 'login' && (
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      cursor: 'pointer',
                      marginTop: '4px',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      id="auth-remember"
                      style={{
                        width: '16px',
                        height: '16px',
                        accentColor: 'var(--signal)',
                        cursor: 'pointer',
                      }}
                    />
                    <span className="text-mono" style={{ opacity: 0.7, fontSize: '12px' }}>REMEMBER ME</span>
                  </label>
                )}

                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={loading}
                  id="auth-submit"
                  style={{ marginTop: '8px', width: '100%' }}
                >
                  {loading ? 'WORKING...' : mode === 'signup' ? 'CREATE ACCOUNT' : 'LOG IN'}
                </button>
              </form>

              <div style={{ marginTop: '16px', textAlign: 'center' }}>
                <button
                  className="btn btn-ghost"
                  onClick={() => { setMode(mode === 'signup' ? 'login' : 'signup'); setError(''); }}
                  style={{ fontSize: '13px' }}
                >
                  {mode === 'signup' ? 'ALREADY HAVE AN ACCOUNT? LOG IN' : 'NO ACCOUNT? SIGN UP'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LandingHero({ onGetStarted, onLogin }: { onGetStarted: () => void; onLogin: () => void }) {
  return (
    <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      {/* Hero */}
      <div style={{
        borderBottom: '4px solid var(--ink)',
        padding: 'clamp(48px, 9vw, 80px) clamp(16px, 5vw, 40px) clamp(40px, 8vw, 60px)',
        display: 'flex',
        flexDirection: 'column',
        gap: '24px',
      }}>
        <div>
          <p className="mono-tag">BETA — STAGE 1</p>
        </div>

        <h1 className="text-display-xl" style={{ maxWidth: '800px', lineHeight: 1.05 }}>
          YOUR NOTES.<br />
          STRUCTURED<br />
          AUTOMATICALLY.
        </h1>

        <p className="text-body" style={{ maxWidth: '560px', opacity: 0.8, fontSize: '18px' }}>
          Write in any editor. Save the file. Synthesizer turns your raw notes into a knowledge graph
          and active-recall flashcards — no manual formatting, no card-writing, no separate step.
        </p>

        <div className="flex gap-3" style={{ flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={onGetStarted} id="hero-cta" style={{ fontSize: '16px', padding: '14px 32px' }}>
            START FOR FREE
          </button>
          <button className="btn btn-secondary" onClick={onLogin} id="hero-login">
            LOG IN
          </button>
        </div>
      </div>

      {/* Feature bento */}
      <div style={{ padding: 'clamp(24px, 5vw, 40px)', backgroundColor: 'var(--base)' }}>
        <div className="bento-grid bento-grid-3">

          <div className="bento-tile" style={{ gridColumn: 'span 1' }}>
            <div className="mono-tag" style={{ marginBottom: '16px' }}>01</div>
            <h2 className="text-display-md" style={{ marginBottom: '12px' }}>WRITE NORMALLY</h2>
            <p className="text-body-sm" style={{ opacity: 0.8 }}>
              Keep using Obsidian, VS Code, Notepad — whatever you already use. No new tool to learn.
            </p>
          </div>

          <div className="bento-tile bento-tile-signal" style={{ gridColumn: 'span 1' }}>
            <div className="mono-tag" style={{ marginBottom: '16px' }}>02</div>
            <h2 className="text-display-md" style={{ marginBottom: '12px' }}>AUTO-STRUCTURE</h2>
            <p className="text-body-sm">
              Concepts and relationships are extracted and woven into an interactive knowledge graph — continuously.
            </p>
          </div>

          <div className="bento-tile" style={{ gridColumn: 'span 1' }}>
            <div className="mono-tag" style={{ marginBottom: '16px' }}>03</div>
            <h2 className="text-display-md" style={{ marginBottom: '12px' }}>STUDY SMARTER</h2>
            <p className="text-body-sm" style={{ opacity: 0.8 }}>
              Active-recall flashcards generated from your own words, scheduled with spaced-repetition.
            </p>
          </div>

        </div>

        {/* How it works */}
        <div style={{ marginTop: '40px', border: '4px solid var(--ink)', padding: 'clamp(20px, 4vw, 32px)', backgroundColor: 'var(--surface)' }}>
          <h2 className="text-display-md" style={{ marginBottom: '24px' }}>HOW IT WORKS</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px' }}>
            {[
              { step: '1', label: 'PASTE YOUR NOTES', desc: 'Drop in a chunk of lecture notes or markdown' },
              { step: '2', label: 'AI PROCESSES', desc: 'Concepts are extracted, relationships inferred' },
              { step: '3', label: 'GRAPH UPDATES', desc: 'Knowledge graph grows with each new note' },
              { step: '4', label: 'CARDS READY', desc: 'Flashcards are scheduled for spaced review' },
            ].map(({ step, label, desc }) => (
              <div key={step} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div className="stat-block">
                  <span className="stat-block__number">{step}</span>
                  <span className="stat-block__label">{label}</span>
                </div>
                <p className="text-body-sm" style={{ opacity: 0.7 }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
