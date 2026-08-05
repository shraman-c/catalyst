'use client';

import { useTheme } from '@/lib/ThemeProvider';

interface ThemeToggleProps {
  showLabel?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export default function ThemeToggle({ showLabel = true, className = 'btn btn-ghost', style }: ThemeToggleProps) {
  const { resolvedTheme, toggleTheme } = useTheme();

  return (
    <button
      className={className}
      onClick={toggleTheme}
      aria-label={resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      title={resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '6px', ...style }}
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
      {showLabel && (
        <span className="hide-on-mobile" style={{ fontSize: '12px', fontWeight: 600 }}>
          {resolvedTheme === 'dark' ? 'LIGHT' : 'DARK'}
        </span>
      )}
    </button>
  );
}
