import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Flashcards Review - Catalyst',
  description: 'Review your active-recall flashcards using spaced repetition to reinforce your knowledge.',
};

export default function CardsLayout({ 
  children,
  params
}: { 
  children: React.ReactNode,
  params: Promise<{ id: string }>
}) {
  return <>{children}</>;
}
