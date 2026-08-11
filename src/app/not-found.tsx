import Link from 'next/link';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Page Not Found - Catalyst',
  description: 'The page you are looking for does not exist.',
};

export default function NotFound() {
  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: 'var(--base)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      padding: '2rem'
    }}>
      <h1 className="display-heading mb-4" style={{ fontSize: '4rem' }}>404</h1>
      <p className="text-secondary mb-6 text-lg">We couldn't find the page you were looking for.</p>
      <Link href="/" className="btn-primary" style={{ padding: '0.75rem 1.5rem', textDecoration: 'none' }}>
        Return Home
      </Link>
    </div>
  );
}
