'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
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

// Design tokens (design.md §1) — CSS variable values are read at runtime so
// the canvas matches the active theme (light/dark). These hex values are the
// fallbacks used if the CSS vars are unavailable.
const INK = '#111111';
const SURFACE = '#FFFFFF';
const SIGNAL = '#F4B400';
const LINK = '#2E7D5B';
const BASE = '#F2F0E9';
const MONO_PANEL = '#E7E3D8';

const FONT_BODY = "'Space Grotesk', 'IBM Plex Sans', sans-serif";
const FONT_MONO = "'IBM Plex Mono', 'JetBrains Mono', monospace";

// Auto-clustering threshold (design.md §4.2, AppFlow.md §3)
const CLUSTER_THRESHOLD = 50;
// Per-node padding inside the collision box (design.md §4.2, 12-16px breathing room)
const NODE_PADDING_X = 18;
const NODE_PADDING_Y = 14;

// ---------------------------------------------------------------
// Node geometry helpers — measure the ACTUAL rendered size of every
// node (label text + padding, scaled by reference count) so the
// collision force has real per-node boxes instead of a uniform guess.
// ---------------------------------------------------------------

function refScale(refCount: number): number {
  // Larger boxes for frequently-referenced concepts (design.md §4.2)
  return Math.min(3, Math.log2(Math.max(1, refCount) + 1) + 1);
}

function nodeWidth(label: string, scale: number): number {
  // ~0.62 * fontSize (12px) per char is a good estimate for Space Grotesk bold;
  // exact measurement happens in the canvas renderer. Consistent on both paths.
  const textWidth = label.length * 7.4;
  return (textWidth + NODE_PADDING_X * 2) * scale;
}

function nodeHeight(scale: number): number {
  return (12 + NODE_PADDING_Y * 2) * scale;
}

// A stable per-node size keyed by id+label+refcount so we can cache measurements.
function sizeKey(n: GraphNode): string {
  return `${n.id}|${n.name}|${n.reference_count}`;
}

// ---------------------------------------------------------------
// Rectangle collision force — pushes axis-aligned rectangles apart
// using their ACTUAL measured width/height (not a fixed radius).
// This is the core fix for node overlap.
// ---------------------------------------------------------------
// Push two overlapping rectangles apart along the axis of least
// penetration. Returns true if either node moved. Shared by the collision
// force (dynamic strength) and the post-settle re-separation pass (full
// strength) so nudged nodes never end up overlapping a neighbor.
function pushApart(a: any, b: any, sa: { w: number; h: number }, sb: { w: number; h: number }, strength: number): boolean {
  // Skip if either node is being dragged (pinned)
  const aFixed = a.fx !== undefined || a.fy !== undefined;
  const bFixed = b.fx !== undefined || b.fy !== undefined;
  if (aFixed && bFixed) return false;

  const dx = (b.x ?? 0) - (a.x ?? 0);
  const dy = (b.y ?? 0) - (a.y ?? 0);
  const minDx = (sa.w + sb.w) / 2;
  const minDy = (sa.h + sb.h) / 2;

  const overlapX = minDx - Math.abs(dx);
  const overlapY = minDy - Math.abs(dy);
  if (overlapX <= 0 || overlapY <= 0) return false;

  let moved = false;
  // Resolve along the axis of least penetration for a stable, non-jittery push
  if (overlapX < overlapY) {
    const dirX = dx >= 0 ? 1 : -1;
    const move = overlapX * strength;
    if (!aFixed) { a.x = (a.x ?? 0) - dirX * move; moved = true; }
    if (!bFixed) { b.x = (b.x ?? 0) + dirX * move; moved = true; }
  } else {
    const dirY = dy >= 0 ? 1 : -1;
    const move = overlapY * strength;
    if (!aFixed) { a.y = (a.y ?? 0) - dirY * move; moved = true; }
    if (!bFixed) { b.y = (b.y ?? 0) + dirY * move; moved = true; }
  }
  return moved;
}

function forceRectCollide(getSize: (n: any) => { w: number; h: number }) {
  let nodes: any[] = [];

  function force(alpha: number) {
    const strength = Math.min(1, alpha * 3);
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      const sa = getSize(a);
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const sb = getSize(b);
        pushApart(a, b, sa, sb, strength);
      }
    }
  }

  force.initialize = (n: any[]) => { nodes = n; };
  return force;
}

// Full-strength re-separation pass: after the crossing-pass nudges move
// nodes, run the same rectangle collision resolution over the whole set so
// no nudge ever leaves a node overlapping a neighbor. Returns nodes moved.
function resolveRemainingOverlaps(nodes: any[], getSize: (n: any) => { w: number; h: number }): number {
  let moved = 0;
  for (let iter = 0; iter < 6; iter++) {
    let passMoved = 0;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      const sa = getSize(a);
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        if (pushApart(a, b, sa, getSize(b), 1)) passMoved++;
      }
    }
    moved += passMoved;
    if (passMoved === 0) break;
  }
  return moved;
}

// ---------------------------------------------------------------
// Edge-crossing pass — after the simulation settles, nudge any node
// whose bounding box intersects an edge it isn't connected to.
// Two-segment detour would be overkill; a small perpendicular nudge
// resolves the common case (design.md §4.2: straight connectors).
// ---------------------------------------------------------------
function resolveEdgeCrossings(
  nodes: any[],
  links: any[],
  getSize: (n: any) => { w: number; h: number }
): number {
  const sizeById = new Map(nodes.map(n => [n.id, n]));
  let nudges = 0;

  for (const link of links) {
    const srcId = typeof link.source === 'object' ? link.source.id : link.source;
    const tgtId = typeof link.target === 'object' ? link.target.id : link.target;
    if (srcId === tgtId) continue;

    const a = sizeById.get(srcId);
    const b = sizeById.get(tgtId);
    if (!a || a.x === undefined || a.y === undefined || b.x === undefined || b.y === undefined) continue;

    for (const n of nodes) {
      if (n.id === srcId || n.id === tgtId) continue;
      if (n.x === undefined || n.y === undefined) continue;

      const s = getSize(n);
      const halfW = s.w / 2;
      const halfH = s.h / 2;

      // Only check the node if the edge's bounding box overlaps the node's box
      const minX = Math.min(a.x, b.x) - 20;
      const maxX = Math.max(a.x, b.x) + 20;
      const minY = Math.min(a.y, b.y) - 20;
      const maxY = Math.max(a.y, b.y) + 20;
      if (n.x < minX - halfW || n.x > maxX + halfW || n.y < minY - halfH || n.y > maxY + halfH) continue;

      // Segment-line intersection test (edge as infinite line vs node box)
      const vx = b.x - a.x;
      const vy = b.y - a.y;
      const lenSq = vx * vx + vy * vy;
      if (lenSq < 1e-6) continue;

      // Project node center onto the edge line
      const t = ((n.x - a.x) * vx + (n.y - a.y) * vy) / lenSq;
      const tClamped = Math.max(0, Math.min(1, t));
      const px = a.x + tClamped * vx;
      const py = a.y + tClamped * vy;

      const distX = Math.abs(n.x - px);
      const distY = Math.abs(n.y - py);

      // Does the node's box intersect the line?
      if (distX > halfW + 4 || distY > halfH + 4) continue;

      // Nudge the node perpendicular to the edge direction
      const perpX = -vy / Math.sqrt(lenSq);
      const perpY = vx / Math.sqrt(lenSq);
      // Push along whichever perpendicular moves it off the line
      const side = (n.x - px) * perpX + (n.y - py) * perpY >= 0 ? 1 : -1;
      const pushAmt = Math.max(halfW - distX, halfH - distY, 0) + 8;
      n.x += perpX * side * pushAmt * 0.6;
      n.y += perpY * side * pushAmt * 0.6;
      nudges++;
    }
  }
  return nudges;
}

// ---------------------------------------------------------------
// Clustering — group densely-connected subgraphs into labeled,
// expandable "folder" cluster nodes (design.md §4.2).
// ---------------------------------------------------------------
function computeClusters(nodes: GraphNode[], edges: GraphEdge[]): Cluster[] {
  const adjacency = new Map<string, Set<string>>();
  nodes.forEach(n => adjacency.set(n.id, new Set()));
  edges.forEach(e => {
    adjacency.get(e.from_node_id)?.add(e.to_node_id);
    adjacency.get(e.to_node_id)?.add(e.from_node_id);
  });

  const visited = new Set<string>();
  const clusters: Cluster[] = [];

  for (const node of nodes) {
    if (visited.has(node.id)) continue;
    const members: string[] = [];
    const queue = [node.id];
    visited.add(node.id);

    while (queue.length) {
      const cur = queue.shift()!;
      members.push(cur);
      adjacency.get(cur)?.forEach(neighbor => {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      });
    }

    if (members.length >= 2) {
      // Label cluster with the highest-referenced member (design.md §4.2 display label)
      const labelNode = members
        .map(id => nodes.find(n => n.id === id))
        .filter(Boolean)
        .sort((a, b) => (b!.reference_count - a!.reference_count))[0];
      clusters.push({
        id: `cluster-${clusters.length}`,
        nodeIds: members,
        size: members.length,
        label: labelNode?.name.toUpperCase() || `CLUSTER (${members.length})`,
      });
    }
  }

  return clusters;
}

// Force-graph "cluster" nodes carry extra fields
interface ClusterNode extends GraphNode {
  __isCluster?: boolean;
  __clusterId?: string;
  __memberIds?: string[];
  __clusterLabel?: string;
  __clusterSize?: number;
}

// Cluster rendering size (folder block, design.md §4.2)
function clusterSize(label: string, size: number): { w: number; h: number } {
  // Box must fit BOTH lines: the display label (bold body, ~7.4px/char at 12px)
  // and the "[N CONCEPTS]" chip (mono, ~6.2px/char at 10px).
  const labelW = label.length * 7.4;
  const chipW = `[${size} CONCEPTS]`.length * 6.2;
  return { w: Math.max(labelW, chipW) + 36, h: 44 + (size >= 10 ? 10 : 0) };
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
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set());
  const [editMode, setEditMode] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDef, setEditDef] = useState('');
  const [saving, setSaving] = useState(false);
  const [addEdgeMode, setAddEdgeMode] = useState(false);
  const [edgeTargetId, setEdgeTargetId] = useState('');
  const [edgeRelType, setEdgeRelType] = useState('related to');
  const [addingEdge, setAddingEdge] = useState(false);
  const graphRef = useRef<any>(null);
  const fitRef = useRef(false); // only auto-fit once per graph load
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState<{ width: number; height: number } | null>(null);
  const crossingPassRef = useRef(false); // run crossing pass once per layout settle
  const clusterManualRef = useRef(false); // user explicitly toggled grouping — stop auto-clustering

  // Theme-aware canvas palette (design.md §1) — read CSS vars at runtime so
  // the canvas matches light/dark mode instead of being hard-coded light.
  const [themeColors, setThemeColors] = useState({
    ink: INK,
    surface: SURFACE,
    signal: SIGNAL,
    link: LINK,
    base: BASE,
    monoPanel: MONO_PANEL,
  });
  useEffect(() => {
    const read = () => {
      const cs = getComputedStyle(document.documentElement);
      const g = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
      setThemeColors({
        ink: g('--ink', INK),
        surface: g('--surface', SURFACE),
        signal: g('--signal', SIGNAL),
        link: g('--link', LINK),
        base: g('--base', BASE),
        monoPanel: g('--mono-panel', MONO_PANEL),
      });
    };
    read();
    // Re-read when ThemeToggle flips the html.dark/.light class
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);

  // ---------------------------------------------------------------
  // Node size cache — consistent between the collision force and the
  // canvas renderer (this is what guarantees no overlap).
  // ---------------------------------------------------------------
  const sizeCache = useRef(new Map<string, { w: number; h: number }>());
  function getNodeSize(n: any): { w: number; h: number } {
    if (n.__isCluster) return clusterSize(n.__clusterLabel || '', n.__clusterSize || 1);
    const key = sizeKey(n);
    const cached = sizeCache.current.get(key);
    if (cached) return cached;
    const scale = refScale(n.reference_count || 1);
    const size = { w: nodeWidth(n.name || '?', scale), h: nodeHeight(scale) };
    sizeCache.current.set(key, size);
    return size;
  }

  // Reset size cache when a node is renamed (new key anyway) — and when filters change
  useEffect(() => { sizeCache.current.clear(); }, [searchQuery, timeFilter, sourceFilter, showClusters, graphData]);

  // ---------------------------------------------------------------
  // Auto-cluster when the graph outgrows the canvas (design.md §4.2,
  // AppFlow.md §3). Auto-enables once past the readability threshold;
  // the toggle still works after.
  // ---------------------------------------------------------------
  const clusteringActive = showClusters && (graphData?.nodes.length || 0) > 10;
  // Auto-enable grouping past the readability threshold, but never override
  // an explicit user choice (design.md §4.2, AppFlow.md §3).
  useEffect(() => {
    if (graphData && graphData.nodes.length > CLUSTER_THRESHOLD && !clusterManualRef.current) {
      setShowClusters(true);
    }
  }, [graphData]);

  const displayNodes = useMemo(() => {
    if (!graphData) return [];
    const raw = graphData.nodes;
    const edges = graphData.edges;

    if (!clusteringActive) return raw;

    const clusters = computeClusters(raw, edges);
    const memberToCluster = new Map<string, Cluster>();
    clusters.forEach(c => c.nodeIds.forEach(id => memberToCluster.set(id, c)));

    const out: (GraphNode | ClusterNode)[] = [];
    const collapsed = new Set<string>();

    for (const node of raw) {
      const cluster = memberToCluster.get(node.id);
      if (!cluster) { out.push(node); continue; }
      if (expandedClusters.has(cluster.id)) {
        // Expanded cluster renders its members individually
        out.push(node);
      } else if (!collapsed.has(cluster.id)) {
        collapsed.add(cluster.id);
        // Collapsed cluster renders as a single folder node
        const labelNode = cluster.nodeIds
          .map(id => raw.find(n => n.id === id))
          .filter(Boolean)
          .sort((a, b) => b!.reference_count - a!.reference_count)[0];
        out.push({
          id: cluster.id,
          name: cluster.label,
          definition: `${cluster.size} concepts grouped together. Click to expand.`,
          reference_count: labelNode?.reference_count || 1,
          manually_edited: false,
          source_notes: [],
          linked_cards: [],
          __isCluster: true,
          __clusterId: cluster.id,
          __memberIds: cluster.nodeIds,
          __clusterLabel: cluster.label,
          __clusterSize: cluster.size,
        } as ClusterNode);
      }
    }
    return out;
  }, [graphData, clusteringActive, expandedClusters]);

  // Edges for the display graph: cluster members' edges point at the cluster node
  const displayLinks = useMemo(() => {
    if (!graphData) return [];
    if (!clusteringActive) return graphData.edges;

    const clusters = computeClusters(graphData.nodes, graphData.edges);
    const memberToCluster = new Map<string, Cluster>();
    clusters.forEach(c => c.nodeIds.forEach(id => memberToCluster.set(id, c)));

    return graphData.edges.map((e) => {
      const fromCluster = memberToCluster.get(e.from_node_id);
      const toCluster = memberToCluster.get(e.to_node_id);
      const fromExpanded = fromCluster ? expandedClusters.has(fromCluster.id) : true;
      const toExpanded = toCluster ? expandedClusters.has(toCluster.id) : true;

      let source = e.from_node_id;
      let target = e.to_node_id;
      if (fromCluster && !fromExpanded) source = fromCluster.id;
      if (toCluster && !toExpanded) target = toCluster.id;
      if (source === target) return null; // internal edge, invisible while collapsed

      return { ...e, source, target };
    }).filter(Boolean) as GraphEdge[];
  }, [graphData, clusteringActive, expandedClusters]);

  // Force simulation tuning — set up the full force set per design.md + fix prompt
  useEffect(() => {
    const fg = graphRef.current;
    if (!fg || !displayNodes.length) return;

    // 1. Charge/repulsion — scale with graph size so big graphs spread out
    const charge = fg.d3Force('charge');
    if (charge) {
      charge.strength(-300 - Math.min(1200, displayNodes.length * 18));
    }

    // 2. Link force with a sensible minimum distance based on node sizes
    const link = fg.d3Force('link');
    if (link) {
      link.distance((l: any) => {
        const src = typeof l.source === 'object' ? l.source : null;
        const tgt = typeof l.target === 'object' ? l.target : null;
        if (src && tgt) {
          const ss = getNodeSize(src);
          const ts = getNodeSize(tgt);
          return (ss.w + ts.w) / 2 + 70;
        }
        return 110;
      });
      link.strength(0.15);
    }

    // 3. Rectangle collision force — THE fix for overlapping nodes
    fg.d3Force('collide', forceRectCollide((n: any) => getNodeSize(n)));

    // 4. Light centering — keeps the graph on-canvas without overriding repulsion
    const center = fg.d3Force('center');
    if (center) center.strength(0.08);

    crossingPassRef.current = false;
  }, [displayNodes, displayLinks]);

  // ---------------------------------------------------------------
  // Resize handling — re-center and re-fit on container resize
  // ---------------------------------------------------------------
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) {
        setContainerSize({ width: rect.width, height: rect.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Re-center / re-fit after a meaningful resize so nodes never stay stranded
  // off-canvas for the old dimensions (fix prompt §6).
  const prevSizeRef = useRef<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const fg = graphRef.current;
    if (!fg || !containerSize) return;
    const prev = prevSizeRef.current;
    prevSizeRef.current = containerSize;
    if (!prev) return; // first measurement — the initial fit handles it
    const wChanged = Math.abs(prev.width - containerSize.width) > 40;
    const hChanged = Math.abs(prev.height - containerSize.height) > 40;
    if (!wChanged && !hChanged) return;
    if (containerSize.width < prev.width || containerSize.height < prev.height) {
      // Canvas shrank — keep the whole graph visible
      fg.zoomToFit(0, 80);
    } else {
      fg.centerAt(containerSize.width / 2, containerSize.height / 2, 0);
    }
  }, [containerSize]);

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
      fitRef.current = false;
      crossingPassRef.current = false;
      setExpandedClusters(new Set());
    }
    setLoading(false);
  }, [subjectId, router, searchQuery, timeFilter, sourceFilter, showClusters]);

  useEffect(() => { fetchGraph(); }, [fetchGraph]);

  // Re-run the sim when the data changes (force config effect above handles forces)
  useEffect(() => {
    const fg = graphRef.current;
    if (fg && displayNodes.length) fg.d3ReheatSimulation();
  }, [displayNodes, displayLinks]);

  function handleNodeClick(node: any) {
    // Cluster nodes expand/collapse instead of opening the side panel
    if (node.__isCluster) {
      setExpandedClusters(prev => {
        const next = new Set(prev);
        if (next.has(node.__clusterId)) next.delete(node.__clusterId);
        else next.add(node.__clusterId);
        return next;
      });
      return;
    }
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
    router.push(`/dashboard/subjects/${subjectId}/review?concept=${selectedNode.id}`);
  }

  const filteredNodes = graphData?.nodes.filter((n) =>
    !searchQuery || n.name.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  const renderWidth = containerSize?.width || 800;
  const renderHeight = containerSize?.height || 600;

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
              {clusteringActive && ` · ${displayNodes.length} VISIBLE (${graphData.nodes.length - displayNodes.length} GROUPED)`}
            </p>
          )}
        </div>
        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
          <button
            className={`btn ${clusteringActive ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => {
              clusterManualRef.current = true;
              setShowClusters(!showClusters);
            }}
          >
            {clusteringActive ? 'SHOWING GROUPS' : 'GROUP CONCEPTS'}
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
          <div
            ref={containerRef}
            className="graph-container"
            style={{ height: '600px', borderRight: '4px solid var(--ink)', position: 'relative' }}
          >
            <ForceGraph2D
              ref={graphRef}
              graphData={{ nodes: displayNodes, links: displayLinks }}
              nodeId="id"
              nodeLabel={(node: any) => node.__isCluster ? `${node.__clusterLabel} (${node.__clusterSize} CONCEPTS)` : node.name}
              width={renderWidth}
              height={renderHeight}
              d3VelocityDecay={0.35}
              nodeRelSize={0} // collision handled by our rect force
              warmupTicks={120}
              cooldownTicks={240}
              cooldownTime={15000}
              minZoom={0.15}
              maxZoom={8}
              showPointerCursor={true}
              onEngineStop={() => {
                const fg = graphRef.current;
                if (!fg) return;

                // Post-settle edge-crossing pass (design.md §4.2, fix prompt §3)
                if (!crossingPassRef.current && displayNodes.length > 1) {
                  crossingPassRef.current = true;
                  let nudges = 0;
                  for (let i = 0; i < 4; i++) {
                    nudges = resolveEdgeCrossings(displayNodes, displayLinks, (n: any) => getNodeSize(n));
                    if (nudges === 0) break;
                  }
                  // Nudges can push a node onto a neighbor — re-run the rectangle
                  // collision at full strength so nothing re-overlaps.
                  if (nudges > 0) {
                    resolveRemainingOverlaps(displayNodes, (n: any) => getNodeSize(n));
                  }
                  // Redraw the nudged positions (no public refresh(); refit triggers a redraw)
                  if (fitRef.current) {
                    fg.zoomToFit(0, 80);
                  }
                }

                // Fit the whole graph into view once after it settles
                if (!fitRef.current) {
                  fitRef.current = true;
                  fg.zoomToFit(600, 80);
                }
              }}
              nodeCanvasObject={(node: any, ctx, globalScale) => {
                const label = node.__isCluster ? node.__clusterLabel || node.name : (node.name || '?');
                const isSelected = selectedNode?.id === node.id;
                const isHovered = hoveredNode === node.id;
                const size = getNodeSize(node);
                const w = size.w;
                const h = size.h;
                const x = node.x ?? 0;
                const y = node.y ?? 0;

                // Hard offset shadow for selected nodes (design.md §3.1)
                if (isSelected) {
                  ctx.fillStyle = themeColors.ink;
                  ctx.fillRect(x - w / 2 + 4, y - h / 2 + 4, w, h);
                }

                // Node fill — signal for selected, surface otherwise
                ctx.fillStyle = node.__isCluster ? themeColors.monoPanel : (isSelected ? themeColors.signal : themeColors.surface);
                ctx.fillRect(x - w / 2, y - h / 2, w, h);

                // Ink border (thick, hard — design.md §4.2)
                ctx.strokeStyle = themeColors.ink;
                ctx.lineWidth = (isSelected ? 3 : (isHovered ? 3 : 2)) / globalScale;
                ctx.strokeRect(x - w / 2, y - h / 2, w, h);

                if (node.__isCluster) {
                  // Folder block: display label + size chip (design.md §4.2)
                  ctx.fillStyle = themeColors.ink;
                  ctx.textAlign = 'center';
                  ctx.textBaseline = 'middle';
                  const fs = Math.max(9, 12 / globalScale);
                  ctx.font = `bold ${fs}px ${FONT_BODY}`;
                  ctx.fillText(label, x, y - fs / 2 - 1);
                  ctx.font = `${Math.max(8, 10 / globalScale)}px ${FONT_MONO}`;
                  ctx.fillText(`[${node.__clusterSize} CONCEPTS]`, x, y + fs / 2 + 8);
                  return;
                }

                // Label (screen-constant size so it stays readable at any zoom)
                const fontSize = Math.max(9, 12 / globalScale);
                ctx.font = `bold ${fontSize}px ${FONT_BODY}`;
                ctx.fillStyle = themeColors.ink;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(label, x, y);

                // Reference-count tag in the corner (design.md §4.4 structural tag)
                if (globalScale > 0.6 && (node.reference_count || 1) > 1) {
                  const tag = `${node.reference_count}×`;
                  const tagFs = Math.max(7, 9 / globalScale);
                  ctx.font = `${tagFs}px ${FONT_MONO}`;
                  const tagW = ctx.measureText(tag).width + 8;
                  const tagH = tagFs + 4;
                  ctx.fillStyle = themeColors.monoPanel;
                  ctx.fillRect(x + w / 2 - tagW - 2, y - h / 2 + 2, tagW, tagH);
                  ctx.strokeStyle = themeColors.ink;
                  ctx.lineWidth = 1 / globalScale;
                  ctx.strokeRect(x + w / 2 - tagW - 2, y - h / 2 + 2, tagW, tagH);
                  ctx.fillStyle = themeColors.ink;
                  ctx.textAlign = 'left';
                  ctx.textBaseline = 'middle';
                  ctx.fillText(tag, x + w / 2 - tagW + 4, y - h / 2 + 2 + tagH / 2);
                  ctx.textAlign = 'center';
                }
              }}
              nodePointerAreaPaint={(node: any, color, ctx) => {
                // Pointer area must match the actual rendered box
                const size = getNodeSize(node);
                ctx.fillStyle = color;
                ctx.fillRect((node.x ?? 0) - size.w / 2, (node.y ?? 0) - size.h / 2, size.w, size.h);
              }}
              linkCanvasObjectMode="replace"
              linkCanvasObject={(link: any, ctx, globalScale) => {
                const src = typeof link.source === 'object' ? link.source : null;
                const tgt = typeof link.target === 'object' ? link.target : null;
                if (!src || !tgt) return;
                const x1 = src.x ?? 0;
                const y1 = src.y ?? 0;
                const x2 = tgt.x ?? 0;
                const y2 = tgt.y ?? 0;

                // Straight connector, link-green, consistent 2px (design.md §4.2)
                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.strokeStyle = themeColors.link;
                ctx.lineWidth = 2 / globalScale;
                ctx.stroke();

                // Bordered mono relationship chip at the midpoint (design.md §4.2)
                // Only when zoomed in enough to be readable and the graph isn't too dense
                const showChips = globalScale > 0.5 && displayLinks.length <= 60;
                if (showChips && link.relationship_type) {
                  const mx = (x1 + x2) / 2;
                  const my = (y1 + y2) / 2;
                  const fs = Math.max(7, 9 / globalScale);
                  ctx.font = `${fs}px ${FONT_MONO}`;
                  const label = link.relationship_type;
                  const textW = ctx.measureText(label).width + 10;
                  const textH = fs + 6;

                  // Chip background on surface so text never sits on a line
                  ctx.fillStyle = themeColors.surface;
                  ctx.fillRect(mx - textW / 2, my - textH / 2, textW, textH);
                  ctx.strokeStyle = themeColors.ink;
                  ctx.lineWidth = 1 / globalScale;
                  ctx.strokeRect(mx - textW / 2, my - textH / 2, textW, textH);
                  ctx.fillStyle = themeColors.ink;
                  ctx.textAlign = 'center';
                  ctx.textBaseline = 'middle';
                  ctx.fillText(label, mx, my);
                }
              }}
              onNodeClick={(node: any) => handleNodeClick(node)}
              onNodeHover={(node: any) => setHoveredNode(node ? node.id : null)}
              backgroundColor={themeColors.base}
            />
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
