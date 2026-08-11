import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import HomeClient from './HomeClient';
import type { SessionUser } from '@/lib/types';

export default async function HomePage() {
  // Session-aware root: if a valid session cookie exists, send the user
  // straight to the dashboard. This is what keeps users "logged in" when
  // they open a new tab or return after closing a tab — the cookie is
  // shared across tabs, but without this check the root page would always
  // show the landing page and look signed out.
  //
  // The check is best-effort: the landing page previously never touched the
  // database, so a DB hiccup must degrade to the anonymous landing page
  // rather than a 500 for visitors who happen to hold a cookie.
  let session: SessionUser | null = null;
  try {
    session = await getSession();
  } catch {
    session = null;
  }
  if (session) redirect('/dashboard');

  return <HomeClient />;
}
