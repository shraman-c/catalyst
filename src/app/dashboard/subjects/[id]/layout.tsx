import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Subject Details - Catalyst',
  description: 'View and manage your notes, review flashcards, and explore the knowledge graph for your subject.',
};

export default function SubjectLayout({ 
  children,
  params
}: { 
  children: React.ReactNode,
  params: Promise<{ id: string }>
}) {
  return <>{children}</>;
}
