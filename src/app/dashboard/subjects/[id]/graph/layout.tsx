import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Knowledge Graph - Catalyst',
  description: 'Visualize the connections between your notes through an interactive knowledge graph.',
};

export default function GraphLayout({ 
  children,
  params
}: { 
  children: React.ReactNode,
  params: Promise<{ id: string }>
}) {
  return <>{children}</>;
}
