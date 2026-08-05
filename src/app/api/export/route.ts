import { NextRequest, NextResponse } from 'next/server';
import { getSession, ensureSchema } from '@/lib/auth';
import { queryAll, queryOne } from '@/lib/db';

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureSchema();

  const { searchParams } = new URL(request.url);
  const subjectId = searchParams.get('subject_id');
  const format = searchParams.get('format') || 'json'; // 'json' or 'csv'

  try {
    // Get user data
    const user = await queryOne(
      'SELECT id, email, name, created_at FROM users WHERE id = ?',
      [session.id]
    );

    // Get subjects
    let subjectsQuery = 'SELECT * FROM subjects WHERE user_id = ?';
    let subjectsArgs: any[] = [session.id];
    
    if (subjectId) {
      subjectsQuery += ' AND id = ?';
      subjectsArgs.push(subjectId);
    }
    
    const subjects = await queryAll(subjectsQuery, subjectsArgs);

    // Get detailed data for each subject
    const exportData = await Promise.all(
      subjects.map(async (subject: any) => {
        const [notes, nodes, edges, cards, reviewHistory] = await Promise.all([
          queryAll(
            `SELECT nf.*, nv.content 
             FROM note_files nf 
             LEFT JOIN note_versions nv ON nf.id = nv.note_file_id 
             WHERE nf.subject_id = ?`,
            [subject.id]
          ),
          queryAll('SELECT * FROM graph_nodes WHERE subject_id = ?', [subject.id]),
          queryAll('SELECT * FROM graph_edges WHERE subject_id = ?', [subject.id]),
          queryAll(
            'SELECT * FROM flashcards WHERE subject_id = ? AND status != ?',
            [subject.id, 'deleted']
          ),
          queryAll(
            `SELECT rh.* 
             FROM review_history rh 
             JOIN flashcards f ON rh.card_id = f.id 
             WHERE f.subject_id = ?`,
            [subject.id]
          ),
        ]);

        return {
          subject,
          notes,
          graph: { nodes, edges },
          cards,
          reviewHistory,
        };
      })
    );

    const exportPayload = {
      exportDate: new Date().toISOString(),
      user,
      data: exportData,
    };

    if (format === 'csv') {
      // Convert to CSV format
      const csv = convertToCSV(exportPayload);
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="synthesizer-export-${new Date().toISOString().split('T')[0]}.csv"`,
        },
      });
    }

    // Default JSON format
    return new NextResponse(JSON.stringify(exportPayload, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="synthesizer-export-${new Date().toISOString().split('T')[0]}.json"`,
      },
    });
  } catch (err) {
    console.error('Export error:', err);
    return NextResponse.json({ error: 'Failed to export data' }, { status: 500 });
  }
}

function convertToCSV(data: any): string {
  const lines: string[] = [];
  
  // Header
  lines.push('Type,Subject,Name,Content/Created,Updated/Relationship');
  
  // Subjects
  data.data.forEach((subjectData: any) => {
    lines.push(`Subject,"${subjectData.subject.name}","${subjectData.subject.description || ''}","${subjectData.subject.created_at}",""`);
    
    // Notes
    subjectData.notes.forEach((note: any) => {
      lines.push(`Note,"${subjectData.subject.name}","${note.filename}","${note.content?.substring(0, 100) || ''}","${note.updated_at}"`);
    });
    
    // Graph nodes
    subjectData.graph.nodes.forEach((node: any) => {
      lines.push(`Concept,"${subjectData.subject.name}","${node.name}","${node.definition?.substring(0, 100) || ''}","${node.updated_at}"`);
    });
    
    // Graph edges
    subjectData.graph.edges.forEach((edge: any) => {
      lines.push(`Relationship,"${subjectData.subject.name}","${edge.from_node_id} -> ${edge.to_node_id}","${edge.relationship_type}","${edge.created_at}"`);
    });
    
    // Cards
    subjectData.cards.forEach((card: any) => {
      lines.push(`Card,"${subjectData.subject.name}","${card.front}","${card.back}","${card.card_type}"`);
    });
  });
  
  return lines.join('\n');
}