// Append the Obsidian-style graph redesign entry to progress.md
import { readFileSync, writeFileSync } from 'fs';

const path = 'progress.md';
let md = readFileSync(path, 'utf8');

const entry = `- **Obsidian-Style Graph Redesign (2026-08-08)**: Rewrote the knowledge graph view per a new Obsidian-inspired spec (design.md §4.2 updated to match). Nodes are now small filled circles sized by connection count (degree, ~4–13px) colored from a fixed 5-token category palette (signal/link/alert/surface/mono-panel) on an **always-dark canvas** (token inversion per §1, not a one-off theme). Edges are thin 1px low-opacity lines with no arrowheads; relationship type appears only on edge hover. Labels are the de-clutter mechanism: greedy collision-avoidance pass guarantees no overlapping labels — hub nodes (top ~12% by degree) label once the sim settles, hovering labels a node + its neighbors, and zooming reveals more labels progressively. Hover/selection dims the rest of the graph to ~22% (neighborhood focus), plus a N-hop focus mode (1–3 hops) equivalent to Obsidian's local graph. Physics use a circle-sized collision force; search highlights matches + dims the rest; clustering (past 50 nodes) renders as expandable circles. Verified on a 131-node / 154-edge test subject (Biology 102): dark sparse constellation at default zoom, hover dimming, progressive label reveal, search highlight.`;

const marker = '**Latest Updates (2026-08-05):**';
if (md.includes(marker)) {
  md = md.replace(marker, '**Latest Updates (2026-08-08):**\n' + entry + '\n\n**Previous Updates (2026-08-05):**');
} else {
  md = md + '\n\n---\n\n## Latest Updates (2026-08-08)\n' + entry + '\n';
}

writeFileSync(path, md);
console.log('progress.md updated.');
