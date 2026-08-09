'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

// ForceGraph2D is loaded client-side only (it needs a browser canvas) and must
// be mounted as the REAL component so its forwardRef receives graphRef.
// next/dynamic's LoadableComponent does NOT forward refs (Next 14), which
// would silently break every fg.* call (force tuning, zoomToFit, reheating).
type ForceGraphComponent = React.ComponentType<any>;

function useForceGraph2D(): { Comp: ForceGraphComponent | null; error: string | null } {
  const [Comp, setComp] = useState<ForceGraphComponent | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    import('react-force-graph-2d')
      .then((mod) => {
        if (alive) setComp(() => mod.default);
      })
      .catch(() => {
        if (alive) setError('Failed to load the graph engine. Reload the page to retry.');
      });
    return () => { alive = false; };
  }, []);
  return { Comp, error };
}

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
  source: string | { id: string };
  target: string | { id: string };
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

// ---------------------------------------------------------------
// Theme-aware graph canvas — uses the app's native --base and --ink
// so the graph integrates with the current light/dark theme.
// ---------------------------------------------------------------
const FONT_MONO = "'IBM Plex Mono', 'JetBrains Mono', monospace";

// Small fixed set of category colors — all drawn from the existing
// design.md palette (signal / link / alert / surface / mono-panel).
// The category for a node is derived deterministically from its name,
// so colors are stable across renders and sessions.
const CATEGORY_COLORS_DARK = ['#F4B400', '#2E7D5B', '#D64545', '#E7E3D8', '#9F86C0'];
const CATEGORY_COLORS_LIGHT = ['#B8860B', '#1B5E3A', '#B83030', '#444444', '#6A3D9A'];

function categoryIndex(name: string): number {
  let h = 5381;
  for (let i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) | 0;
  return Math.abs(h) % CATEGORY_COLORS_DARK.length;
}

// Auto-clustering threshold (design.md §4.2, AppFlow.md §3)
const CLUSTER_THRESHOLD = 50;

// ---------------------------------------------------------------
// Node geometry — Obsidian-style: radius scales with connection count.
// ---------------------------------------------------------------
function nodeRadius(node: any, degree: number): number {
  if (node.__isCluster) {
    // Cluster node: a larger circle sized by its member count
    return Math.min(16, 8 + 1.4 * Math.log2(1 + (node.__clusterSize || 1)));
  }
  // ~4px for a lone node, growing with degree, capped at 13px
  return Math.min(13, 3.5 + 2.1 * Math.log2(1 + degree));
}

// ---------------------------------------------------------------
// Circle collision force — pushes overlapping circles apart using the
// ACTUAL rendered radius (degree-scaled), same collision-safety
// principle as the earlier layout fix, just with circles.
// ---------------------------------------------------------------
function forceCircleCollide(radiusOf: (n: any) => number) {
  let nodes: any[] = [];

  function force(alpha: number) {
    const strength = Math.min(1, alpha * 2.5);
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      const ra = radiusOf(a);
      const aFixed = a.fx !== undefined && a.fy !== undefined;
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const rb = radiusOf(b);
        const bFixed = b.fx !== undefined && b.fy !== undefined;
        if (aFixed && bFixed) continue;

        const dx = (b.x ?? 0) - (a.x ?? 0);
        const dy = (b.y ?? 0) - (a.y ?? 0);
        const minDist = ra + rb + 8;
        const dist2 = dx * dx + dy * dy;
        if (dist2 >= minDist * minDist || dist2 < 1e-9) continue;

        const dist = Math.sqrt(dist2);
        const push = ((minDist - dist) * strength) / (aFixed || bFixed ? 1 : 2);
        const ux = dx / dist;
        const uy = dy / dist;
        if (!aFixed) { a.x = (a.x ?? 0) - ux * push; a.y = (a.y ?? 0) - uy * push; }
        if (!bFixed) { b.x = (b.x ?? 0) + ux * push; b.y = (b.y ?? 0) + uy * push; }
      }
    }
  }

  force.initialize = (n: any[]) => { nodes = n; };
  return force;
}

// ---------------------------------------------------------------
// Clustering — group densely-connected subgraphs into labeled,
// expandable cluster nodes (design.md §4.2, adapted to circles).
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
      // Label cluster with the highest-referenced member
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

interface ClusterNode extends GraphNode {
  __isCluster?: boolean;
  __clusterId?: string;
  __memberIds?: string[];
  __clusterLabel?: string;
  __clusterSize?: number;
}

export default function GraphPage() {
  const params = useParams();
  const router = useRouter();
  const subjectId = params.id as string;
  const { Comp: ForceGraph2D, error: graphEngineError } = useForceGraph2D();
  const graphEngineReady = !!ForceGraph2D;

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
  const [hoveredLink, setHoveredLink] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState<{ width: number; height: number } | null>(null);
  const clusterManualRef = useRef(false); // user explicitly toggled grouping — stop auto-clustering
  const settledRef = useRef(false); // sim has cooled down → hub labels may appear

  // Focus mode (Obsidian "local graph"): show only a node + its N-hop
  // neighborhood, hiding the rest of the graph entirely.
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [focusHops, setFocusHops] = useState(1);

  // Theme-aware canvas palette — reads CSS vars at runtime and follows
  // the app's current light/dark theme natively (no forced inversion).
  const [themeColors, setThemeColors] = useState({ bg: '#F2F0E9', fg: '#111111', isDark: false });
  useEffect(() => {
    const read = () => {
      const cs = getComputedStyle(document.documentElement);
      const base = cs.getPropertyValue('--base').trim() || '#F2F0E9';
      const ink = cs.getPropertyValue('--ink').trim() || '#111111';
      const isDark = document.documentElement.classList.contains('dark');
      setThemeColors({ bg: base, fg: ink, isDark });
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);

  // ---------------------------------------------------------------
  // Degree map — connection count drives node size (primary hierarchy)
  // ---------------------------------------------------------------
  const degreeMap = useMemo(() => {
    const m = new Map<string, number>();
    (graphData?.edges ?? []).forEach(e => {
      const s = typeof e.source === 'object' ? e.source.id : e.source;
      const t = typeof e.target === 'object' ? e.target.id : e.target;
      m.set(String(s), (m.get(String(s)) || 0) + 1);
      m.set(String(t), (m.get(String(t)) || 0) + 1);
    });
    return m;
  }, [graphData]);

  // Neighbor lookup for hover/focus neighborhoods
  const neighborMap = useMemo(() => {
    const m = new Map<string, Set<string>>();
    (graphData?.edges ?? []).forEach(e => {
      const s = typeof e.source === 'object' ? e.source.id : e.source;
      const t = typeof e.target === 'object' ? e.target.id : e.target;
      if (!m.has(String(s))) m.set(String(s), new Set());
      if (!m.has(String(t))) m.set(String(t), new Set());
      m.get(String(s))!.add(String(t));
      m.get(String(t))!.add(String(s));
    });
    return m;
  }, [graphData]);

  // Hub nodes — the top ~12% by connection count (min degree 2). Only
  // these get labels at rest, mirroring Obsidian's sparse labeling.
  const hubIds = useMemo(() => {
    if (!graphData) return new Set<string>();
    const withDeg = graphData.nodes
      .map(n => ({ id: n.id, deg: degreeMap.get(n.id) || 0 }))
      .filter(x => x.deg >= 2)
      .sort((a, b) => b.deg - a.deg);
    const count = Math.max(1, Math.ceil(withDeg.length * 0.12));
    return new Set(withDeg.slice(0, count).map(x => x.id));
  }, [graphData, degreeMap]);

  // ---------------------------------------------------------------
  // Focus-mode neighborhood (BFS up to focusHops)
  // ---------------------------------------------------------------
  const focusSet = useMemo(() => {
    if (!focusNodeId) return null;
    const out = new Set<string>([focusNodeId]);
    let frontier = [focusNodeId];
    for (let hop = 0; hop < focusHops; hop++) {
      const next: string[] = [];
      frontier.forEach(id => {
        neighborMap.get(id)?.forEach(n => {
          if (!out.has(n)) { out.add(n); next.push(n); }
        });
      });
      frontier = next;
      if (!frontier.length) break;
    }
    return out;
  }, [focusNodeId, focusHops, neighborMap]);

  // ---------------------------------------------------------------
  // Auto-cluster when the graph outgrows the canvas (design.md §4.2).
  // Focus mode takes precedence — the local view always shows raw nodes.
  // ---------------------------------------------------------------
  const clusteringActive = !focusNodeId && showClusters && (graphData?.nodes.length || 0) > 10;
  useEffect(() => {
    if (graphData && graphData.nodes.length > CLUSTER_THRESHOLD && !clusterManualRef.current) {
      setShowClusters(true);
    }
  }, [graphData]);

  const displayNodes = useMemo(() => {
    if (!graphData) return [];
    const raw = graphData.nodes;
    const edges = graphData.edges;

    // Focus mode: only the N-hop neighborhood, no clustering
    if (focusSet) {
      return raw.filter(n => focusSet.has(n.id));
    }

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
        out.push(node);
      } else if (!collapsed.has(cluster.id)) {
        collapsed.add(cluster.id);
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
  }, [graphData, clusteringActive, expandedClusters, focusSet]);

  const displayLinks = useMemo(() => {
    if (!graphData) return [];
    if (focusSet) {
      return graphData.edges.filter(e => {
        const s = typeof e.source === 'object' ? e.source.id : e.source;
        const t = typeof e.target === 'object' ? e.target.id : e.target;
        return focusSet.has(String(s)) && focusSet.has(String(t));
      });
    }
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
  }, [graphData, clusteringActive, expandedClusters, focusSet]);

  // Stable graphData reference for the engine. react-kapsule propagates props
  // by reference (!==) on EVERY render, so an inline { nodes, links } literal
  // would make the engine reload + reheat the simulation on every hover state
  // change — nodes drift away from the cursor and the graph re-swirls.
  // Memoizing means the engine only reloads when the graph actually changes.
  const graphRenderData = useMemo(
    () => ({ nodes: displayNodes, links: displayLinks }),
    [displayNodes, displayLinks]
  );

  // Neighbor lookup for hover/focus neighborhoods — keyed off the DISPLAY
  // graph (post-cluster) so hovering a cluster node highlights its
  // connected clusters, not just itself.
  const displayNeighborMap = useMemo(() => {
    const m = new Map<string, Set<string>>();
    displayLinks.forEach(e => {
      const s = typeof e.source === 'object' ? e.source.id : e.source;
      const t = typeof e.target === 'object' ? e.target.id : e.target;
      if (!m.has(String(s))) m.set(String(s), new Set());
      if (!m.has(String(t))) m.set(String(t), new Set());
      m.get(String(s))!.add(String(t));
      m.get(String(t))!.add(String(s));
    });
    return m;
  }, [displayLinks]);

  // ---------------------------------------------------------------
  // Highlight set — nodes & edges that stay bright during hover /
  // selection / search. Everything else dims to ~20-30%.
  // ---------------------------------------------------------------
  const highlightSet = useMemo(() => {
    const s = new Set<string>();
    if (hoveredNode) {
      s.add(hoveredNode);
      displayNeighborMap.get(hoveredNode)?.forEach(n => s.add(n));
    }
    if (selectedNode) {
      s.add(selectedNode.id);
      displayNeighborMap.get(selectedNode.id)?.forEach(n => s.add(n));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      (graphData?.nodes ?? []).forEach(n => {
        if (n.name.toLowerCase().includes(q)) s.add(n.id);
      });
    }
    return s;
  }, [hoveredNode, selectedNode, searchQuery, graphData, displayNeighborMap]);

  // Dimming only activates for selection and search — hover uses an additive
  // glow instead of dimming unrelated nodes, which feels less disruptive.
  const dimmingActive = !!selectedNode || !!searchQuery.trim();

  // Refs so the per-frame canvas renderer can read current state without
  // forcing React re-renders during the simulation.
  const displayNodesRef = useRef(displayNodes);
  const degreeMapRef = useRef(degreeMap);
  const hubIdsRef = useRef(hubIds);
  const highlightSetRef = useRef(highlightSet);
  const dimmingRef = useRef(dimmingActive);
  const hoveredRef = useRef(hoveredNode);
  const selectedRef = useRef(selectedNode);
  const searchRef = useRef(searchQuery);
  const hoveredLinkRef = useRef(hoveredLink);
  const focusSetRef = useRef(focusSet);
  const visibleLabelsRef = useRef<Set<string>>(new Set());
  // Viewport bounds in graph space (computed from the zoom transform +
  // canvas size) so the label pass can cull off-screen nodes.
  const viewportRef = useRef<{ minX: number; minY: number; maxX: number; maxY: number } | null>(null);
  const zoomTransformRef = useRef<{ k: number; x: number; y: number }>({ k: 1, x: 0, y: 0 });
  const containerSizeRef = useRef(containerSize);
  containerSizeRef.current = containerSize;
  displayNodesRef.current = displayNodes;
  degreeMapRef.current = degreeMap;
  hubIdsRef.current = hubIds;
  highlightSetRef.current = highlightSet;
  dimmingRef.current = dimmingActive;
  hoveredRef.current = hoveredNode;
  selectedRef.current = selectedNode;
  searchRef.current = searchQuery;
  hoveredLinkRef.current = hoveredLink;
  focusSetRef.current = focusSet;

  // ---------------------------------------------------------------
  // Label visibility — computed per frame in onRenderFramePre so it uses
  // live positions and zoom. Greedy placement guarantees no two labels
  // ever overlap: candidates are sorted by priority (hovered/selected/
  // searched first, then hubs by degree), and each label is skipped if
  // its box intersects an already-placed label or another node circle.
  // ---------------------------------------------------------------
  function computeVisibleLabels(ctx: CanvasRenderingContext2D, globalScale: number): Set<string> {
    const out = new Set<string>();
    const nodes = displayNodesRef.current;
    if (!nodes.length) return out;

    const zoom = Math.max(globalScale, 0.01);
    // Same clamp as the draw path so measurement matches rendering
    const fs = Math.max(8, 11 / zoom);
    ctx.font = `${fs}px ${FONT_MONO}`;

    const degOf = (n: any) => degreeMapRef.current.get(n.id) || 0;
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];

    // Zoom threshold per node tier — labels reveal progressively as you
    // zoom in (Obsidian principle: label density scales with zoom). Hub
    // nodes label unconditionally once the sim settles (collision pass
    // still prevents overlap), so a sparse 50+ node graph shows its hubs
    // at default zoom. Smaller tiers need more zoom to earn a label.
    const minZoomFor = (n: any): number => {
      if (n.__isCluster) return 0;
      const d = degOf(n);
      if (hubIdsRef.current.has(n.id)) return 0;
      if (d >= 5) return 0.4;
      if (d >= 3) return 0.6;
      if (d >= 2) return 0.9;
      return 1.3;
    };

    const q = searchRef.current.trim().toLowerCase();
    const hovered = hoveredRef.current;
    const selected = selectedRef.current;
    const focusSetNow = focusSetRef.current;

    // Viewport culling — transform screen bounds back into graph space
    // (screen = (graph + t) * k + canvas/2  ⇒  graph = (screen - canvas/2)/k - t)
    // with a generous label margin so labels near the edge aren't dropped.
    let vp = viewportRef.current;
    const t = zoomTransformRef.current;
    const csz = containerSizeRef.current;
    if (csz) {
      const margin = 160 / zoom;
      const cx = csz.width / 2;
      const cy = csz.height / 2;
      vp = {
        minX: (0 - cx) / t.k - t.x - margin,
        maxX: (csz.width - cx) / t.k - t.x + margin,
        minY: (0 - cy) / t.k - t.y - margin,
        maxY: (csz.height - cy) / t.k - t.y + margin,
      };
    }

    // Candidates: hovered/selected/search (always), plus progressive
    // reveal by zoom once the sim has settled. Off-screen nodes are
    // culled first so the pass stays cheap at 100+ nodes.
    const cands: any[] = [];
    for (const n of nodes) {
      if (n.x === undefined || n.y === undefined) continue;
      if (vp && (n.x < vp.minX || n.x > vp.maxX || n.y < vp.minY || n.y > vp.maxY)) continue;
      const explicit =
        (hovered && (n.id === hovered || displayNeighborMap.get(hovered)?.has(n.id))) ||
        (selected && n.id === selected.id) ||
        (q && (n.name || '').toLowerCase().includes(q)) ||
        (focusSetNow && n.id === focusNodeId);
      const zoomedEnough = settledRef.current && zoom >= minZoomFor(n);
      if (explicit || zoomedEnough) {
        (n as any).__prio = explicit ? 0 : 1;
        cands.push(n);
      }
    }
    cands.sort((a, b) =>
      (a.__prio - b.__prio) ||
      ((degOf(b) - degOf(a)) || ((b.reference_count || 0) - (a.reference_count || 0)))
    );

    for (const n of cands) {
      const r = nodeRadius(n, degOf(n));
      const x = n.x ?? 0;
      const y = n.y ?? 0;
      const label = n.__isCluster ? n.__clusterLabel || n.name : (n.name || '?');
      const tw = ctx.measureText(label).width;
      const x0 = x + r + 5;
      const y0 = y - fs / 2 - 2;
      const x1 = x0 + tw + 6;
      // Cluster chips render below the label — include their height so
      // the collision rect covers the full two-line cluster label.
      const chipH = n.__isCluster ? fs + 8 : 0;
      const y1 = y + fs / 2 + 2 + chipH;

      // Reject if the label box overlaps an already-placed label
      let collide = false;
      for (const rc of placed) {
        if (x0 < rc.x1 && x1 > rc.x0 && y0 < rc.y1 && y1 > rc.y0) { collide = true; break; }
      }
      // Reject if the label box covers another node's circle
      if (!collide) {
        for (const m of nodes) {
          if (m === n || m.x === undefined || m.y === undefined) continue;
          const mr = nodeRadius(m, degOf(m));
          if (m.x > x0 - mr && m.x < x1 + mr && m.y > y0 - mr && m.y < y1 + mr) { collide = true; break; }
        }
      }
      if (!collide) {
        out.add(n.id);
        placed.push({ x0, y0, x1, y1 });
      }
    }
    return out;
  }

  // ---------------------------------------------------------------
  // Force simulation tuning — gentle, continuous, sized for circles.
  // Depends on graphEngineReady so it re-runs when the engine mounts,
  // even if the data arrived before the async import resolved.
  // ---------------------------------------------------------------
  useEffect(() => {
    const fg = graphRef.current;
    if (!fg || !displayNodes.length) return;

    const charge = fg.d3Force('charge');
    if (charge) charge.strength(-120 - Math.min(600, displayNodes.length * 6));

    const link = fg.d3Force('link');
    if (link) {
      link.distance((l: any) => {
        const src = typeof l.source === 'object' ? l.source : null;
        const tgt = typeof l.target === 'object' ? l.target : null;
        if (src && tgt) {
          return nodeRadius(src, degreeMap.get(src.id) || 0) +
            nodeRadius(tgt, degreeMap.get(tgt.id) || 0) + 60;
        }
        return 90;
      });
      link.strength(0.15);
    }

    fg.d3Force('collide', forceCircleCollide((n: any) => nodeRadius(n, degreeMap.get(n.id) || 0)));

    const center = fg.d3Force('center');
    if (center) center.strength(0.05);
  }, [displayNodes, displayLinks, degreeMap, graphEngineReady]);

  // ---------------------------------------------------------------
  // Resize handling — re-center and re-fit on container resize.
  // Attaches once the graph container actually exists (post-loading)
  // and re-attaches when the engine mounts, since the observer is
  // otherwise set up before the container is rendered.
  // ---------------------------------------------------------------
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setContainerSize({ width: rect.width, height: rect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [loading, graphEngineReady]);

  const prevSizeRef = useRef<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const fg = graphRef.current;
    if (!fg || !containerSize) return;
    const prev = prevSizeRef.current;
    prevSizeRef.current = containerSize;
    if (!prev) return;
    const wChanged = Math.abs(prev.width - containerSize.width) > 40;
    const hChanged = Math.abs(prev.height - containerSize.height) > 40;
    if (!wChanged && !hChanged) return;
    if (containerSize.width < prev.width || containerSize.height < prev.height) {
      fg.zoomToFit(0, 80);
    } else {
      fg.centerAt(containerSize.width / 2, containerSize.height / 2, 0);
    }
  }, [containerSize]);

  const fetchGraph = useCallback(async () => {
    const queryParams = new URLSearchParams();
    if (timeFilter !== 'all') queryParams.set('time', timeFilter);
    if (sourceFilter) queryParams.set('note_id', sourceFilter);
    if (showClusters) queryParams.set('cluster', 'true');

    const res = await fetch(`/api/graph/${subjectId}?${queryParams.toString()}`);
    if (res.status === 401) { router.push('/'); return; }
    if (res.ok) {
      const data = await res.json();
      const edges = data.edges.map((e: any) => ({
        ...e,
        source: e.from_node_id,
        target: e.to_node_id,
      }));
      setGraphData({ ...data, edges });
      fitRef.current = false;
      settledRef.current = false;
      setExpandedClusters(new Set());
      setFocusNodeId(null);
    }
    setLoading(false);
  }, [subjectId, router, timeFilter, sourceFilter, showClusters]);

  useEffect(() => { fetchGraph(); }, [fetchGraph]);

  // Re-run the sim when the data changes (force config effect handles forces)
  useEffect(() => {
    const fg = graphRef.current;
    if (fg && displayNodes.length) fg.d3ReheatSimulation();
  }, [displayNodes, displayLinks, graphEngineReady]);

  // Esc clears search / focus / selection
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFocusNodeId(null);
        setSelectedNode(null);
        setSearchQuery('');
        setEditMode(false);
        setAddEdgeMode(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function handleNodeClick(node: any) {
    // Auto scale and zoom to the clicked concept/cluster
    const fg = graphRef.current;
    if (fg && node.x !== undefined && node.y !== undefined) {
      fg.centerAt(node.x, node.y, 600);
      fg.zoom(node.__isCluster ? 2 : 3, 600);
    }

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
              {focusNodeId && ` · FOCUSING ${graphData.nodes.find(n => n.id === focusNodeId)?.name?.toUpperCase() || ''} (${focusHops} HOP)`}
              {clusteringActive && ` · ${displayNodes.length} VISIBLE (${graphData.nodes.length - displayNodes.length} GROUPED)`}
            </p>
          )}
        </div>
        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
          {focusNodeId && (
            <button
              className="btn btn-ghost"
              onClick={() => { setFocusNodeId(null); fitRef.current = false; }}
            >
              ✕ EXIT FOCUS
            </button>
          )}
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
          {/* Live search — highlights matches on the canvas as you type */}
          <div style={{ display: 'flex', gap: '8px', flex: 1, minWidth: '200px', alignItems: 'center' }}>
            <input
              className="input-ink"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="HIGHLIGHT CONCEPTS..."
              style={{ flex: 1 }}
            />
            {searchQuery && (
              <button className="btn btn-ghost" onClick={() => setSearchQuery('')}>CLEAR</button>
            )}
          </div>

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
        <div className="graph-layout">

          {/* Graph canvas — follows app theme */}
          <div
            ref={containerRef}
            className="graph-container"
            style={{
              height: 'calc(100vh - 200px)',
              minHeight: '500px',
              position: 'relative',
              backgroundColor: themeColors.bg,
            }}
          >
            {!ForceGraph2D && (
              <div
                style={{
                  width: renderWidth,
                  height: renderHeight,
                  backgroundColor: themeColors.bg,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {graphEngineError ? (
                  <span style={{ fontFamily: FONT_MONO, fontSize: '12px', color: themeColors.fg, opacity: 0.7 }}>
                    {graphEngineError}
                  </span>
                ) : (
                  <span style={{ fontFamily: FONT_MONO, fontSize: '12px', color: themeColors.fg, opacity: 0.6 }}>LOADING GRAPH ENGINE...</span>
                )}
              </div>
            )}
            {ForceGraph2D && (
            <ForceGraph2D
              ref={graphRef}
              graphData={graphRenderData}
              nodeId="id"
              width={renderWidth}
              height={renderHeight}
              backgroundColor={themeColors.bg}
              d3VelocityDecay={0.42}
              warmupTicks={100}
              cooldownTicks={260}
              cooldownTime={12000}
              minZoom={0.05}
              maxZoom={8}
              showPointerCursor={true}
              onRenderFramePre={(ctx: CanvasRenderingContext2D, globalScale: number) => {
                visibleLabelsRef.current = computeVisibleLabels(ctx, globalScale);
              }}
              onEngineStop={() => {
                const fg = graphRef.current;
                if (!fg) return;
                settledRef.current = true;
                // Fit the whole graph (or focus neighborhood) into view once
                if (!fitRef.current) {
                  fitRef.current = true;
                  fg.zoomToFit(600, 80);
                }
              }}
              onNodeDrag={() => { settledRef.current = false; }}
              onZoom={(transform: { k: number; x: number; y: number }) => {
                zoomTransformRef.current = transform;
              }}
              onNodeDragEnd={(node: any) => {
                // Unpin and let the simulation settle around the new position
                node.fx = undefined;
                node.fy = undefined;
                const fg = graphRef.current;
                if (fg) fg.d3ReheatSimulation();
              }}
              nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
                const deg = degreeMapRef.current.get(node.id) || 0;
                const r = nodeRadius(node, deg);
                const x = node.x ?? 0;
                const y = node.y ?? 0;

                const currentHovered = hoveredRef.current;
                const isHovered = currentHovered === node.id;
                const isNeighborOfHovered = currentHovered ? displayNeighborMap.get(currentHovered)?.has(node.id) : false;
                const isSelected = selectedRef.current?.id === node.id;
                const isHighlighted = highlightSetRef.current.has(node.id);
                const dim = dimmingRef.current && !isHighlighted && !isHovered;

                // Selection/search dims unrelated nodes; hover does NOT dim.
                ctx.globalAlpha = dim ? 0.22 : 1;

                // Soft glow halo behind the hovered node — additive highlight
                if (isHovered) {
                  const glowR = r + 12 / globalScale;
                  const grad = ctx.createRadialGradient(x, y, r * 0.5, x, y, glowR);
                  const catColors = themeColors.isDark ? CATEGORY_COLORS_DARK : CATEGORY_COLORS_LIGHT;
                  const baseColor = node.__isCluster
                    ? themeColors.fg
                    : catColors[categoryIndex(node.name || '?')];
                  const hex = baseColor.length === 4 
                    ? '#' + baseColor[1] + baseColor[1] + baseColor[2] + baseColor[2] + baseColor[3] + baseColor[3]
                    : baseColor;
                  grad.addColorStop(0, hex + '60');
                  grad.addColorStop(0.6, hex + '20');
                  grad.addColorStop(1, hex + '00');
                  ctx.beginPath();
                  ctx.arc(x, y, glowR, 0, Math.PI * 2);
                  ctx.fillStyle = grad;
                  ctx.fill();
                }

                // Slightly enlarge hovered node for tactile feedback
                const drawR = isHovered ? r * 1.2 : r;

                // Soft flat filled circle
                ctx.beginPath();
                ctx.arc(x, y, drawR, 0, Math.PI * 2);
                const catColors2 = themeColors.isDark ? CATEGORY_COLORS_DARK : CATEGORY_COLORS_LIGHT;
                ctx.fillStyle = node.__isCluster
                  ? themeColors.fg
                  : catColors2[categoryIndex(node.name || '?')];
                ctx.fill();

                // Ring feedback: bright ring on hover/selection, subtle ring on neighbor
                if (isHovered || isSelected || (searchRef.current.trim() && isHighlighted)) {
                  ctx.beginPath();
                  ctx.arc(x, y, drawR + 2 / globalScale, 0, Math.PI * 2);
                  ctx.strokeStyle = themeColors.fg;
                  ctx.lineWidth = 2.5 / globalScale;
                  ctx.stroke();
                } else if (isNeighborOfHovered) {
                  ctx.beginPath();
                  ctx.arc(x, y, drawR + 1.5 / globalScale, 0, Math.PI * 2);
                  ctx.strokeStyle = themeColors.fg;
                  ctx.globalAlpha = 0.45;
                  ctx.lineWidth = 1.5 / globalScale;
                  ctx.stroke();
                  ctx.globalAlpha = 1;
                }

                ctx.globalAlpha = 1;

                // Label — always show for hovered node and its neighbors,
                // otherwise only when the collision pass allowed it.
                const showLabel = isHovered || isNeighborOfHovered || visibleLabelsRef.current.has(node.id);
                if (showLabel) {
                  const label = node.__isCluster ? node.__clusterLabel || node.name : (node.name || '?');
                  const fs = Math.max(8, 11 / globalScale);
                  ctx.font = `${fs}px ${FONT_MONO}`;
                  ctx.fillStyle = themeColors.fg;
                  ctx.textAlign = 'left';
                  ctx.textBaseline = 'middle';
                  // Slightly brighter label for the hovered node
                  if (isHovered) {
                    ctx.globalAlpha = 1;
                  } else if (isNeighborOfHovered) {
                    ctx.globalAlpha = 0.85;
                  }
                  if (node.__isCluster) {
                    const chip = `[${node.__clusterSize} CONCEPTS]`;
                    ctx.fillText(label, x + drawR + 6, y - fs / 2 - 2);
                    ctx.globalAlpha = 0.7;
                    ctx.font = `${Math.max(7, fs - 2)}px ${FONT_MONO}`;
                    ctx.fillText(chip, x + drawR + 6, y + fs / 2 + 4);
                    ctx.globalAlpha = 1;
                  } else {
                    ctx.fillText(label, x + drawR + 6, y);
                  }
                  ctx.textAlign = 'center';
                  ctx.globalAlpha = 1;
                }
              }}
              nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
                const deg = degreeMapRef.current.get(node.id) || 0;
                const r = nodeRadius(node, deg);
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, Math.PI * 2);
                ctx.fill();
              }}
              linkCanvasObjectMode="replace"
              linkCanvasObject={(link: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
                const src = typeof link.source === 'object' ? link.source : null;
                const tgt = typeof link.target === 'object' ? link.target : null;
                if (!src || !tgt) return;
                const x1 = src.x ?? 0;
                const y1 = src.y ?? 0;
                const x2 = tgt.x ?? 0;
                const y2 = tgt.y ?? 0;

                const srcId = typeof link.source === 'object' ? link.source.id : link.source;
                const tgtId = typeof link.target === 'object' ? link.target.id : link.target;
                const isHoveredLink = hoveredLinkRef.current === link.id;
                const highlighted = highlightSetRef.current.has(String(srcId)) && highlightSetRef.current.has(String(tgtId));

                // Is this edge connected to the hovered node?
                const currentHovered = hoveredRef.current;
                const touchesHovered = currentHovered
                  ? (String(srcId) === currentHovered || String(tgtId) === currentHovered)
                  : false;

                // Visible edges — clear structure lines.
                // Edges connected to the hovered node brighten + thicken;
                // everything else stays normal (no dimming on hover).
                let alpha = 0.55;
                let lw = 1.5;
                if (isHoveredLink) { alpha = 0.95; lw = 2.5; }
                else if (touchesHovered) { alpha = 0.9; lw = 2.2; }
                else if (dimmingRef.current) { alpha = highlighted ? 0.8 : 0.15; }

                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.strokeStyle = themeColors.fg;
                ctx.lineWidth = lw / globalScale;
                ctx.globalAlpha = alpha;
                ctx.stroke();
                ctx.globalAlpha = 1;

                // Relationship type revealed only when the edge is hovered
                if (isHoveredLink && link.relationship_type) {
                  const mx = (x1 + x2) / 2;
                  const my = (y1 + y2) / 2;
                  const fs = Math.max(8, 10 / globalScale);
                  ctx.font = `${fs}px ${FONT_MONO}`;
                  const label = link.relationship_type.toUpperCase();
                  const tw = ctx.measureText(label).width;
                  ctx.fillStyle = themeColors.bg;
                  ctx.fillRect(mx - tw / 2 - 5, my - fs / 2 - 3, tw + 10, fs + 6);
                  ctx.strokeStyle = themeColors.fg;
                  ctx.lineWidth = 1 / globalScale;
                  ctx.strokeRect(mx - tw / 2 - 5, my - fs / 2 - 3, tw + 10, fs + 6);
                  ctx.fillStyle = themeColors.fg;
                  ctx.textAlign = 'center';
                  ctx.textBaseline = 'middle';
                  ctx.fillText(label, mx, my);
                  ctx.textAlign = 'center';
                }
              }}
              onNodeClick={(node: any) => handleNodeClick(node)}
              onNodeHover={(node: any) => setHoveredNode(node ? node.id : null)}
              onLinkHover={(link: any) => setHoveredLink(link ? link.id : null)}
              onBackgroundClick={() => {
                setSelectedNode(null);
                setHoveredLink(null);
              }}
            />
            )}

            {/* Legend — theme-aware category colors */}
            <div
              style={{
                position: 'absolute',
                bottom: '10px',
                left: '10px',
                display: 'flex',
                gap: '6px',
                alignItems: 'center',
                padding: '6px 10px',
                background: themeColors.isDark ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.75)',
                border: `1px solid ${themeColors.fg}`,
                opacity: 0.85,
              }}
            >
              <span style={{ fontFamily: FONT_MONO, fontSize: '10px', color: themeColors.fg, marginRight: '4px' }}>GROUPS</span>
              {(themeColors.isDark ? CATEGORY_COLORS_DARK : CATEGORY_COLORS_LIGHT).map((c) => (
                <span key={c} style={{ width: '10px', height: '10px', borderRadius: '50%', background: c, display: 'inline-block' }} />
              ))}
            </div>

            {/* Focus-mode hop selector */}
            {focusNodeId && (
              <div
                style={{
                  position: 'absolute',
                  top: '10px',
                  left: '10px',
                  display: 'flex',
                  gap: '4px',
                  alignItems: 'center',
                  padding: '6px 10px',
                  background: themeColors.isDark ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.8)',
                  border: `1px solid ${themeColors.fg}`,
                }}
              >
                <span style={{ fontFamily: FONT_MONO, fontSize: '10px', color: themeColors.fg, marginRight: '4px' }}>HOPS</span>
                {[1, 2, 3].map(h => (
                  <button
                    key={h}
                    onClick={() => { setFocusHops(h); fitRef.current = false; }}
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: '10px',
                      padding: '2px 8px',
                      border: `1px solid ${themeColors.fg}`,
                      background: h === focusHops ? themeColors.fg : 'transparent',
                      color: h === focusHops ? themeColors.bg : themeColors.fg,
                      cursor: 'pointer',
                    }}
                  >
                    {h}
                  </button>
                ))}
              </div>
            )}

            {/* Floating side panel overlay — only visible when a node is selected */}
            <div className={`side-panel ${selectedNode ? 'side-panel--visible' : ''}`}>
              {selectedNode && (
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
                      <div className="flex gap-1" style={{ marginTop: '6px', flexWrap: 'wrap' }}>
                        <span className="mono-tag">{selectedNode.reference_count}× REFERENCED</span>
                        <span className="mono-tag">{degreeMap.get(selectedNode.id) || 0} CONNECTIONS</span>
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
                    <div className="flex gap-2" style={{ marginBottom: '20px', flexWrap: 'wrap' }}>
                      <button className="btn btn-secondary" onClick={() => setEditMode(true)} style={{ fontSize: '12px' }}>EDIT</button>
                      <button className="btn btn-destructive" onClick={handleDeleteNode} style={{ fontSize: '12px' }}>DELETE</button>
                      <button
                        className="btn btn-ghost"
                        onClick={() => { setAddEdgeMode(v => !v); setEdgeTargetId(''); }}
                        style={{ fontSize: '12px' }}
                      >
                        {addEdgeMode ? 'CANCEL' : '+ EDGE'}
                      </button>
                      {/* Focus mode — Obsidian local graph equivalent */}
                      <button
                        className={`btn ${focusNodeId === selectedNode.id ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => {
                          setFocusNodeId(focusNodeId === selectedNode.id ? null : selectedNode.id);
                          setFocusHops(1);
                          fitRef.current = false;
                        }}
                        style={{ fontSize: '12px' }}
                      >
                        {focusNodeId === selectedNode.id ? 'FOCUSED' : 'FOCUS'}
                      </button>
                    </div>
                  )}

                  {/* Study concept button */}
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
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mobile: concept list */}
      <div className="hide-on-desktop" style={{ marginTop: '20px' }}>
        <h2 className="text-display-md" style={{ marginBottom: '16px' }}>CONCEPTS</h2>
        {filteredNodes.slice(0, 20).map((node) => (
          <div key={node.id} className="bento-tile" style={{ marginBottom: '8px' }} onClick={() => handleNodeClick(node)}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="text-body-sm" style={{ fontWeight: 600 }}>{node.name}</span>
              <span className="mono-tag">{degreeMap.get(node.id) || 0}×</span>
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
