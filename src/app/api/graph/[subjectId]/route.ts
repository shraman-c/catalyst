import { NextRequest, NextResponse } from 'next/server';
import { getSession, ensureSchema } from '@/lib/auth';
import { queryAll, queryOne, execute, generateId } from '@/lib/db';
import type { GraphNode, GraphEdge, Subject } from '@/lib/types';

export async function GET(
  request: NextRequest,
  { params }: { params: { subjectId: string } }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureSchema();

  const subject = await queryOne<Subject>(
    'SELECT * FROM subjects WHERE id = ? AND user_id = ?',
    [params.subjectId, session.id]
  );
  if (!subject) return NextResponse.json({ error: 'Subject not found' }, { status: 404 });

  // Get query parameters for filtering
  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search') || '';
  const timeFilter = searchParams.get('time') || 'all'; // 'day', 'week', 'month', 'all'
  const sourceNoteId = searchParams.get('note_id') || '';
  const cluster = searchParams.get('cluster') === 'true';

  // Build base queries with filters
  let nodesQuery = 'SELECT * FROM graph_nodes WHERE subject_id = ?';
  let nodesArgs: any[] = [params.subjectId];

  // Add time filter
  if (timeFilter !== 'all') {
    const timeInterval = timeFilter === 'day' ? '1 day' : 
                        timeFilter === 'week' ? '7 days' : '30 days';
    nodesQuery += ` AND created_at > NOW() - INTERVAL '${timeInterval}'`;
  }

  // Add search filter
  if (search) {
    nodesQuery += ` AND (name ILIKE $${nodesArgs.length + 1} OR definition ILIKE $${nodesArgs.length + 1})`;
    nodesArgs.push(`%${search}%`);
  }

  // Add source note filter
  if (sourceNoteId) {
    nodesQuery += ` AND id IN (SELECT node_id FROM node_note_map WHERE note_file_id = $${nodesArgs.length + 1})`;
    nodesArgs.push(sourceNoteId);
  }

  nodesQuery += ' ORDER BY reference_count DESC, name ASC';

  // Get nodes and edges
  const [nodes, edges] = await Promise.all([
    queryAll<GraphNode>(nodesQuery, nodesArgs),
    queryAll<GraphEdge & { from_name: string; to_name: string }>(
      `SELECT ge.*, fn.name as from_name, tn.name as to_name
       FROM graph_edges ge
       JOIN graph_nodes fn ON ge.from_node_id = fn.id
       JOIN graph_nodes tn ON ge.to_node_id = tn.id
       WHERE ge.subject_id = ?`,
      [params.subjectId]
    ),
  ]);

  // Enrich each node with source notes and linked cards
  const enrichedNodes = await Promise.all(
    nodes.map(async (node) => {
      const [sourceNotes, linkedCards] = await Promise.all([
        queryAll(
          `SELECT nf.id, nf.filename, nf.updated_at
           FROM node_note_map nnm
           JOIN note_files nf ON nnm.note_file_id = nf.id
           WHERE nnm.node_id = ?`,
          [node.id]
        ),
        queryAll(
          `SELECT id, front, back, card_type, status
           FROM flashcards
           WHERE subject_id = ? AND status != 'deleted' AND node_ids LIKE ?`,
          [params.subjectId, `%${node.id}%`]
        ),
      ]);
      return { ...node, source_notes: sourceNotes, linked_cards: linkedCards };
    })
  );

  // Apply clustering if requested
  let finalNodes = enrichedNodes;
  let clusters: any[] = [];

  if (cluster && enrichedNodes.length > 10) {
    // Simple clustering based on reference count and relationships
    clusters = generateClusters(enrichedNodes, edges);
  }

  return NextResponse.json({ 
    nodes: finalNodes, 
    edges, 
    subject,
    clusters,
    filters: {
      search,
      time: timeFilter,
      sourceNoteId,
      cluster
    }
  });
}

function generateClusters(nodes: GraphNode[], edges: GraphEdge[]): any[] {
  // Simple clustering algorithm based on connectivity
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const adjacencyList = new Map<string, Set<string>>();

  // Build adjacency list
  nodes.forEach(n => adjacencyList.set(n.id, new Set()));
  edges.forEach(e => {
    adjacencyList.get(e.from_node_id)?.add(e.to_node_id);
    adjacencyList.get(e.to_node_id)?.add(e.from_node_id);
  });

  // Find connected components (simple BFS)
  const visited = new Set<string>();
  const clusters: any[] = [];

  nodes.forEach(node => {
    if (!visited.has(node.id)) {
      const cluster: string[] = [];
      const queue = [node.id];
      
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        
        visited.add(current);
        cluster.push(current);
        
        adjacencyList.get(current)?.forEach(neighbor => {
          if (!visited.has(neighbor)) {
            queue.push(neighbor);
          }
        });
      }

      if (cluster.length > 1) {
        clusters.push({
          id: `cluster-${clusters.length}`,
          nodeIds: cluster,
          size: cluster.length,
          label: cluster.length > 3 ? `Cluster (${cluster.length} concepts)` : cluster.map(id => nodeMap.get(id)?.name).join(', ')
        });
      }
    }
  });

  return clusters;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { subjectId: string } }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureSchema();

  const subject = await queryOne<Subject>(
    'SELECT * FROM subjects WHERE id = ? AND user_id = ?',
    [params.subjectId, session.id]
  );
  if (!subject) return NextResponse.json({ error: 'Subject not found' }, { status: 404 });

  const { action, node_id, name, definition, merge_into_id, from_node_id, to_node_id, relationship_type: rel_type } = await request.json();

  if (action === 'rename') {
    await execute(
      'UPDATE graph_nodes SET name = ?, definition = ?, manually_edited = TRUE, updated_at = NOW() WHERE id = ? AND subject_id = ?',
      [name, definition || '', node_id, params.subjectId]
    );
  }

  if (action === 'delete') {
    await execute('DELETE FROM graph_nodes WHERE id = ? AND subject_id = ?', [node_id, params.subjectId]);
  }

  if (action === 'merge' && merge_into_id) {
    await Promise.all([
      execute('UPDATE graph_edges SET from_node_id = ? WHERE from_node_id = ?', [merge_into_id, node_id]),
      execute('UPDATE graph_edges SET to_node_id = ? WHERE to_node_id = ?', [merge_into_id, node_id]),
      execute('UPDATE graph_nodes SET reference_count = reference_count + 1, manually_edited = TRUE WHERE id = ?', [merge_into_id]),
    ]);
    await execute('DELETE FROM graph_nodes WHERE id = ?', [node_id]);
  }

  if (action === 'add_edge' && from_node_id && to_node_id) {
    const edgeId = generateId();
    await execute(
      `INSERT INTO graph_edges (id, subject_id, from_node_id, to_node_id, relationship_type, created_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [edgeId, params.subjectId, from_node_id, to_node_id, rel_type || 'related to']
    );
  }

  return NextResponse.json({ success: true });
}