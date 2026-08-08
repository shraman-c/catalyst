// Update design.md §4.2 to reflect the Obsidian-style graph redesign.
import { readFileSync, writeFileSync } from 'fs';

const path = 'design.md';
let md = readFileSync(path, 'utf8');

const oldSection = `### 4.2 Graph nodes & edges
- Nodes render as small bordered rectangles (not soft circles/blobs) with the concept name in Body type, sized by reference count.
- Edges are solid \`ink\` or \`link\`-colored lines at a consistent thickness (2px) with a small arrow or label chip (bordered, mono type) at the midpoint stating the relationship — no soft curved bezier lines; straight or minimally-angled connectors read more structurally honest in this style.
- Clustering (when a graph gets large) renders as a bordered "folder" block labeled in Display type (e.g. \`REACTION MECHANISMS\`) that expands on click — a literal container, not a soft translucent bubble.`;

const newSection = `### 4.2 Graph nodes & edges (Obsidian-style — v2, 2026-08-08)
The graph canvas is a **always-dark Obsidian-style view** (dark-mode token inversion per §1: canvas bg = \`ink\` value, fg = \`base\` value, regardless of app theme). Flat dark canvas, no grid or texture — nodes and edges are the only content.
- **Nodes** render as small filled circles (no border/stroke by default), radius ~4–6px scaled by **connection count** (degree): hub concepts render visibly larger (capped ~13px), which is the primary visual hierarchy. A thin 2px outer ring appears on hover/selection/search instead of a heavy border.
- **Node color** comes from a small fixed 5-color palette drawn from existing functional tokens (\`signal\` / \`link\` / \`alert\` / \`surface\` / \`mono-panel\`), assigned deterministically (category derived from the concept, stable across sessions). Legend shown on the canvas.
- **Edges** are thin (1px, ~15–25% of foreground opacity), no arrowheads, no permanent relationship labels — relationship type is revealed only on edge hover as a small bordered mono chip at the midpoint.
- **Labels** are the de-clutter mechanism: default state shows no labels except the largest hub nodes (top ~10–15% by degree) once the simulation settles and there is room (greedy collision pass guarantees no two labels ever overlap). Hovering a node labels it plus its direct neighbors; zooming in progressively reveals labels for smaller nodes as space allows (Obsidian principle: label density scales with zoom).
- **Hover/focus de-clutter**: hovering or selecting a node renders it and its direct neighborhood at full opacity while the rest of the graph dims to ~20–30%. A "focus" mode shows only the selected node's N-hop neighborhood (1–3 hops) and hides the rest — the local-graph equivalent, wired to the existing "study this concept" flow.
- **Physics**: continuous gentle force simulation (charge/repulsion + link + light centering + circle collision force sized to actual node radius). Smooth pan/zoom, drag nodes to reposition and let the sim settle around the new spot. Simulation throttles/pauses once visually settled.
- **Search/filter**: a live search input highlights matching nodes (ring + label) and dims non-matches as you type.
- **Clustering** (large graphs): tightly-related nodes group into a single larger circle (sized by member count, labeled once zoomed/hovered into that area) that expands into its members on click — same principle as before, expressed through circle size instead of a bordered box.`;

if (!md.includes(oldSection)) {
  console.error('OLD SECTION NOT FOUND — aborting. Check exact text of design.md §4.2.');
  process.exit(1);
}

md = md.replace(oldSection, newSection);
writeFileSync(path, md);
console.log('design.md §4.2 updated.');
