import { readFileSync, writeFileSync } from 'fs';

const path = 'progress.md';
let md = readFileSync(path, 'utf8');

const entry =
  "- **Full Responsive Pass (2026-08-08)**: Audited every page (landing, dashboard, subject overview, notes list, note detail, flashcard review, knowledge graph) for all screen sizes with a Playwright overflow check at 375px / 768px / 1280px — zero horizontal overflow on all 21 page x viewport combinations (verified with scripts/responsive-audit.mjs). Fixes: graph view layout moved from inline styles to a .graph-layout CSS class so canvas + side panel collapse to a single stacked column under 768px (400px canvas height, side panel capped, no chunky double-border seam); landing feature bento switched from an inline grid-template-columns override (which beat the mobile media query) to a responsive .bento-grid-3 class; dashboard top-nav links hidden under 640px since the fixed bottom nav covers those routes (nav now wraps at 768px so 641-768px tablets do not overflow); note-detail page now uses the fluid .page-container instead of hard-coded 32/40px padding, with wrapping breadcrumb, tag rows, and tab bar; flashcard divider now uses calc(-1 * var(--card-pad)) so it stays flush with the card padding at both 40px (desktop) and 20px (mobile); wide markdown tables scroll horizontally instead of blowing out their tile; .page-container centers on ultra-wide screens; responsive clamps for landing hero/sections and review summary. Mobile screenshots in screenshots/responsive/.\n";

// Insert as the newest entry under the Latest Updates heading
const anchor = '**Latest Updates (2026-08-08):**\n';
if (!md.includes(anchor)) {
  console.error('Anchor not found — appending at end instead');
  md += '\n' + entry;
} else {
  md = md.replace(anchor, anchor + '\n' + entry);
}

writeFileSync(path, md);
console.log('progress.md updated');
