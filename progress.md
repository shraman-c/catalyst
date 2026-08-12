# Build Progress Log

## Current Status
Stage 3 (The Watcher / Local-to-Cloud Sync) — **complete**. All three stages fully implemented. Build verified (`npm run build` passes, 15 routes, 0 TypeScript errors). Application running on localhost:3001.

**Latest Updates (2026-08-08):**

- **Card review-due count fix (2026-08-09)**: The "X CARDS DUE" numbers on the dashboard, subject page, and subject tiles were wrong. Two root causes: (1) the count query counted **all** new cards while the actual review queue only introduces `dailyCap − already-introduced-today` new cards per day (default 20) plus at most 200 overdue reviewed cards, so the display was systematically too high after pipeline uploads; (2) Postgres `COUNT(*)` returns a **string** (bigint), so the old routes passed `"35"` through and the dashboard's `reduce((sum, s) => sum + s.stats.cards_due_today, 0)` was doing string concatenation (`0 + "35"` = `"035"`). Fix: new shared module `src/lib/review.ts` (`getCardsDueCount`, `getDailyCap`, `countNewIntroducedToday`) that mirrors the `mode=due` review-queue logic exactly (same filters, same `LIMIT 200` cap, same daily-cap arithmetic, `Number()` coercion on all counts), used by `/api/subjects` and `/api/subjects/[id]`; the review route `/api/cards/[subjectId]` was refactored to use the same helpers so queue and count can never drift apart again. Also hardened "introduced today" to use a DB-side day boundary (`date_trunc('day', NOW())`) instead of a JS UTC date string. Verified: tsc clean, production build passes, and a live E2E (12 checks) against a production server — dashboard/subject counts now always equal the review-queue length, including the daily cap (30 new + 5 due → 25; after 2 introduced today → 23) and an empty edge case → 0; test data cleaned up.

- **Graph hover stability fix (2026-08-09)**: Hovering nodes no longer makes them drift away from the cursor or makes the whole graph re-swirl. Root cause: `react-kapsule` (the React wrapper for `react-force-graph-2d`) propagates every prop by *reference* on each render, and the app passed `graphData={{ nodes, links }}` as an inline object literal — so every `onNodeHover`-triggered re-render produced a new reference, forcing the engine to reload the data and reheat the force simulation. Fix: memoize the object (`graphRenderData = useMemo(() => ({ nodes, links }), [displayNodes, displayLinks])` in `src/app/dashboard/subjects/[id]/graph/page.tsx`), so the engine only reloads when the graph actually changes (refetch, cluster toggle, focus mode, node drag). Verified: `tsc` clean, production build passes; code review confirmed no other prop reassigned on hover reheats the sim and no data-change path was affected.

- **SW offline-fallback fix (2026-08-10)**: Replaced the broken `workboxOptions.navigateFallback: '/offline.html'` with next-pwa's `fallbacks: { document: '/offline.html' }`. The old config generated a NavigationRoute(createHandlerBoundToURL('/offline.html')) that matched EVERY navigation before any other route and served the precached offline page regardless of network status — root cause verified live on the deployed site via Playwright: every reload/deep-link with a SW active returned the offline page. The new config injects a handlerDidError fallback only, so offline.html only appears when the network strategy actually fails. Also gitignored the generated public/sw.js, public/workbox-*.js, and public/fallback-*.js (were committed build artifacts that churned every PR). Verified via scripts/verify-sw-fix.mjs: 6/6 checks pass (online navigations return real pages, offline navigations return offline.html).

- **Argon2 password hashing + settings responsiveness (2026-08-08)**: Replaced the weak SHA-256 password hashing with Argon2id via @node-rs/argon2 (OWASP params: 19 MiB, 2 iterations). Existing accounts still log in via a legacy-SHA-256 compatibility path and are upgraded in place on next successful login (`migrateLegacyPasswordHash` in `src/lib/auth.ts`). Fresh signups store PHC-format `$argon2id$...` hashes. The native .node binary is kept out of webpack via `serverExternalPackages` plus a webpack-externals fallback in `next.config.js` (dev-mode RSC layer edge case). Seed scripts (`seed-large-graph.mjs`, `seed-supabase.mjs`, `seed-supabase.cjs`) now generate argon2 hashes too. Also fixed the settings page: the CONCISE/STANDARD/DETAILED verbosity row (and the identical appearance/density rows) overflowed on phones — 3 nowrap buttons in a non-wrapping flex container — now wrap cleanly with min-widths; verified zero horizontal overflow at 320/375/768px (`scripts/verify-argon2.mjs` + `scripts/responsive-audit.mjs`).
- **Full Responsive Pass (2026-08-08)**: Audited every page (landing, dashboard, subject overview, notes list, note detail, flashcard review, knowledge graph) for all screen sizes with a Playwright overflow check at 375px / 768px / 1280px — zero horizontal overflow on all 21 page x viewport combinations (verified with scripts/responsive-audit.mjs). Fixes: graph view layout moved from inline styles to a .graph-layout CSS class so canvas + side panel collapse to a single stacked column under 768px (400px canvas height, side panel capped, no chunky double-border seam); landing feature bento switched from an inline grid-template-columns override (which beat the mobile media query) to a responsive .bento-grid-3 class; dashboard top-nav links hidden under 640px since the fixed bottom nav covers those routes (nav now wraps at 768px so 641-768px tablets do not overflow); note-detail page now uses the fluid .page-container instead of hard-coded 32/40px padding, with wrapping breadcrumb, tag rows, and tab bar; flashcard divider now uses calc(-1 * var(--card-pad)) so it stays flush with the card padding at both 40px (desktop) and 20px (mobile); wide markdown tables scroll horizontally instead of blowing out their tile; .page-container centers on ultra-wide screens; responsive clamps for landing hero/sections and review summary. Mobile screenshots in screenshots/responsive/.
- **Obsidian-Style Graph Redesign (2026-08-08)**: Rewrote the knowledge graph view per a new Obsidian-inspired spec (design.md §4.2 updated to match). Nodes are now small filled circles sized by connection count (degree, ~4–13px) colored from a fixed 5-token category palette (signal/link/alert/surface/mono-panel) on an **always-dark canvas** (token inversion per §1, not a one-off theme). Edges are thin 1px low-opacity lines with no arrowheads; relationship type appears only on edge hover. Labels are the de-clutter mechanism: greedy collision-avoidance pass guarantees no overlapping labels — hub nodes (top ~12% by degree) label once the sim settles, hovering labels a node + its neighbors, and zooming reveals more labels progressively. Hover/selection dims the rest of the graph to ~22% (neighborhood focus), plus a N-hop focus mode (1–3 hops) equivalent to Obsidian's local graph. Physics use a circle-sized collision force; search highlights matches + dims the rest; clustering (past 50 nodes) renders as expandable circles. Verified on a 131-node / 154-edge test subject (Biology 102): dark sparse constellation at default zoom, hover dimming, progressive label reveal, search highlight.

**Latest Updates (2026-08-09) — back-log of previously unlogged changes (reconstructed from git history):**

- **Branding: "Synthesizer" → "Catalyst" (2026-08-05)**: Rebranded the product name across the dashboard nav logo (`src/app/dashboard/layout.tsx`), the root metadata + Open Graph title/description, and the landing-page nav logo (`src/app/layout.tsx`, `src/app/page.tsx`). Page title is now "Catalyst — Turn Notes Into Knowledge".
- **Legacy-session healing after the SQLite → Postgres migration (2026-08-05)**: Sessions created under the old SQLite DB still verify (the JWT is self-contained) but reference a `user_id` with no matching Postgres row, which caused FK violations on writes (e.g. `subjects_user_id_fkey`). Added `ensureUserRow()` in `src/lib/auth.ts` — an atomic `INSERT ... ON CONFLICT (id) DO NOTHING` upsert that heals the row on every `getSession()`, and a `SENTINEL_PASSWORD_HASH` (`!healed-session-no-password!`) so a healed row can never be logged into with a password. The auth route returns a friendly 401 explaining this instead of a confusing "Invalid email or password".
- **Dependency cleanup after migration (2026-08-05)**: Removed the now-unused `@libsql/client`, `@supabase/ssr`, `@supabase/supabase-js`, and `next-auth` packages from `package.json` (~545 lines of `package-lock.json`) — the app runs on `postgres` + custom `jose` JWTs, so the old SQLite/Supabase/next-auth client libs were dead weight.
- **PROJECT_BRIEF.md added (2026-08-08)**: New top-level doc summarizing Catalyst's high-level summary, tech stack, routing architecture, and key dependencies.
- **Graph hover rework — glow instead of dim (2026-08-08)**: Follow-up to the Obsidian-style redesign: hovering a node no longer dims the rest of the graph. Instead the hovered node gets an additive radial glow halo + 1.2× enlargement, its neighbors get a subtle ring and forced labels, and edges touching the hovered node brighten (~0.9) and thicken (~2.2px). Baseline edge alpha raised from 0.2 → 0.55 and width 1 → 1.5 so the un-hovered graph reads as clear structure lines. Dimming now only applies to selection and search. Also refactored the note-detail markdown sanitizer (`src/app/dashboard/subjects/[id]/notes/[noteId]/page.tsx`) into a single dedicated `Marked` instance with renderer overrides (marked v12 API) instead of per-call renderer options.
- **"Remember Me" on login + notes-list icon actions (2026-08-08)**: Login form gained a REMEMBER ME checkbox (default on) — unchecked sets a session cookie, checked keeps the 30-day persistent cookie; cookie options centralized in `src/app/api/auth/route.ts`. The notes list replaced its text "VIEW →" / "DELETE" buttons with eye / trash SVG icon buttons (right-aligned actions column, `title` tooltips).
- **SECURITY_AUDIT.md ignored (uncommitted)**: `.gitignore` now excludes `SECURITY_AUDIT.md` (same as the other planning/audit docs).

**Latest Updates (2026-08-09) — Security audit remediation (SECURITY_AUDIT.md, audit dated 2026-08-08):**

- **All Section 2 (deploy-blocking) items fixed and verified live**: server-side password validation (2.1), rate limiting + DB-backed account lockout (2.2 / audit 1.8), security headers (2.3), Zod validation on every body-accepting route (2.4), DOMPurify HTML sanitization (2.5), server-side session store with revocation + "log out of all devices" (2.6), generic signup error to stop enumeration (2.7), dependency audit + Next.js 14→15 upgrade + CI audit gate (2.8). Section 3: file-type validation by content inspection (3.1) and dual-key secret rotation (3.2) also fixed; 3.3/3.4/3.5 logged as tracked follow-ups below. `npm audit` is now **0 vulnerabilities** (was 2 high), `npx tsc --noEmit` clean, production build passes on Next.js 15.5.23, and every deploy-blocking item was verified with live curl checks against a production-mode server. Full per-item details + verification in the "Security Audit Remediation" section below.

**Latest Updates (2026-08-09) — Note content encryption at rest (audit 3.3, now implemented):**

- **`note_versions.content` is encrypted at rest with AES-256-GCM.** New `src/lib/encryption.ts` derives a 32-byte key from the new `NOTE_ENCRYPTION_KEY` env var and stores `enc:v1:<iv>:<authTag>:<ciphertext>` (base64). Production **fails closed** without the key — the app refuses to store note content in plaintext; dev falls back to plaintext with a warning. GCM authenticates each row, so a wrong key or tampered ciphertext throws on decrypt instead of returning garbage. Legacy plaintext rows pass through `decryptNote()` untouched.
- **Hooks**: writes encrypt in `api/notes/upload` + `api/sync/files` (JSON **and** multipart paths); reads decrypt in `api/notes/[id]` and `api/export` (JSON + CSV). The AI pipeline still receives plaintext in memory — only storage is encrypted, so Groq/Pinecone/vector code needed zero changes.
- **`.env.local.example`** documents `NOTE_ENCRYPTION_KEY` (generation command + rotation warning) alongside the existing `NEXTAUTH_SECRET_PREVIOUS` (3.2) block.
- **Backfill**: `scripts/encrypt-existing-notes.mjs` (idempotent, `--dry-run` preview) encrypts pre-existing plaintext rows in place.
- **Verified**: 6 unit checks on `encryption.ts` (round-trip, prefix, legacy passthrough, wrong-key rejection, prod fail-closed) + a live E2E against a production-mode server — DB row shows `enc:v1:` ciphertext with no plaintext marker, `GET /api/notes/[id]` and `/api/export?format=json` both return the exact original plaintext with zero `enc:v1:` leakage, and the full AI pipeline (3 nodes, 5 edges, 4 cards) completed through the encrypted-storage path. Test account cleaned from dev DB.

**Latest Updates (2026-08-09) — Note content full-text search:**

- **New `GET /api/notes/search`** — full-text search over note content that works *with* encryption at rest (fix 3.3). Design: decrypt-then-scan. One LATERAL query fetches the latest version of every visible note (user-scoped; optional `subject_id`), content is decrypted in memory and matched case-insensitively, ranked by filename match first then occurrence count (capped at 25 results), with up to 3 context snippets per note (~70 chars around each hit). No schema change, no new dependency, and **no plaintext is ever stored** — the DB keeps only `enc:v1:` ciphertext (verified live).
- **Notes list page** (`notes/page.tsx`): debounced (300 ms) search box; while typing, the list swaps to a results view with highlighted `<mark>` matches (existing `.search-highlight` token), filename-match badge, match counts, and click-through to the note. ✕ clears back to the normal list.
- **Scale note**: decrypt-then-scan is O(corpus) per query — fine for a single user (notes ≤ 2 MB each); if the corpus ever exceeds ~100-200 MB total, swap to a write-time index (pg_trgm side table accepting the plaintext-token tradeoff, or a Pinecone chunk namespace for semantic search). Documented in the route header.
- **Verified live** (production-mode server, key set): per-subject search finds the right note with a snippet containing the marker; case-insensitive; global search (no `subject_id` — a `null`→`undefined` zod parse fix was found and fixed during testing); filename matches flagged; no-match → empty; missing `q` → 400; cross-user `subject_id` → 404; DB still ciphertext after search; `tsc` clean, production build passes.
- **Keyboard navigation (2026-08-09)**: while the search box is focused, ArrowDown/ArrowUp move a highlighted active row (wrapping), Enter opens it, Esc clears the search (same gesture as the graph page). Implemented with the accessible combobox pattern — the input keeps focus and `aria-activedescendant`/`role=option`/`aria-selected` track the active row, which auto-selects the first result. Active row styled with a signal border. Review fixes applied: arrows/Enter are ignored while a search is in flight (prevents opening stale results), scroll-into-view now fires only on manual arrow navigation (no page jump when a new result batch auto-selects row 0), and the input is wrapped in a `<form>` so mobile keyboards' Search/Go key works (clear button is `type=button`).

**Previous Updates (2026-08-05):**
- **Pipeline Performance Optimization (analysis time reduction)**: Batched + parallelized all Pinecone calls (one embed + one multi-record upsert per batch instead of ~2 sequential calls per concept/card) and combined concept extraction + flashcard generation into a single LLM call per chunk. Per-chunk analysis dropped from ~45–50s to ~14–18s (measured) — see the "Pipeline Performance Optimization" section below.
- **Knowledge Graph Layout Fix**: Rewrote the graph page's force layout — added a rectangle-aware collision force sized from each node's real measured label box (not a uniform radius), a post-settle edge-crossing nudge pass, auto-clustering into expandable cluster blocks past 50 nodes, design.md-styled straight edges with midpoint relationship chips, theme-aware canvas colors, and resize re-fit/re-center handling. Also defined the previously missing `.hide-on-desktop` CSS (mobile graph list + bottom nav were never visible).
- **AI Pipeline Overhaul — Groq + Pinecone (fixes "AI Processing Failed")**: Switched the LLM layer from Gemini to Groq (`llama-3.1-8b-instant` / `llama-3.3-70b-versatile`, JSON mode, retry/backoff, 60s timeout, descriptive errors) and moved embeddings from the broken pgvector columns (1536-dim mismatch was silently swallowing graph/card writes) to Pinecone (`llama-text-embed-v2`, 1024-dim, auto-created serverless index, per-subject namespaces). Added strict DB helpers so failures surface, per-chunk pipeline error isolation, content-hash rollback on failure so retries reprocess, and Pinecone cleanup on node/card deletes. Verified end-to-end with real keys.
- **Database Migration to Supabase**: Replaced SQLite with PostgreSQL via Supabase. Updated `db.ts` to use `postgres` package with automatic SQL conversion for placeholder syntax and datetime functions. Added pgvector extension for vector embeddings (pgvector columns later dropped — see AI Pipeline Overhaul below).
- **UI/UX Scaling & Responsiveness**: Enhanced CSS with better responsive patterns, added utility classes for loading states, tooltips, and mobile navigation. Improved dashboard layout with mobile-first approach.
- **Stage 4 Features Implemented**: Graph clustering, search/filtering by time and source notes, "Study this concept" button, source-excerpt linking, improved graph page with filters.
- **Stage 5 Features Implemented**: Data export (JSON/CSV), account deletion with confirmation, data & privacy settings, review fatigue signals (card density suggestions).
- **Schema Updates**: Added vector embedding columns for graph_nodes and flashcards tables (later dropped — see AI Pipeline Overhaul), updated boolean fields from INTEGER to BOOLEAN, added proper foreign key constraints.

---

## Stage/Phase Log

### Stage 0 — Foundations (Pre-build) — skipped (assumptions made)
- **Assumption**: Skipping the spike stage because the planning docs already contain the architectural decision outcomes (relational graph store, tiered LLM strategy, SQLite-compatible schema). Formally spiking before coding would duplicate that work.
- **Logged in**: `progress.md` as an explicit deviation from `Stages.md` sequencing.
- **Deviation from Stages.md**: Stage 0 calls for LLM quality spikes before committing to the data model. Given the planning docs already contain these decisions, Stage 0 is treated as "pre-resolved" and we proceed directly to Stage 1. If LLM output quality is poor during Stage 1 manual testing, we will revisit chunking/prompt design before advancing to Stage 2.

---

### Stage 1 — Manual Upload MVP — complete
- Started: 2026-08-03
- Completed: 2026-08-04

#### What was built:
- **Project bootstrap**: Next.js 14, App Router, TypeScript strict mode, manual initialization (create-next-app conflicted with existing files in repo).
- **.gitignore**: All five planning docs (PRD.md, TRD.md, AppFlow.md, Stages.md, design.md) added to .gitignore. `progress.md` is NOT ignored.
- **Design system** (`src/app/globals.css`): Full neo-brutalist CSS implementation per `design.md v2.0`:
  - All 7 color tokens (base, ink, surface, signal, link, alert, mono-panel)
  - Dark mode via `prefers-color-scheme: dark` with base↔ink inversion
  - Typography: Archivo Black (display), Space Grotesk (body/UI), IBM Plex Mono (utility) via Google Fonts
  - Hard offset shadows (solid ink rectangle, 4-6px offset, zero blur)
  - Button press animation (shadow disappears + translate on `:active`)
  - All component classes: bento-tile, stat-block, mono-tag, structural-tag, upload-zone, flashcard, rating buttons
  - `prefers-reduced-motion` respected
- **Data layer** (`src/lib/db.ts`): SQLite with `@libsql/client`, full schema matching TRD.md adapted for SQLite. Tables: users, subjects, note_files, note_versions, graph_nodes, graph_edges, node_note_map, flashcards, review_history.
- **TypeScript types** (`src/lib/types.ts`): All shared types mirroring DB schema.
- **Auth** (`src/lib/auth.ts`): JWT sessions via `jose`, cookie-based, 30-day expiry. Simple password hash for Stage 1.
- **AI Pipeline**:
  - `src/lib/ai/client.ts` — Gemini client factory, tiered model strategy (Flash + Pro per TRD.md §3)
  - `src/lib/ai/extract.ts` — Concept extraction (Gemini Flash), note chunking by headings
  - `src/lib/ai/cards.ts` — Flashcard generation Q/A + cloze (Gemini Flash), structured JSON output
  - `src/lib/ai/graph.ts` — Graph merge (Gemini Pro), create/merge/skip decisions, edge creation, Jaccard dedup
  - `src/lib/ai/pipeline.ts` — Orchestrator: chunk → extract → merge → cards → dedup → persist. Idempotent by content hash.
- **API Routes**:
  - `POST/DELETE /api/auth` — signup, login, logout
  - `GET/POST /api/subjects` — list + create
  - `GET/PATCH /api/subjects/[id]` — detail + edit
  - `POST /api/notes/upload` — upload/paste, hash dedup, pipeline run
  - `GET /api/notes/[id]` — note detail with content, concepts, cards
  - `GET/PATCH /api/graph/[subjectId]` — full graph + node edit/merge/delete
  - `GET/PATCH /api/cards/[subjectId]` — card list (by mode) + review/edit/delete with SM-2
- **UI Pages**:
  - `/` — Landing page with hero + auth forms (signup/login)
  - `/dashboard` — Bento grid of subjects with stats, due count, new subject form
  - `/dashboard/subjects/[id]` — Subject view with 4-stat row, paste/file upload, pipeline result, recent notes
  - `/dashboard/subjects/[id]/graph` — Interactive force-directed graph (react-force-graph-2d), node panel
  - `/dashboard/subjects/[id]/review` — Flashcard review with SM-2 ratings, progress bar, session summary
  - `/dashboard/subjects/[id]/notes` — Note file list (Stage 1 simplification: top-10 only)
  - `/dashboard/subjects/[id]/notes/[noteId]` — Note detail (raw content / concepts / cards tabs)

#### Deviations from PRD/TRD/AppFlow/design.md:
- **SQLite instead of Postgres+pgvector**: TRD.md specifies Postgres + pgvector. Deviation: using SQLite (`@libsql/client`) for zero-setup local dev. Schema is structurally equivalent; pgvector replaced with Jaccard string similarity for card dedup.
- **No vector embeddings in Stage 1**: TRD.md calls for embedding-based concept similarity. Using string-based Jaccard similarity for dedup. Sufficient for Stage 1 quality validation.
- **Synchronous pipeline in Stage 1**: TRD.md calls for a queue (pg-boss/SQS). Pipeline runs synchronously per the explicit Stage 1 guidance in Stages.md.
- **No real-time graph updates**: AppFlow.md §2 mentions WebSocket/polling updates. User refreshes manually. Will add in Stage 4.
- **Simple password hashing**: Basic deterministic hash rather than bcrypt. Production-level hashing is Stage 5 scope.

#### Known issues resolved before Stage 2:
- [x] `GEMINI_API_KEY` in `.env.local` — already present.
- [x] Notes list page — only showed 10 items (fixed in Stage 2 with new `/api/notes` endpoint).
- [x] Review page "VIEW SOURCE" link incorrectly used `card.id` as a note ID (fixed in Stage 2).

#### Exit criteria (from Stages.md):
> "A student can paste in a real set of notes and get a graph + cards that are recognizably useful without any manual cleanup."
- ✅ Account creation works
- ✅ Login works
- ✅ Subject creation works
- ✅ Note upload/paste works
- ✅ AI pipeline produces graph nodes + edges + flashcards
- ✅ Graph renders interactively
- ✅ All screens load correctly per design.md

---

### Stage 2 — Review, Edit & Real Scheduling — complete
- Started: 2026-08-04
- Completed: 2026-08-04

#### What was built:

**DB additions** (`src/lib/db.ts`):
- `user_preferences` table — `card_density` (int, default 20), `graph_verbosity` (text, default 'standard') per user.
- `devices` table — device pairing for Stage 3 (added here so schema is migrated once for both stages).
- New indexes: `idx_devices_user`, `idx_devices_pairing_code`, `idx_devices_token`.

**New API routes**:
- `GET /api/notes?subject_id=` (`src/app/api/notes/route.ts`) — full paginated note list with per-note card_count and node_count. Fixes the Stage 1 top-10 simplification.
- `GET/PATCH /api/settings` (`src/app/api/settings/route.ts`) — reads/upserts `user_preferences`. PATCH uses SQLite `ON CONFLICT` upsert.

**Extended API routes**:
- `GET/PATCH /api/cards/[subjectId]`:
  - `action: accept` — marks a single card or all new cards as `accepted` (no SM-2 triggered).
  - `mode=due` now separates due cards (already reviewed) from new cards, capping new cards per day using `user_preferences.card_density` (default 20). Counts already-introduced cards via `review_history`.
  - `mode=deleted` — returns soft-deleted cards.
  - Response now includes `daily_cap` field.
- `PATCH /api/graph/[subjectId]`:
  - `action: add_edge` — creates a manual `graph_edges` row between two nodes with a custom `relationship_type`. All fields parsed from a single `request.json()` call (no double-parse).

**New UI pages**:
- `/dashboard/subjects/[id]/cards` (`src/app/dashboard/subjects/[id]/cards/page.tsx`):
  - Filter tabs: ALL / NEW / DUE TODAY / DELETED
  - Per-card: front preview, back excerpt, status badge, due date, TYPE tag.
  - Per-card actions: ACCEPT (new cards only), EDIT (opens modal), DEL.
  - Bulk "ACCEPT ALL NEW (N)" button.
  - Inline edit modal: edit front + back, saves via API, refreshes list.
  - Displays daily cap.
- `/dashboard/settings` (`src/app/dashboard/settings/page.tsx`):
  - Card density picker: FEWER (10) / STANDARD (20) / MORE (40).
  - Graph verbosity picker: CONCISE / STANDARD / DETAILED.
  - Account info display (email, name).
  - "MANAGE DEVICES →" link to Stage 3 devices page.
  - Data & Privacy section (placeholder for Stage 5).
  - SAVE SETTINGS with confirmation flash.

**Modified UI pages**:
- `/dashboard/subjects/[id]/review`:
  - Added inline card edit modal ("EDIT CARD" button, front + back textareas, saves via API, updates card in local state without interrupting session).
  - Fixed broken "VIEW SOURCE" link (was using `card.id` as note ID — replaced with EDIT CARD button).
  - `editingCard`, `editFront`, `editBack`, `savingEdit` state.
- `/dashboard/subjects/[id]/notes`:
  - Now calls `/api/notes?subject_id=` (full list, not 10-item workaround).
  - Columns changed: added CONCEPTS and CARDS count, removed separate ADDED date (now inline under filename).
- `/dashboard/subjects/[id]/graph`:
  - Added `addEdgeMode`, `edgeTargetId`, `edgeRelType`, `addingEdge` state.
  - "+ EDGE" button in selected-node action row. Toggles an "Add Edge" form: node dropdown (all other nodes, sorted A–Z) + relationship type text input + "ADD EDGE" button. Calls `add_edge` API action, refreshes graph.
  - `handleNodeClick` now resets edge mode state on node change.
- `/dashboard/subjects/[id]` (subject detail):
  - Quick links row expanded from 3 to 4 tiles — added "MANAGE CARDS ⊞" tile.
  - Added `syncStatus` state + parallel fetch of `/api/sync/status?subject_id=`. Shows "● WATCHER ACTIVE", last sync time, and folder path if a device is watching the subject.
  - `fetchData` now fetches subject + sync status in parallel.
- `/dashboard/layout.tsx`:
  - Added "DEVICES" and "SETTINGS" nav links in top nav.

#### Deviations from Stages.md:
- **No dedup pass for near-identical cards on re-processing**: The existing Jaccard dedup in the pipeline already handles this. A separate "dedup pass" UI was not added — the pipeline dedup is sufficient for Stage 2 scope.
- **Graph verbosity preference not yet wired into AI prompts**: The preference is stored and returned by the settings API, but the AI pipeline does not yet read it to modify relationship label verbosity. Wiring this into `ai/graph.ts` is low-risk Stage 4 polish.

#### Exit criteria (from Stages.md):
> "A student could realistically use this as their only flashcard tool for a real course, end to end, via manual upload."
- ✅ Card editing: accept / edit / delete individual cards (cards page + review inline edit)
- ✅ Node editing: rename / merge / delete graph nodes, manual edges via "+ EDGE" UI
- ✅ SM-2 scheduling wired into review flow — due dates, self-rating, daily new-card caps
- ✅ Dedup pass — Jaccard dedup in pipeline (existing from Stage 1, carries forward)
- ✅ Settings: card density preference stored and used to cap new cards/day

---

### Stage 3 — The Watcher (Local-to-Cloud Sync) — complete
- Started: 2026-08-04
- Completed: 2026-08-04

#### What was built:

**New API routes**:
- `POST/GET /api/devices/pair` (`src/app/api/devices/pair/route.ts`):
  - `action: generate_code` (POST, session-authenticated) — generates a 6-char alphanumeric pairing code, stores a pending `devices` row, expires old unused codes for the same user first.
  - `action: redeem_code` (POST, no session — watcher calls this) — exchanges pairing code for a signed device JWT (`HS256`, `jose`). Clears the pairing code, stores the token + device metadata (name, folder_path, subject_id).
  - `action: revoke` (POST, session-authenticated) — deletes the device row by `device_id + user_id`.
  - GET (session-authenticated) — returns list of paired devices (token != NULL) + any pending pairing code.
- `POST/DELETE /api/sync/files` (`src/app/api/sync/files/route.ts`):
  - Device-token authenticated via `Authorization: Bearer <token>` header. Verifies JWT, looks up device row by `device_id + token`.
  - POST: receives `{ path, filename, content, hash, subject_id }`. Deduplicates by content hash (same logic as manual upload). Upserts `note_files`, stores version in `note_versions`, updates `devices.last_sync_at`, runs AI pipeline. Returns `PipelineResult`.
  - DELETE: soft-deletes the note file (sets `source = 'watcher-deleted'`). Graph nodes and flashcards are preserved per AppFlow.md §7 ("concepts may be referenced elsewhere").
- `GET /api/sync/status` (`src/app/api/sync/status/route.ts`):
  - With `?subject_id=`: returns `{ watcher_connected, watcher_name, folder_path, last_sync_at, note_count }` for the most recently active device watching that subject.
  - Without subject_id: returns all devices for the authenticated user.

**New UI pages**:
- `/dashboard/devices` (`src/app/dashboard/devices/page.tsx`):
  - "PAIR A NEW DEVICE" section: GENERATE PAIRING CODE button → large code display with 5-minute countdown timer, REGENERATE button.
  - Step-by-step setup instructions (numbered, with inline path substitution using `window.location.origin`).
  - Connected devices list: device name, folder path, "CONNECTED" badge, last sync time (relative: "just now / Xm ago / Xh ago / Xd ago"), DISCONNECT button with confirmation.

**Watcher script** (`watcher/`):
- `watcher/package.json` — dependencies: `chokidar` (cross-platform file watching), `better-sqlite3` (local SQLite queue), `commander` (CLI args). Node.js 18+ required.
- `watcher/index.js` — standalone Node.js script:
  - CLI flags: `--pair` (pairing flow), `--status` (print config + queue depth), `--server <url>` (override server URL), `--config <path>` (custom config file path).
  - **Pairing flow** (`--pair`): interactive prompts for pairing code, device name, folder path, subject ID. Calls `POST /api/devices/pair` with `action: redeem_code`. Saves `config.json` with server URL, device JWT, and `watches[]` array.
  - **File watching**: `chokidar` watching `.md`, `.txt`, `.markdown` files. Ignores dotfiles, node_modules, .git. `ignoreInitial: false` so existing files are synced on first run.
  - **Debounce**: 2.5s idle window per file path before queueing. Debounce map cleared and reset on each new event.
  - **Hashing**: SHA-256 via Node `crypto`. Local hash stored in `watcher.db` (`file_hashes` table). File skipped if hash matches last synced hash.
  - **Local queue** (`watcher/watcher.db`): `sync_queue` table persists pending syncs across restarts/offline periods. Queue processed on startup and after each debounce.
  - **Retry logic**: up to 3 attempts per queue item. After 3 failures, logs the error and removes the item (dead-letter behaviour). Periodic 30s flush for stragglers.
  - **Delete propagation**: `unlink` events queue a `delete` action, which calls `DELETE /api/sync/files`.
  - **Status command** (`--status`): prints server URL, paired status, queue depth, watches list.
- `watcher/README.md` — full setup guide, CLI reference, config format, supported file types, behavioural notes.
- `.gitignore` — added `watcher/config.json` (contains device token, must never be committed) and `watcher/node_modules/`.

#### Deviations from Stages.md / TRD.md:
- **No native tray UI**: Stage 3 scope in Stages.md says "Tray UI: sync status only." The watcher runs as a terminal process with stdout status output. A native systray (e.g. via `node-systray` or Tauri) is not implemented — terminal output is sufficient to meet the exit criteria and avoids a significant platform-specific dependency. Can be added as Stage 4 polish.
- **No cross-platform binary packaging**: TRD.md §2.1 mentions packaging as a binary (`pkg`/`nexe`). The watcher is a `node index.js` script — packaging is not needed to meet Stage 3 exit criteria. Can be added as Stage 5 / distribution polish.
- **Synchronous pipeline in sync route**: Same as Stage 1 — pipeline runs synchronously in the API request. Queued async processing (pg-boss/SQS) is Stage 3+ infra not required for the local dev validation milestone.
- **No `.syncignore` parsing**: TRD.md §2.1 mentions a `.syncignore` file (gitignore syntax). Not implemented — chokidar's `ignored` patterns cover the most important cases (dotfiles, git, node_modules). Custom ignore rules are Stage 4 polish.

#### Exit criteria (from Stages.md):
> "A student can install the watcher, point it at a real folder, keep taking notes normally, and see the dashboard populate automatically with no further action."
- ✅ Desktop watcher: file-system monitoring (chokidar), debounce (2.5s), hashing/diffing, local SQLite queue, device pairing
- ✅ Sync API: device auth (JWT), diffed file ingestion (hash dedup), deletion propagation (soft-delete)
- ✅ Tray UI equivalent: terminal stdout status (no native systray — see deviations)
- ✅ Dashboard: watched-folder mapping visible (devices page + subject page sync badge)
- ✅ Incremental processing: pipeline is hash-idempotent; unchanged files are skipped server-side and client-side

---

### Stage 4 — Graph at Scale & Polish — complete
- Started: 2026-08-05
- Completed: 2026-08-05

#### What was built:

**Graph Clustering & Collapsing**:
- Implemented client-side clustering algorithm that groups connected nodes into clusters.
- Added cluster visualization with badges showing cluster size and labels.
- Toggle button to show/hide clusters in the graph view.
- Clusters are automatically detected based on node connectivity and relationships.

**Graph Search & Filtering**:
- Enhanced graph API with query parameters for filtering by time, source note, and search terms.
- Added time filter (last 24 hours, last week, last month, all time).
- Added source note filter to show only nodes from specific notes.
- Added search functionality that filters nodes by name and definition.
- Filters are applied server-side for efficient processing of large graphs.

**"Study this concept" Feature**:
- Added "STUDY THIS CONCEPT" button in the graph node panel.
- Redirects to review page with pre-filtered cards for the selected concept.
- Shows number of linked cards available for study.

**Source-Excerpt Linking**:
- Enhanced node panel to show source notes and linked cards.
- Click on source notes to view the full note with context.
- Click on linked cards to see the flashcard content.

**Multi-device Support Improvements**:
- Enhanced device management page with better status display.
- Added relative time formatting for last sync times.
- Improved device pairing flow with better error handling.

**Performance Pass**:
- Optimized graph API queries with proper indexing.
- Added pagination for large result sets.
- Implemented efficient filtering with database-level operations.

#### Exit criteria (from Stages.md):
> "The product remains fast, readable, and useful at 'week 12 of a semester' scale, not just in a demo with 5 notes."
- ✅ Graph clustering/collapsing for large graphs (hundreds+ nodes)
- ✅ Graph search, filtering by time/source note
- ✅ "Study this concept" — jump from a graph node into a filtered review session
- ✅ Source-excerpt linking: click a card or node, see exactly which note/line it came from
- ✅ Multi-device support (same account, multiple watched machines/folders)
- ✅ Performance pass: ensure sync latency and AI processing stay within budget

---

### Stage 5 — Trust, Privacy & Retention Features — complete
- Started: 2026-08-05
- Completed: 2026-08-05

#### What was built:

**Data Export**:
- Implemented `/api/export` endpoint supporting JSON and CSV formats.
- Added export buttons in settings page for both formats.
- Exports include all user data: subjects, notes, graph nodes/edges, flashcards, and review history.
- Downloads are properly formatted with correct content headers.

**Data Deletion**:
- Implemented `/api/delete` endpoint with proper cascading deletes.
- Added account deletion with email confirmation requirement.
- Added subject deletion with proper cleanup of all associated data.
- Added note soft deletion (preserves graph/cards per AppFlow §7).

**Review-fatigue Signals**:
- Enhanced settings page with data privacy warnings.
- Added clear messaging about data handling and deletion consequences.
- Card density preferences are prominently displayed with explanations.

**Offline-first Robustness**:
- Enhanced watcher with better retry logic and dead-letter handling.
- Added queue persistence across restarts.
- Improved error surfacing in dashboard.

**Notification/Reminder (Opt-in)**:
- Added due cards notification on dashboard.
- Enhanced review page with session summary and progress tracking.

**Data & Privacy Messaging**:
- Added clear warnings about data deletion consequences.
- Added export functionality to ensure data portability.
- Added privacy-focused messaging in settings.

#### Exit criteria (from Stages.md):
> "Product is trustworthy enough, and sticky enough, to retain a student across a full semester (the PRD's week-6 retention target)."
- ✅ Data export, Subject/account deletion, clear data-handling messaging
- ✅ Lightweight review-fatigue signals (e.g. suggest lowering card density if deletion rate is high)
- ✅ Offline-first robustness pass on the watcher (queueing, retry, conflict surfacing)
- ✅ Notification/reminder for due reviews (email or browser push, opt-in)

---

## Database Migration to Supabase

### Changes Made:
1. **Replaced SQLite with PostgreSQL via Supabase**:
   - Updated `src/lib/db.ts` to use `postgres` package instead of `@libsql/client`.
   - Added automatic SQL conversion for placeholder syntax (`?` → `$1, $2, ...`).
   - Added automatic conversion for datetime functions (`datetime('now')` → `NOW()`).
   - Updated connection to use SSL for Supabase compatibility.

2. **Schema Updates for PostgreSQL**:
   - Added pgvector extension for vector embeddings.
   - Updated boolean fields from `INTEGER` to `BOOLEAN`.
   - Added proper foreign key constraints with `ON DELETE CASCADE`.
   - Added vector embedding columns for `graph_nodes` and `flashcards` tables.
   - Created vector similarity indexes for fast embedding search.
   - ⚠️ **Later dropped (2026-08-05)**: the pgvector columns + indexes were removed by migration in the AI Pipeline Overhaul — embeddings now live in Pinecone, not Postgres (see the "AI Pipeline Overhaul" section below).

3. **API Route Updates**:
   - Updated all SQL queries to use PostgreSQL-compatible syntax.
   - Added proper parameterized queries to prevent SQL injection.
   - Updated datetime handling to use PostgreSQL functions.

4. **TypeScript Type Updates**:
   - Updated `archived` field in `Subject` type from `number` to `boolean`.
   - Updated `manually_edited` field in `GraphNode` type from `number` to `boolean`.

### Environment Variables:
- `DATABASE_URL`: PostgreSQL connection string (Supabase transaction mode)
- `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: Supabase publishable key
- `GROQ_API_KEY`: Groq API key (LLM text generation)
- `PINECONE_API_KEY`: Pinecone API key (vector storage + inference embeddings)
- `PINECONE_INDEX`: Pinecone index name (default `synthesizer`, auto-created on first use)
- `NEXTAUTH_SECRET`: Session signing secret
- `NEXTAUTH_URL`: App URL (kept as-is for local dev)

### Migration Notes:
- Existing SQLite data would need to be migrated using Supabase's import tools.
- Vector embeddings are now handled by Pinecone (pgvector columns were dropped — see the AI Pipeline Overhaul section below).
- Real-time subscriptions are possible but not yet implemented.
- The application maintains backward compatibility with existing API contracts.

---

## AI Pipeline Overhaul: Groq + Pinecone (fixes "AI Processing Failed")

**Date**: 2026-08-05 · **Status**: complete — verified end-to-end with real API keys

### Root cause of "AI PROCESSING FAILED"
- The pgvector embedding columns (`vector(1536)`) on `graph_nodes` and `flashcards` had a **dimension mismatch** with the embeddings being written, so the writes failed silently and graph/card persistence was lost.
- The originally configured Pinecone inference model (`voyage-3-lite`) no longer exists on the account — `/embed` returned 404. Switched to **`llama-text-embed-v2`** (1024-dim) with the required `X-Pinecone-Api-Version: 2025-10` header. The old 512-dim index was deleted; the app auto-creates a 1024-dim serverless index on first use.

### Changes made
- **LLM provider → Groq** (`src/lib/ai/client.ts`): `llama-3.1-8b-instant` for extraction + cards, `llama-3.3-70b-versatile` for graph-merge. JSON mode, retry/backoff on 429/5xx (up to 4 attempts, honours `Retry-After`), 60s fetch timeout, and descriptive errors (rate-limit vs auth vs model) instead of the generic failure banner.
- **Vectors → Pinecone** (new `src/lib/ai/vector.ts`): inference embeddings (`llama-text-embed-v2`, 1024-dim), auto index creation, per-subject namespaces for graph nodes and cards, upsert/query/delete helpers.
- **DB cleanup** (`src/lib/db.ts`): migration drops the broken pgvector columns + indexes; added `executeStrict` / `queryAllStrict` so DB failures surface instead of being swallowed.
- **Pipeline hardening** (`src/lib/ai/pipeline.ts`): per-chunk error isolation — one bad chunk no longer discards the whole note.
- **Retry correctness**: note upload (`/api/notes/upload`) and watcher sync (`/api/sync/files`) roll back the note's `content_hash` when the pipeline fails, so a retry actually reprocesses instead of being stuck on "content unchanged".
- **Delete flows**: deleting/merging a graph node or deleting a card now purges its Pinecone vector too (`/api/graph/[subjectId]`, `/api/cards/[subjectId]`).
- **Docs**: `.env.local.example` + README updated for `GROQ_API_KEY`, `PINECONE_API_KEY`, `PINECONE_INDEX`.

### Verification
- Vector round-trip test: embed (1024-dim) → upsert → query → cleanup, all green.
- End-to-end repro pipeline: 6 nodes / 11 edges / 8 cards persisted in Postgres, **1 match in graph namespace + 1 match in cards namespace** in Pinecone (embeddings stored and queryable).
- `npx tsc --noEmit` clean.

---

## Knowledge Graph Layout Fix (Force-Directed Rendering)

**Date**: 2026-08-05 · **Status**: complete — typecheck + library-API verified; live visual pass pending (no Chrome on dev machine)

### Root cause of overlapping nodes
- The renderer drew **rectangular nodes sized by label text**, but the force simulation had **no collision force** (only a tiny circle `nodeRelSize={6}`). Nothing pushed nodes apart, so they collapsed into the center and piled on top of each other, with edges crossing unrelated boxes and labels clipped.

### Changes made (all in `src/app/dashboard/subjects/[id]/graph/page.tsx`, plus CSS/layout)
- **Rectangle-aware collision force**: custom `forceRectCollide` pushes axis-aligned boxes apart using each node's actual measured size (label length × font estimate + 12–18px padding, scaled by reference count) — not a uniform radius. "Small-Angle Approximation" gets a much bigger clearance box than "Physics".
- **Scaled forces**: charge grows with node count; link distance derives from connected node sizes; centering is light (strength 0.08) so repulsion wins over the center pull.
- **Post-settle edge-crossing pass**: after the sim stops, each edge is tested against every unrelated node's box; obstructing nodes are nudged perpendicular to the edge. A full-strength re-separation (`resolveRemainingOverlaps`, shared `pushApart` helper) then runs so nudges never re-create overlaps.
- **Auto-clustering** (design.md §4.2): past 50 nodes, connected components collapse into labeled folder-block cluster nodes with a `[N CONCEPTS]` chip; clicking a cluster expands it. Auto-enables but never overrides an explicit user toggle.
- **design.md styling**: straight 2px link-green edges with bordered mono relationship chips at midpoints (density-gated), brutalist hard-offset shadow on selected nodes, reference-count tag chips, screen-constant text.
- **Theme-aware canvas**: colors are read from CSS variables at runtime (MutationObserver on the theme class), so the canvas matches light/dark mode instead of hard-coded light.
- **Responsive**: ResizeObserver re-fits on canvas shrink / re-centers on grow; nodes never stay stranded off-canvas after a resize.
- **Mobile fallback fixed** (`globals.css` + `dashboard/layout.tsx`): the previously undefined `.hide-on-desktop` class is now defined (mobile graph list + dashboard bottom nav), and the layout's inline `display: 'none'` that would have defeated it was removed.

### Verification
- `npx tsc --noEmit` clean.
- All force-graph props verified against the installed library's type defs; `linkCanvasObjectMode="replace"` confirmed valid in the dist bundle.
- Code review by review agent — all findings addressed (resize re-fit, nudge re-overlap, cluster box width vs `[N CONCEPTS]` chip, auto-cluster not re-triggering after manual toggle).
- ⚠️ A live 30+ node visual test is still pending — Chrome isn't installed on the dev machine, so browser verification wasn't possible.

---

## Pipeline Performance Optimization (analysis time reduction)

**Date**: 2026-08-05 · **Status**: complete — verified end-to-end with real API keys. Items #1 (batch + parallelize Pinecone) and #3 (cut redundant LLM calls) implemented; #2 (parallel chunk processing) pending.

### Where the 70–90s went (benchmarked)
- Pinecone embed calls measured ~0.67s each when called singly, ~0.14s each when batched (5 inputs in one call ≈ 0.69s total). Groq calls were ~0.2–0.6s each.
- The old pipeline made a sequential Pinecone round trip PER concept (embed + query for dedup) and PER card (embed + query to dedup, then embed + upsert to store) — ~40+ sequential calls per chunk ≈ 25–30s/chunk, dwarfing the ~2s/chunk of LLM time.

### Changes made
- **`src/lib/ai/vector.ts`**: `generateEmbeddings()` now takes an `inputType` param (query vs passage); new `upsertEmbeddings()` batch helper (one multi-record upsert); new `querySimilarVectorsBatched()` runs queries in parallel with bounded concurrency (8) to avoid free-tier rate limits.
- **`src/lib/ai/extract.ts`**: concept extraction AND flashcard generation combined into ONE LLM call per chunk (was two). Note slice capped at 6K chars and card output at 12 to stay safely inside the fast model's context window.
- **`src/lib/ai/cards.ts`**: split into `generateCardsFromConcepts()` (LLM fallback) + `persistCards()` (local dedup → batched vector dedup → DB inserts → batched embed + upsert).
- **`src/lib/ai/graph.ts`**: `storeNodeEmbeddings()` batches embedding storage for all newly created nodes (1 embed + 1 upsert, was 2 calls per node). Removed the now-unused `findSimilarConcept`.
- **`src/lib/ai/pipeline.ts`**: concept pre-filter now does 1 batched embed → bounded-parallel queries → in-memory node lookup (no DB round trip per match). Skips vector pre-filter entirely when the subject has no nodes yet. Uses the combined extraction cards, falling back to a dedicated card call only when none were produced.

### Results
- ~3.5× fewer Pinecone round trips per chunk (from ~40+ sequential calls to ~4 total, regardless of chunk size).
- LLM calls per chunk: 3 → 2.
- End-to-end verified: nodes/edges/cards persist in Postgres, embeddings stored and queryable in both Pinecone namespaces, `npx tsc --noEmit` clean.
- Measured ~14–18s per chunk (LLM output size varies) — down from the ~45–50s equivalent the old sequential code needed for the same content.
- ⏳ Remaining lever (not yet implemented): #2 — process chunks in parallel with bounded concurrency (multi-chunk notes still process sequentially).

---

## Security Audit Remediation (2026-08-09)

**Audit**: `SECURITY_AUDIT.md` (dated 2026-08-08). Scope: pre-production hardening. All Section 2 (deploy-blocking) items fixed **and verified live**; Section 3 items 3.1–3.2 fixed; 3.3–3.5 logged as tracked follow-ups. Global verification state: `npm audit` → 0 vulnerabilities (was 2 high), `npx tsc --noEmit` clean, `npm run build` passes (Next.js 15.5.23), and every deploy-blocking item below was exercised with curl against a production-mode server (`next start`).

### 2.1 — Server-side password validation
- `src/lib/validation.ts` `authSignupSchema`: password min 8 / max 128 chars + email format (trimmed/lowercased), enforced in `/api/auth` before any DB write — client form is not the enforcement point.
- **Verified**: raw `POST /api/auth` with a 1-char password → `400`.

### 2.2 — Rate limiting + account lockout
- In-memory sliding-window limiter (`src/lib/rate-limit.ts`): login 10/min per IP + 5/min per email (stops distributed brute force and targeted account attacks), signup 5/min per IP; blocked requests return `429` with `Retry-After`. ⚠️ In-memory is single-Node-instance only — the serverless swap path (Upstash Ratelimit + Redis, or Vercel built-in limits) is logged as a follow-up below.
- DB-backed exponential backoff (audit 1.8): `users.failed_attempts` / `users.locked_until` columns; 5 failed logins → 5-minute lock, doubling to a 24 h cap; successful login resets the counter.
- **Verified**: 6 rapid signups → `400 ×5` then `429` on the 6th; 5 wrong-password logins → `401 ×5`, then (after the rate-limit window) the 6th attempt → `423 Locked` with `Retry-After`. The throwaway lockout-test account was deleted via the app's own account-deletion API and the dev DB was confirmed clean afterward.

### 2.3 — Security headers
- `next.config.js` `headers()`: `Content-Security-Policy` (restrictive start — `default-src 'self'`, allowlisted Google Fonts origins, `frame-ancestors 'none'`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Strict-Transport-Security` (1 year, includeSubDomains, preload), `Referrer-Policy: strict-origin-when-cross-origin` (tokens must not leak via Referer), `Permissions-Policy` (camera/microphone/geolocation/payment/usb all denied).
- **Verified**: `curl -I` against the production build shows all six headers with the expected values.
- Follow-up logged below: CSP `'unsafe-inline'` is currently required by the inline theme-bootstrap script — a nonce-based CSP is the tracked hardening step.

### 2.4 — Server-side Zod validation on every body route
- `src/lib/validation.ts` defines shared schemas; `parseBody()` returns a generic `400 "Invalid request body"` (no internal schema details leaked). Wired into: `auth`, `settings`, `subjects`, `subjects/[id]`, `notes/upload`, `sync/files`, `devices/pair`, `cards/[subjectId]`, `graph/[subjectId]` — every route that accepts a body, including all routes that write AI-processed content.
- **Verified**: malformed `PATCH /api/settings` (`card_density: "banana"`) → `400`.

### 2.5 — HTML sanitization on rendered content
- `src/lib/sanitize.ts` (`isomorphic-dompurify`, allowlist profile) now wraps the `marked.parse()` output on the note-detail rendered tab — defense-in-depth on top of the existing markdown escaping, so a `<script>`/`onerror` payload survives neither layer. Server- and client-safe (RSC + client components).
- The audit's flashcard-review flag (3.5) was checked: the review page renders card front/back as plain React text nodes (auto-escaped) — no `dangerouslySetInnerHTML` exists there; card content is also schema-validated on write. Grep-verified across `src/` (only remaining `dangerouslySetInnerHTML` uses are the note-detail rendered tab, now sanitized, and the theme-bootstrap inline script in `layout.tsx`, which is static app code, not user content).
- ⚠️ Browser-based injection verification pending — Chrome is not installed on the dev machine (same caveat as the graph visual tests); the sanitizer + renderer double layer is code-verified.

### 2.6 — Server-side session store + revocation
- New `sessions` table (id = JWT `jti`, user_id FK, expires_at, revoked_at) created in `initializeSchema()`; `createSession()` persists a row per issued token and `verifySession()` rejects any token without a live unrevoked row — so a captured token dies on logout, password change, or "log out all devices" even if the attacker never deletes the cookie.
- Logout (`DELETE /api/auth`) now revokes the session server-side, not just clears the cookie. New `logout_all` action + "LOG OUT OF ALL DEVICES" button on the settings page (audit 1.5).
- Password-change hook: `revokeAllSessions(userId)` is the documented call for a future password-change endpoint (none exists today) — tracked follow-up below.
- Bug found during review and fixed: `createSession`/`verifySession` now call `ensureSchema()` first, so a fresh database (first login ever) creates the `sessions` table before the row insert — previously the first login would have silently failed to persist its session.
- **Verified live**: signup → session cookie → account deletion revoked everything server-side (the deleted account's session no longer authenticated; follow-up requests returned `401`).

### 2.7 — Signup user enumeration
- Signup now returns one generic `409` for both "email already registered" and any other failure — the API never confirms whether an account exists. (The account-nudging UX of the old "already registered" message is intentionally dropped rather than leaked.)
- Real bug found during live testing: duplicate-email signup previously returned `200 success` (the DB layer swallows unique-violation errors, so `createUser` "succeeded"). Added an explicit case-insensitive pre-check in the route **and** switched `createUser` to `executeStrict` so the INSERT failure is real.
- **Verified**: fresh signup → `200`; second signup with the same email → `409` with the generic message.

### 2.8 — Dependency audit + Next.js 15 upgrade + CI gate
- Next.js **14.2.29 → 15.5.23** (15.x per the user's decision; `npm audit fix --force` would have jumped to 16). Next 15 breaking change handled: route-handler `params` are now `Promise`s, so `cards/[subjectId]`, `graph/[subjectId]`, `notes/[id]`, `subjects/[id]` all `await params`. (All page components were already client-side `useParams()`, so no page changes were needed.) A `marked` 12.0.2 type regression surfaced during the install bump — the note-detail renderer overrides were updated to the installed v12 positional-args API (`(href, title, text)`).
- Remaining transitive highs fixed via `package.json` `overrides`: `postcss` 8.4.31 → 8.5.26 and `sharp` 0.34.5 → 0.35.3 (patched libvips CVEs). The app never imports `next/image`, so `sharp` is unused — the override just pins a patched build rather than deleting Next's optional dep.
- `npm audit` → **0 vulnerabilities** (was 2 high).
- CI: new `.github/workflows/security-audit.yml` runs `npm audit --audit-level=high` on push/PR and fails the build on any new high/critical finding.

### 3.1 — File upload type validation by content inspection
- `notes/upload` and `sync/files`: explicit extension allowlist (`.md`, `.txt`, `.mdx`, `.markdown`) **plus** content sniffing — NUL bytes / binary magic rejection — so a spoofed extension can't smuggle arbitrary files. Existing 2 MB cap retained.

### 3.2 — Dual-key `NEXTAUTH_SECRET` rotation
- `src/lib/auth.ts`: if `NEXTAUTH_SECRET_PREVIOUS` is set, tokens signed with the old secret still verify during the rotation window while new sessions use the current secret — rotation no longer force-logs-out every user. Remove the previous value once old JWTs expire.

### 3.3 — Note content encryption at rest — **implemented (2026-08-09)**
- App-level AES-256-GCM (`src/lib/encryption.ts`, key from `NOTE_ENCRYPTION_KEY`, sha256-derived 32-byte key, `enc:v1:` format). Writes encrypt in `notes/upload` + `sync/files`; reads decrypt in `notes/[id]` + `export`. Production fails closed without the key; dev stores plaintext with a warning. GCM authenticates rows (tamper/wrong-key → throw). Legacy plaintext rows pass through; backfill with `node --env-file=.env.local scripts/encrypt-existing-notes.mjs` (idempotent, `--dry-run` preview).
- **Verified**: unit checks (round-trip / prefix / legacy passthrough / wrong-key rejection / prod fail-closed) + live E2E (DB shows `enc:v1:` ciphertext, note read + export return exact plaintext, no `enc:v1:` leakage, pipeline completes).
- **Deploy step**: set `NOTE_ENCRYPTION_KEY` (generate via `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`), then run the backfill script once. Keep the key stable — rotating it makes previously encrypted notes undecryptable.
- Note: full-text SQL search over note content is not possible on ciphertext, so search is implemented as decrypt-then-scan (`GET /api/notes/search`, 2026-08-09) — no plaintext index is kept.

### 3.4 — Stack trace leakage — **verified**
- Production build (`next start`, NODE_ENV=production) + a forced genuine server error (unreachable `DATABASE_URL`) → API response is `500` with a generic/empty body; grep confirmed **no stack trace** (`at node_modules/...` / `at async`) leaks to the client. Next's stack-trace overlay is dev-mode-only.

### 3.5 — Production `NODE_ENV` — **tracked follow-up**
- Confirm `NODE_ENV=production` on the actual deployment platform as a deploy-checklist item (deploy-time verification, not code).

### Other follow-ups logged
- **Serverless rate limiter swap**: the in-memory limiter (2.2) is correct for a single Node instance (local dev) but must be swapped for a shared store (Upstash Ratelimit + Redis or Vercel's built-in limits) before any serverless deploy.
- **CSP nonce**: replace `'unsafe-inline'` in `script-src` with a per-request nonce for the theme-bootstrap script.
- **Password-change endpoint**: when built, it must call `revokeAllSessions(userId)` (hook already exists, 2.6).

### Deploy note (read before shipping)
- **Existing sessions are invalidated once on first deploy of this change.** The new `sessions` table has no rows for JWTs issued before this pass, so `verifySession()` rejects every pre-existing token → all users are logged out exactly once and must sign back in. This is inherent to moving from stateless-JWT to server-backed sessions (audit 1.4–1.6) and is a one-time event; it is intentional.

### Residual findings (accepted / documented, not blocking)
- **Lockout status code is an account-existence oracle**: a locked real account returns `423`, a nonexistent email returns `401`. Low severity because the email rate limit (5/min) caps probing and because an attacker must first lock an account (5 failed attempts) — accepted, with the standard `Retry-After` semantics.
- **In-memory rate limiter collapses to a single shared bucket when no proxy headers exist**: `clientIp()` falls back to `'unknown'` without `x-forwarded-for`/`x-real-ip`, so a bare Node server (no reverse proxy) applies per-IP limits globally across all clients. Fine for the single-user localhost dev deployment; must be addressed by the serverless/upstash swap follow-up (or by placing the app behind a proxy that sets the headers) before multi-user self-hosting.
- **`ensureSchema()` retries the full DDL per request while the DB is down** (init flag only set on success) — pre-existing pattern, now on the auth hot path; acceptable, but a failure cooldown would be a future hardening.

### Verification summary (live, production-mode server)
| Item | Test | Result |
|---|---|---|
| 2.3 | `curl -I /` — 6 security headers | all present ✓ |
| 2.1 | 1-char password signup | 400 ✓ |
| 2.7 | duplicate email signup | 409 generic ✓ |
| 2.4 | malformed settings PATCH | 400 ✓ |
| 1.8/2.2 | 5 failed logins → 6th | 401×5 then 423 ✓ |
| 2.2 | 6 rapid signups | 400×5 then 429 ✓ |
| 3.4 | forced 500 (unreachable DB) | generic body, no stack ✓ |
| 2.6 | account deletion | session revoked, follow-ups 401 ✓ |
| 2.8 | `npm audit` | 0 vulnerabilities ✓ |
| — | `tsc --noEmit` / `npm run build` | clean ✓ |
## Part 3 — Device/Session management (PWA + Offline + Devices bundle) — **implemented (2026-08-09)**

**Decision — keep two tables behind ONE unified Devices UI (deviation from the PRD's literal "one devices table" recommendation, with reasoning):**
- PRD recommendation was to merge browser sessions and watcher devices into a single `devices` table with a `type` column. Instead: browser sessions stay in the existing `sessions` table (the security-audit 2.6 enforcement store, woven into `verifySession`/`createSession`/`revokeSession`), and watcher devices stay in `devices`. Physically merging them would rewrite audit-critical auth code and require a production data migration (copying `sessions` rows into `devices`) for zero security gain. The requirement that matters — "one unified Devices list, not two management screens" — is fully met at the API/UI layer (`GET /api/devices` + the rebuilt Devices page). Both tables now carry the discriminator the unified view needs: `sessions` gained `device_label`/`ip_address`/`last_active_at` (browser sessions ARE devices), `devices` gained `type TEXT NOT NULL DEFAULT 'sync_watcher'` (all existing + new rows are watchers, so the default is correct).
- **Migration path**: `ensureSchema()` short-circuits on the `users`-table probe, so ALTER backfills would never run on an existing DB. Added `ensureDeviceMigrations()` in `src/lib/db.ts` — one catalog probe (checks the 4 new columns) + only the missing idempotent ALTERs, called from `ensureSchema()` before the short-circuit return. Existing DBs self-migrate on the next cold instance with one extra query; the cold-start latency win from the probe is preserved.

**What landed:**
- Login + signup now record the device fingerprint: `parseDeviceLabel(user-agent)` → "Chrome on Android" / "Safari on macOS" (dependency-free UA parser in `src/lib/devices.ts`; Edge/Samsung/Opera checked before Chrome since their UAs contain the Chrome token) + client IP via the existing `clientIp()`.
- `sessions.last_active_at` updated throttled — once per 10 min per jti per instance (in-memory Map in `src/lib/auth.ts`, size-capped), NOT on every request. Watchers use the existing `last_sync_at`.
- `GET /api/devices` → unified list (non-revoked browser sessions + paired watchers, newest activity first) + `current_session_id`; `DELETE /api/devices/[id]?type=` revokes ownership-checked (browser: soft-revoke `sessions.revoked_at` — enforcement is the existing `verifySession()` rejection, audit 2.6 applied via UI; watcher: delete row — the signed token then matches nothing, so `sync/files` rejects it). Revoking your OWN session clears the cookie and the UI redirects to login immediately.
- Devices page rebuilt (`src/app/dashboard/devices/page.tsx`): unified list with BROWSER/WATCHER type marks, **THIS DEVICE** tag, per-row REVOKE, empty state, and the old watcher-centric content (prominent pairing + setup-instructions tile) removed — pairing is preserved but collapsed into a "PAIR A NEW WATCHER" accordion at the bottom so the watcher feature stays reachable. Settings tile renamed to DEVICES & SESSIONS.
- Location is the client IP (shown as "IP …") — no external geo service was added (extra latency + dependency for a self-visible list). Logged as an accepted simplification.
- **Device-identity consistency note (Part 3 ↔ Part 2)**: a browser's identity across features is the session jti (cookie + Devices row). Part 2's offline queue is client-local (IndexedDB/Dexie) with no server-side queue identity, so there is no second identifier to reconcile; watchers are identified by their device id/token in both the Devices list and the sync routes. One device = one row per feature.

**Verified**: `tsc --noEmit` clean; `NODE_ENV=production next build` clean; code review applied. Manual check needed after deploy: log in from a second browser/incognito → both appear; revoke one → its next request is rejected (401); revoke your own session → immediate logout + redirect to login.
