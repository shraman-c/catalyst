import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Devices - Catalyst',
  description: 'Manage your connected devices and sync status for Catalyst.',
};

export default function DevicesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
