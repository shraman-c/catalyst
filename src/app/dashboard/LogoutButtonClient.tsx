'use client';

import { useRouter } from 'next/navigation';

export default function LogoutButtonClient() {
  const router = useRouter();

  async function handleLogout() {
    await fetch('/api/auth', { method: 'DELETE' });
    router.push('/');
    router.refresh();
  }

  return (
    <button className="btn btn-ghost" onClick={handleLogout} id="nav-logout" style={{ fontSize: '12px' }}>
      LOG OUT
    </button>
  );
}
