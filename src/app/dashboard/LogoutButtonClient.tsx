'use client';

import { useRouter } from 'next/navigation';
import { notifyAuthChanged } from '@/components/SessionSync';

export default function LogoutButtonClient() {
  const router = useRouter();

  async function handleLogout() {
    await fetch('/api/auth', { method: 'DELETE' });
    // Tell any other open tabs to sync so they show the signed-out state.
    notifyAuthChanged('logout');
    router.push('/');
    router.refresh();
  }

  return (
    <button className="btn btn-ghost" onClick={handleLogout} id="nav-logout" style={{ fontSize: '12px' }}>
      LOG OUT
    </button>
  );
}
