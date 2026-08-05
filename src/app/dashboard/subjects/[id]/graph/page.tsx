'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';

// Dynamic import for ForceGraph2D (requires browser canvas)
const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false });

interface GraphNode {
  id: string;
  name: string;
  definition: string;
  reference_count: number;
  manually_edited: boolean;
  source_notes: Array<{ id: string; filename: string; updated_at: string }>;
  linked_cards: Array<{ id: string; front: string; back: string; card_type: string }>;
  x?: number;
  y?: number;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  from_node_id: string;
  to_node_id: string;
  relationship_type: string;
  from_name?: string;
  to_name?: string;
}

interface Cluster {
  id: string;
  nodeIds: string[];
  size: number;
  label: string;
}

export default function GraphPage() {
  const params = useParams();
  const router = useRouter();
  const subjectId = params.id as string;

  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[]; subject: any; clusters: Cluster[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [timeFilter, setTimeFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('');
  const [showClusters, setShowClusters] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDef, setEditDef] = useState('');
  const [saving, setSaving] = useState(false);
  const [addEdgeMode, setAddEdgeMode] = useState(false);
  const [edgeTargetId, setEdgeTargetId] = useState('');
  const [edgeRelType, setEdgeRelType] = useState('related to');
  const [addingEdge, setAddingEdge] = useState(false);
  const graphRef = useRef<any>(null);

  const fetchGraph = useCallback(async () => {
    const queryParams = new URLSearchParams();
    if (searchQuery) queryParams.set('search', searchQuery);
    if (timeFilter !== 'all') queryParams.set('time', timeFilter);
    if (sourceFilter) queryParams.set('note_id', sourceFilter);
    if (showClusters) queryParams.set('cluster', 'true');

    const res = await fetch(`/api/graph/${subjectId}?${queryParams.toString()}`);
    if (res.status === 401) { router.push('/'); return; }
    if (res.ok) {
      const data = await res.json();
      // Transform edges for force-graph
      const edges = data.edges.map((e: any) => ({
        ...e,
        source: e.from_node_id,
        target: e.to_node_id,
      }));
      setGraphData({ ...data, edges });
    }
    setLoading(false);
  }, [subjectId, router, searchQuery, timeFilter, sourceFilter, showClusters]);

  useEffect(() => { fetchGraph(); }, [fetchGraph]);

  function handleNodeClick(node: GraphNode) {
    setSelectedNode(node);
    setEditMode(false);
    setAddEdgeMode(false);
    setEdgeTargetId('');
    setEdgeRelType('related to');
    setEditName(node.name);
    setEditDef(node.definition);
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    // Search is now handled via API query parameters
    fetchGraph();
  }

  async function handleSaveEdit() {
    if (!selectedNode) return;
    setSaving(true);

    const res = await fetch(`/api/graph/${subjectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'rename',
        node_id: selectedNode.id,
        name: editName,
        definition: editDef,
      }),
    });

    if (res.ok) {
      await fetchGraph();
      setEditMode(false);
    }
    setSaving(false);
  }

  async function handleDeleteNode() {
    if (!selectedNode) return;
    if (!confirm(`Delete concept "${selectedNode.name}"? This cannot be undone.`)) return;

    const res = await fetch(`/api/graph/${subjectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', node_id: selectedNode.id }),
    });

    if (res.ok) {
      setSelectedNode(null);
      await fetchGraph();
    }
  }

  async function handleStudyConcept() {
    if (!selectedNode) return;
    // Redirect to review with this concept's cards
    router.push(`/dashboard/subjects/${subjectId}/review?concept=${selectedNode.id}`);
  }

  const filteredNodes = graphData?.nodes.filter((n) =>
    !searchQuery || n.name.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  return (
    <div className="page-container">

      {/* Breadcrumb + Header */}
      <div className="breadcrumb">
        <Link href="/dashboard" className="text-mono" style={{ opacity: 0.6, textDecoration: 'none' }}>DASHBOARD</Link>
        <span className="text-mono" style={{ opacity: 0.4 }}>›</span>
        <Link href={`/dashboard/subjects/${subjectId}`} className="text-mono" style={{ opacity: 0.6, textDecoration: 'none' }}>
          {graphData?.subject?.name?.toUpperCase() || '...'}
        </Link>
        <span className="text-mono" style={{ opacity: 0.4 }}>›</span>
        <span className="text-mono">KNOWLEDGE GRAPH</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="text-display-lg">KNOWLEDGE GRAPH</h1>
          {graphData && (
            <p className="text-mono" style={{ marginTop: '4px', opacity: 0.6 }}>
              {graphData.nodes.length} CONCEPTS · {graphData.edges.length} RELATIONSHIPS
              {graphData.clusters.length > 0 && ` · ${graphData.clusters.length} CLUSTERS`}
            </p>
          )}
        </div>
        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
          <button
            className={`btn ${showClusters ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setShowClusters(!showClusters)}
          >
            {showClusters ? 'HIDE CLUSTERS' : 'SHOW CLUSTERS'}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bento-tile" style={{ marginBottom: '16px', padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Search */}
          <form onSubmit={handleSearch} style={{ display: 'flex', gap: '8px', flex: 1, minWidth: '200px' }}>
            <input
              className="input-ink"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="SEARCH CONCEPTS..."
              style={{ flex: 1 }}
            />
            <button className="btn btn-secondary" type="submit">FIND</button>
          </form>

          {/* Time filter */}
          <select
            className="input-ink"
            value={timeFilter}
            onChange={(e) => setTimeFilter(e.target.value)}
            style={{ width: '150px' }}
          >
            <option value="all">ALL TIME</option>
            <option value="day">LAST 24 HOURS</option>
            <option value="week">LAST WEEK</option>
            <option value="month">LAST MONTH</option>
          </select>

          {/* Source filter */}
          <select
            className="input-ink"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            style={{ width: '150px' }}
          >
            <option value="">ALL SOURCES</option>
            {/* Source notes will be populated dynamically */}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="processing-block">LOADING KNOWLEDGE GRAPH...</div>
      ) : !graphData || graphData.nodes.length === 0 ? (
        <EmptyGraphState subjectId={subjectId} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0', border: '4px solid var(--ink)' }} className="graph-layout">

          {/* Graph canvas */}
          <div className="graph-container" style={{ height: '600px', borderRight: '4px solid var(--ink)' }}>
            <ForceGraph2D
              ref={graphRef}
              graphData={{ nodes: graphData.nodes, links: graphData.edges }}
              nodeId="id"
              nodeLabel="name"
              nodeCanvasObject={(node: any, ctx, globalScale) => {
                // Nodes as bordered rectangles per design.md §4.2
                const label = node.name;
                const fontSize = Math.max(10, 12 / globalScale);
                ctx.font = `bold ${fontSize}px 'Space Grotesk', sans-serif`;
                const textWidth = ctx.measureText(label).width;
                const nodeWidth = textWidth + 16;
                const nodeHeight = fontSize + 10;
                const refScale = Math.min(3, Math.log2(node.reference_count + 1) + 1);

                const isSelected = selectedNode?.id === node.id;

                // Node fill — signal for selected, surface otherwise
                ctx.fillStyle = isSelected ? '#F4B400' : '#FFFFFF';
                ctx.fillRect(node.x - (nodeWidth * refScale) / 2, node.y - (nodeHeight * refScale) / 2, nodeWidth * refScale, nodeHeight * refScale);

                // Ink border (thick, hard — design.md §4.2)
                ctx.strokeStyle = '#111111';
                ctx.lineWidth = isSelected ? 3 : 2;
                ctx.strokeRect(node.x - (nodeWidth * refScale) / 2, node.y - (nodeHeight * refScale) / 2, nodeWidth * refScale, nodeHeight * refScale);

                // Label
                ctx.fillStyle = '#111111';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(label, node.x, node.y);
              }}
              nodePointerAreaPaint={(node: any, color, ctx) => {
                ctx.fillStyle = color;
                ctx.fillRect(node.x - 50, node.y - 15, 100, 30);
              }}
              linkColor={() => '#2E7D5B'} // link color for edges
              linkWidth={2}
              linkDirectionalArrowLength={6}
              linkDirectionalArrowRelPos={1}
              linkLabel={(link: any) => link.relationship_type}
              onNodeClick={(node: any) => handleNodeClick(node)}
              backgroundColor="#F2F0E9"
              width={undefined}
              height={600}
            />
            
            {/* Cluster badges */}
            {showClusters && graphData.clusters.map((cluster) => (
              <div key={cluster.id} className="cluster-badge">
                {cluster.label}
              </div>
            ))}
          </div>

          {/* Side panel */}
          <div className="side-panel" style={{ maxHeight: '600px', overflowY: 'auto' }}>
            {selectedNode ? (
              <>
                <div className="side-panel__header">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      {editMode ? (
                        <input
                          className="input-ink"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          style={{ fontSize: '16px', fontWeight: 700, marginBottom: '4px' }}
                        />
                      ) : (
                        <h2 className="text-display-md" style={{ fontSize: '16px' }}>{selectedNode.name.toUpperCase()}</h2>
                      )}
                      <div className="flex gap-1" style={{ marginTop: '6px' }}>
                        <span className="mono-tag">{selectedNode.reference_count}× REFERENCED</span>
                        {selectedNode.manually_edited ? <span className="mono-tag mono-tag-signal">EDITED</span> : null}
                      </div>
                    </div>
                    <button className="btn btn-ghost" style={{ fontSize: '18px', padding: '4px 8px' }} onClick={() => setSelectedNode(null)}>✕</button>
                  </div>
                </div>

                <div className="side-panel__body">
                  {/* Definition */}
                  <div style={{ marginBottom: '20px' }}>
                    <div className="mono-tag" style={{ marginBottom: '8px' }}>DEFINITION</div>
                    {editMode ? (
                      <textarea
                        className="textarea-ink"
                        value={editDef}
                        onChange={(e) => setEditDef(e.target.value)}
                        style={{ minHeight: '100px', fontSize: '14px' }}
                      />
                    ) : (
                      <p className="text-body-sm">{selectedNode.definition || 'No definition available.'}</p>
                    )}
                  </div>

                  {/* Edit actions */}
                  {editMode ? (
                    <div className="flex gap-2" style={{ marginBottom: '20px' }}>
                      <button className="btn btn-primary" onClick={handleSaveEdit} disabled={saving} style={{ fontSize: '12px' }}>
                        {saving ? 'SAVING...' : 'SAVE'}
                      </button>
                      <button className="btn btn-ghost" onClick={() => setEditMode(false)} style={{ fontSize: '12px' }}>CANCEL</button>
                    </div>
                  ) : (
                    <div className="flex gap-2" style={{ marginBottom: '20px' }}>
                      <button className="btn btn-secondary" onClick={() => setEditMode(true)} style={{ fontSize: '12px' }}>EDIT</button>
                      <button className="btn btn-destructive" onClick={handleDeleteNode} style={{ fontSize: '12px' }}>DELETE</button>
                      <button
                        className="btn btn-ghost"
                        onClick={() => { setAddEdgeMode(v => !v); setEdgeTargetId(''); }}
                        style={{ fontSize: '12px' }}
                      >
                        {addEdgeMode ? 'CANCEL' : '+ EDGE'}
                      </button>
                    </div>
                  )}

                  {/* Study concept button (Stage 4) */}
                  {selectedNode.linked_cards.length > 0 && (
                    <div style={{ marginBottom: '20px' }}>
                      <button
                        className="btn btn-primary w-full"
                        onClick={handleStudyConcept}
                        style={{ marginBottom: '8px' }}
                      >
                        STUDY THIS CONCEPT ({selectedNode.linked_cards.length} CARDS)
                      </button>
                    </div>
                  )}

                  {/* Add Edge form */}
                  {addEdgeMode && selectedNode && (
                    <div className="bento-tile" style={{ padding: '12px', marginBottom: '20px', backgroundColor: 'var(--mono-panel)' }}>
                      <div className="mono-tag" style={{ marginBottom: '8px' }}>CONNECT TO</div>
                      <select
                        className="input-ink"
                        value={edgeTargetId}
                        onChange={(e) => setEdgeTargetId(e.target.value)}
                        style={{ marginBottom: '8px', fontSize: '13px' }}
                      >
                        <option value="">— select target node —</option>
                        {graphData?.nodes
                          .filter(n => n.id !== selectedNode.id)
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map(n => (
                            <option key={n.id} value={n.id}>{n.name}</option>
                          ))}
                      </select>
                      <input
                        className="input-ink"
                        value={edgeRelType}
                        onChange={(e) => setEdgeRelType(e.target.value)}
                        placeholder="relationship type (e.g. depends on)"
                        style={{ marginBottom: '8px', fontSize: '13px' }}
                      />
                      <button
                        className="btn btn-primary"
                        style={{ fontSize: '12px', width: '100%' }}
                        disabled={!edgeTargetId || addingEdge}
                        onClick={async () => {
                          if (!selectedNode || !edgeTargetId) return;
                          setAddingEdge(true);
                          await fetch(`/api/graph/${subjectId}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              action: 'add_edge',
                              from_node_id: selectedNode.id,
                              to_node_id: edgeTargetId,
                              relationship_type: edgeRelType || 'related to',
                            }),
                          });
                          setAddingEdge(false);
                          setAddEdgeMode(false);
                          setEdgeTargetId('');
                          await fetchGraph();
                        }}
                      >
                        {addingEdge ? 'ADDING...' : 'ADD EDGE'}
                      </button>
                    </div>
                  )}

                  {/* Source notes */}
                  {selectedNode.source_notes.length > 0 && (
                    <div style={{ marginBottom: '20px' }}>
                      <div className="mono-tag" style={{ marginBottom: '8px' }}>SOURCE NOTES</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {selectedNode.source_notes.map((note) => (
                          <Link key={note.id} href={`/dashboard/subjects/${subjectId}/notes/${note.id}`} style={{ textDecoration: 'none' }}>
                            <div className="bento-tile bento-tile-hoverable" style={{ padding: '8px 10px' }}>
                              <span className="text-body-sm">{note.filename}</span>
                            </div>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Linked cards */}
                  {selectedNode.linked_cards.length > 0 && (
                    <div>
                      <div className="mono-tag" style={{ marginBottom: '8px' }}>LINKED CARDS ({selectedNode.linked_cards.length})</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {selectedNode.linked_cards.slice(0, 3).map((card) => (
                          <div key={card.id} className="bento-tile" style={{ padding: '8px 10px', backgroundColor: 'var(--mono-panel)' }}>
                            <p className="text-body-sm" style={{ fontWeight: 600, marginBottom: '2px' }}>{card.front}</p>
                            <p className="text-mono" style={{ opacity: 0.6, fontSize: '11px' }}>{card.card_type.toUpperCase()}</p>
                          </div>
                        ))}
                        {selectedNode.linked_cards.length > 3 && (
                          <Link href={`/dashboard/subjects/${subjectId}/review`} className="btn btn-ghost" style={{ fontSize: '11px', textDecoration: 'none' }}>
                            STUDY ALL {selectedNode.linked_cards.length} CARDS →
                          </Link>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="side-panel__body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <p className="text-mono" style={{ opacity: 0.5, textAlign: 'center' }}>
                  CLICK A NODE TO EXPLORE ITS DEFINITION, SOURCE NOTES, AND LINKED CARDS.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mobile: concept list (design.md §3.3) */}
      <div className="hide-on-desktop" style={{ marginTop: '20px' }}>
        <h2 className="text-display-md" style={{ marginBottom: '16px' }}>CONCEPTS</h2>
        {filteredNodes.slice(0, 20).map((node) => (
          <div key={node.id} className="bento-tile" style={{ marginBottom: '8px' }} onClick={() => handleNodeClick(node)}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="text-body-sm" style={{ fontWeight: 600 }}>{node.name}</span>
              <span className="mono-tag">{node.reference_count}×</span>
            </div>
            <p className="text-body-sm" style={{ opacity: 0.7, marginTop: '4px' }}>{node.definition.slice(0, 80)}...</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyGraphState({ subjectId }: { subjectId: string }) {
  return (
    <div className="empty-state">
      <p className="empty-state__text" style={{ marginBottom: '16px' }}>NO CONCEPTS YET.</p>
      <p className="text-body-sm" style={{ opacity: 0.7, marginBottom: '24px' }}>
        Upload or paste your notes to generate a knowledge graph automatically.
      </p>
      <Link href={`/dashboard/subjects/${subjectId}`} className="btn btn-primary" style={{ textDecoration: 'none' }}>
        ADD NOTES →
      </Link>
    </div>
  );
}