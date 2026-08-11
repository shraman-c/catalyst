import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Settings - Catalyst',
  description: 'Manage your account settings, appearance, and synchronization preferences.',
};

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
