import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Review - Catalyst',
  description: 'Study and review flashcards for your subject using spaced repetition.',
};

export default function ReviewLayout({ 
  children,
  params
}: { 
  children: React.ReactNode,
  params: Promise<{ id: string }>
}) {
  return <>{children}</>;
}
