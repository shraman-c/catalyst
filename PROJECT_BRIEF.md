# Catalyst Project Brief

## 1. High-Level Summary
Catalyst is a two-part application featuring a lightweight desktop file-watcher and a web dashboard designed to automate studying for students. The local file-watcher monitors a user-specified folder for note updates and automatically syncs changes to the dashboard. The Next.js web application leverages AI models (via Groq and Pinecone) to parse raw notes, automatically constructing an interactive knowledge graph of concepts and generating active-recall flashcards using spaced repetition scheduling.

## 2. Tech Stack
- **Frameworks & Core Libraries**:
  - [Next.js](https://nextjs.org/) (v14.2.29) - React web application framework utilizing App Router.
  - [React](https://react.dev/) (v18.3.1) - Client-side user interface.
  - [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) (v9.4.3) - Used in the local watcher database to store sync logs and content hashes.
- **Styling**:
  - **Vanilla CSS** - Global neo-brutalist theme implemented in [globals.css](file:///d:/vsasaaadada/catalyst/src/app/globals.css) utilizing custom CSS custom properties (variables) for theme management (light/dark/system).
- **Key Dependencies**:
  - `@pinecone-database/pinecone` (v8.2.0) - Vector database for storing and querying text embeddings (`llama-text-embed-v2`).
  - `postgres` (v3.4.9) - Serverless PostgreSQL client used for connecting to the main database (Supabase).
  - `jose` (v5.9.6) - Self-contained JWT sign and verify library for session and device authentication.
  - `marked` (v12.0.0) - Markdown compiler used to render notes to HTML safely.
  - `react-force-graph-2d` (v1.25.7) - 2D force-directed canvas graphing component.
  - `chokidar` (v3.6.0) - Node.js directory watcher used in the desktop watcher utility.
  - `commander` (v12.1.0) - Command-line interface builder for the desktop watcher configuration.

## 3. Routing Architecture
The web application is built on Next.js App Router. The directory structure and respective layouts/pages include:

- **Root Layout & Global Setup**:
  - [layout.tsx](file:///d:/vsasaaadada/catalyst/src/app/layout.tsx): Wraps the entire application with font links, global styling reset, base theme injection, and the client `ThemeProvider`.
- **Main Views**:
  - [page.tsx](file:///d:/vsasaaadada/catalyst/src/app/page.tsx): Main homepage that serves either the landing details or login/signup authentication forms.
  - [dashboard/layout.tsx](file:///d:/vsasaaadada/catalyst/src/app/dashboard/layout.tsx): Handles top navigation and mobile bottom navigation; performs server-side session checks and redirects unauthenticated users.
  - [dashboard/page.tsx](file:///d:/vsasaaadada/catalyst/src/app/dashboard/page.tsx): Shows a dashboard of study subjects, their current statistics (notes, concepts, cards due today), and a modal overlay to add new subjects.
  - [dashboard/devices/page.tsx](file:///d:/vsasaaadada/catalyst/src/app/dashboard/devices/page.tsx): Displays connected desktop watcher devices, pairing configuration steps, and controls to generate pairing codes or revoke devices.
  - [dashboard/settings/page.tsx](file:///d:/vsasaaadada/catalyst/src/app/dashboard/settings/page.tsx): Handles system settings, account profile info, user density preferences, graph edge verbosity, data exports (JSON/CSV), and account deletion.
  - [dashboard/subjects/[id]/page.tsx](file:///d:/vsasaaadada/catalyst/src/app/dashboard/subjects/[id]/page.tsx): Individual subject workspace page including stats, note upload tabs (drag & drop or paste), and recent note versions sidebar.
  - [dashboard/subjects/[id]/notes/page.tsx](file:///d:/vsasaaadada/catalyst/src/app/dashboard/subjects/[id]/notes/page.tsx): Lists note files created by upload or synched from watcher, with deletion options.
  - [dashboard/subjects/[id]/notes/[noteId]/page.tsx](file:///d:/vsasaaadada/catalyst/src/app/dashboard/subjects/[id]/notes/[noteId]/page.tsx): Deep-dive page displaying rendered markdown, raw text, extracted concepts, and cards for a specific file.
  - [dashboard/subjects/[id]/cards/page.tsx](file:///d:/vsasaaadada/catalyst/src/app/dashboard/subjects/[id]/cards/page.tsx): Card browser and organizer page (accepts, deletes, or edits flashcards).
  - [dashboard/subjects/[id]/graph/page.tsx](file:///d:/vsasaaadada/catalyst/src/app/dashboard/subjects/[id]/graph/page.tsx): High-performance 2D force-directed interactive concept graph mapping subject ideas, including overlap prevention and clustering.
  - [dashboard/subjects/[id]/review/page.tsx](file:///d:/vsasaaadada/catalyst/src/app/dashboard/subjects/[id]/review/page.tsx): Active recall flashcard session interface providing spaced-repetition ratings (Again, Hard, Good, Easy) following the SM-2 algorithm.

- **API Route Handlers (`/api/*`)**:
  - `/api/auth` ([route.ts](file:///d:/vsasaaadada/catalyst/src/app/api/auth/route.ts)): Handles authentication POST (login/signup) and DELETE (logout).
  - `/api/subjects` ([route.ts](file:///d:/vsasaaadada/catalyst/src/app/api/subjects/route.ts)): Lists and creates subjects.
  - `/api/subjects/[id]` ([route.ts](file:///d:/vsasaaadada/catalyst/src/app/api/subjects/[id]/route.ts)): Retrieves subject stats.
  - `/api/notes` ([route.ts](file:///d:/vsasaaadada/catalyst/src/app/api/notes/route.ts)): Fetches all notes under a subject.
  - `/api/notes/[id]` ([route.ts](file:///d:/vsasaaadada/catalyst/src/app/api/notes/[id]/route.ts)): Retrieves note metadata, contents, concepts, and cards.
  - `/api/notes/upload` ([route.ts](file:///d:/vsasaaadada/catalyst/src/app/api/notes/upload/route.ts)): Handles pasted note uploads or file uploads and triggers the AI pipeline.
  - `/api/cards/[subjectId]` ([route.ts](file:///d:/vsasaaadada/catalyst/src/app/api/cards/[subjectId]/route.ts)): Manages flashcards, reviews, and SM-2 scheduling computations.
  - `/api/graph/[subjectId]` ([route.ts](file:///d:/vsasaaadada/catalyst/src/app/api/graph/[subjectId]/route.ts)): Manages knowledge graph node renaming, relationships, deletions, and additions.
  - `/api/settings` ([route.ts](file:///d:/vsasaaadada/catalyst/src/app/api/settings/route.ts)): Retrieves and updates user preferences.
  - `/api/delete` ([route.ts](file:///d:/vsasaaadada/catalyst/src/app/api/delete/route.ts)): Handles file deletion and total account deletion.
  - `/api/devices/pair` ([route.ts](file:///d:/vsasaaadada/catalyst/src/app/api/devices/pair/route.ts)): Generates, redeems, or revokes device pairing credentials.
  - `/api/sync/status` ([route.ts](file:///d:/vsasaaadada/catalyst/src/app/api/sync/status/route.ts)): Connects subject layouts with active device connections.
  - `/api/sync/files` ([route.ts](file:///d:/vsasaaadada/catalyst/src/app/api/sync/files/route.ts)): Integrates watcher sync actions (creates files, note versions, runs pipeline, soft-deletes files).
  - `/api/export` ([route.ts](file:///d:/vsasaaadada/catalyst/src/app/api/export/route.ts)): Generates JSON/CSV backups of all user content.

## 4. Core Components
- **Dashboard Shared Components**:
  - `ThemeToggle` ([ThemeToggle.tsx](file:///d:/vsasaaadada/catalyst/src/components/ThemeToggle.tsx)): A client-side button component utilizing the global `ThemeProvider` hook to toggle between dark, light, and system color settings. Embedded in the main navigation header and the account settings views.
  - `LogoutButtonClient` ([LogoutButtonClient.tsx](file:///d:/vsasaaadada/catalyst/src/app/dashboard/LogoutButtonClient.tsx)): A client-side logout trigger that sends a delete request to the auth API and resets current Next.js navigation pages. Used in the top navbar.
  - `ForceGraph2D` (Dynamically imported from `react-force-graph-2d` within [graph/page.tsx](file:///d:/vsasaaadada/catalyst/src/app/dashboard/subjects/[id]/graph/page.tsx)): Renders the interactive 2D canvas of concepts and connections.

## 5. Data & State Management
- **Authentication & Sessions**:
  - User authorization is handled via JWT session cookies signed with `jose` (configured in [auth.ts](file:///d:/vsasaaadada/catalyst/src/lib/auth.ts)). Next.js Server Components and route handlers access the session server-side via cookies to grant access or trigger dashboard redirects.
- **Client-Side State**:
  - Built using standard React `useState` and `useEffect` patterns. The app performs client-side data fetching (`fetch`) from routes (`/api/*`) for local UI states, modals, theme changes, form inputs, dynamic canvas sizing, and spaced repetition card review views.
- **Main Postgres Database**:
  - Relational database client logic resides in [db.ts](file:///d:/vsasaaadada/catalyst/src/lib/db.ts) using the serverless `postgres` driver connected to Supabase (SSL required). Schema creation (e.g. `users`, `subjects`, `note_files`, `flashcards`, `devices`) is executed dynamically on start via `ensureSchema`.
- **Vector Search & Embeddings**:
  - Embedded vector actions reside in [vector.ts](file:///d:/vsasaaadada/catalyst/src/lib/ai/vector.ts) using a serverless Pinecone index. Texts are embedded using the hosted `llama-text-embed-v2` model (1024 dimensions) and separated into namespaces by subject (`graph-${subjectId}` / `cards-${subjectId}`).
- **AI Processing Pipeline**:
  - Implemented in [pipeline.ts](file:///d:/vsasaaadada/catalyst/src/lib/ai/pipeline.ts) and orchestrated during uploads/sync operations. Works in five steps:
    1. Semantically chunks the note content.
    2. Extracts concepts and generates flashcards (using `llama-3.1-8b-instant` on Groq).
    3. Prefilters new concepts against the existing graph via Jaccard string similarity and batched Pinecone vector queries.
    4. Merges unresolved concepts using `llama-3.3-70b-versatile`.
    5. Deduplicates, generates embeddings for, and persists flashcards and graph elements to Postgres and Pinecone.
