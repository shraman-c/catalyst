import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import LogoutButtonClient from './LogoutButtonClient';
import ThemeToggle from '@/components/ThemeToggle';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) {
    redirect('/');
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--base)', display: 'flex', flexDirection: 'column' }}>
      {/* Top navigation */}
      <nav className="nav-bar" style={{ position: 'sticky', top: 0, zIndex: 100, backgroundColor: 'var(--base)' }}>
        <Link href="/dashboard" className="nav-logo" id="nav-logo">
          SYNTHESIZER
        </Link>

        <div className="flex gap-4 items-center" style={{ marginLeft: '40px' }} id="nav-links-desktop">
          <Link href="/dashboard" className="nav-link" id="nav-dashboard">
            DASHBOARD
          </Link>
          <Link href="/dashboard/devices" className="nav-link" id="nav-devices">
            DEVICES
          </Link>
          <Link href="/dashboard/settings" className="nav-link" id="nav-settings">
            SETTINGS
          </Link>
        </div>

        <div className="flex gap-3 items-center" style={{ marginLeft: 'auto' }}>
          <ThemeToggle showLabel={false} style={{ padding: '6px 10px' }} />
          <span className="mono-tag hide-on-mobile">{session.email}</span>
          <LogoutButtonClient />
        </div>
      </nav>

      {/* Mobile navigation (shown only on small screens) */}
      <div className="hide-on-desktop" style={{ 
        display: 'none',
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: 'var(--base)',
        borderTop: 'var(--border-thick) solid var(--ink)',
        zIndex: 100,
        padding: '8px 16px',
        justifyContent: 'space-around'
      }}>
        <Link href="/dashboard" className="nav-link" style={{ fontSize: '11px', padding: '8px' }}>
          ◈
        </Link>
        <Link href="/dashboard/devices" className="nav-link" style={{ fontSize: '11px', padding: '8px' }}>
          ⊞
        </Link>
        <Link href="/dashboard/settings" className="nav-link" style={{ fontSize: '11px', padding: '8px' }}>
          ⚙
        </Link>
      </div>

      {/* Page content */}
      <div style={{ flex: 1, paddingBottom: '60px' }}>
        {children}
      </div>
    </div>
  );
}