import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Metadata } from 'next';
import LogoutButtonClient from './LogoutButtonClient';
import ConnectionStatus from '@/components/ConnectionStatus';
import MobileNav from '@/components/MobileNav';

export const metadata: Metadata = {
  title: 'Dashboard — Catalyst',
  description: 'Manage your knowledge base, notes, and spaced repetition flashcards in your Catalyst dashboard.',
};

export const metadata: Metadata = {
  title: 'Dashboard — Catalyst',
  description: 'Manage your knowledge base, notes, and spaced repetition flashcards in your Catalyst dashboard.',
};

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
          CATALYST
        </Link>

        <div className="flex gap-4 items-center hide-on-mobile" style={{ marginLeft: '40px' }} id="nav-links-desktop">
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
          <span className="mono-tag hide-on-mobile">{session.email}</span>
          <LogoutButtonClient />
        </div>
      </nav>

      {/* Mobile navigation (shown only on small screens) — big icon chips */}
      <MobileNav />

      {/* Page content */}
      <div style={{ flex: 1, paddingBottom: '84px' }}>
        {children}
      </div>

      {/* Offline / back-online indicator (Part 2) */}
      <ConnectionStatus />
    </div>
  );
}