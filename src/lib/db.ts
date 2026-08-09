import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;

// Create postgres client with SSL (Supabase requires SSL)
// Only create client if DATABASE_URL is available (allows build without DB)
let sql: ReturnType<typeof postgres> | null = null;

function getSql() {
  if (!sql) {
    if (!DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is required. Please set it in your .env.local file.');
    }
    sql = postgres(DATABASE_URL, {
      ssl: 'require',
      // Keep the per-instance pool small: serverless can spin up many instances
      // in parallel, and Supabase's free tier allows ~60 direct connections.
      // With N warm instances at max 10 each, the limit is easy to exhaust;
      // 5 keeps headroom. (The Supabase pooler — see README — removes this
      // constraint entirely.)
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return sql;
}

/**
 * Convert SQLite-style SQL to PostgreSQL-style.
 * - Replace ? placeholders with $1, $2, ...
 * - Replace datetime('now') with NOW()
 * - Replace datetime('now', '-5 minutes') with NOW() - INTERVAL '5 minutes'
 */
function convertSql(sqlQuery: string): string {
  // Replace datetime('now', ...) patterns
  let converted = sqlQuery.replace(
    /datetime\('now',\s*'([^']+)'\)/gi,
    (_, interval) => `NOW() - INTERVAL '${interval}'`
  );
  converted = converted.replace(/datetime\('now'\)/gi, 'NOW()');
  converted = converted.replace(/datetime\("now"\)/gi, 'NOW()');
  
  // Replace ? placeholders with $1, $2, ...
  let idx = 1;
  converted = converted.replace(/\?/g, () => `$${idx++}`);
  
  return converted;
}

/**
 * Initialize database schema for PostgreSQL.
 * This replaces the SQLite schema with PostgreSQL-compatible syntax.
 */
export async function initializeSchema(): Promise<void> {
  const client = getSql();
  
  // ------------------------------------------------------------------
  // Migration: embeddings moved to Pinecone (src/lib/ai/vector.ts).
  // Drop the old pgvector columns/indexes if a pre-Pinecone schema exists.
  // ------------------------------------------------------------------
  await client.unsafe('DROP INDEX IF EXISTS idx_graph_nodes_embedding');
  await client.unsafe('DROP INDEX IF EXISTS idx_flashcards_embedding');
  await client.unsafe('ALTER TABLE IF EXISTS graph_nodes DROP COLUMN IF EXISTS embedding');
  await client.unsafe('ALTER TABLE IF EXISTS flashcards DROP COLUMN IF EXISTS embedding');

  // Users table
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Security audit (2026-08-08): lockout columns for failed-login backoff.
  await client.unsafe('ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_attempts INTEGER NOT NULL DEFAULT 0');
  await client.unsafe('ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ');

  // Security audit (2026-08-08): server-side session store (audit 1.4/1.5/1.6).
  // A row is created per issued session JWT (jti) and checked on every request;
  // revoking the row invalidates the token even if it was captured.
  // Part 3 (2026-08-09): browser sessions ARE devices — each login records the
  // parsed User-Agent label, the client IP, and a throttled last-active time so
  // the Devices page can show every logged-in browser alongside watcher devices.
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      device_label TEXT,
      ip_address TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_active_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ
    )
  `);
  await client.unsafe('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)');

  // Subjects table
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS subjects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      archived BOOLEAN NOT NULL DEFAULT FALSE
    )
  `);

  // Note files table
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS note_files (
      id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'upload',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Note versions table
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS note_versions (
      id TEXT PRIMARY KEY,
      note_file_id TEXT NOT NULL REFERENCES note_files(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Graph nodes table (embeddings live in Pinecone, not Postgres)
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS graph_nodes (
      id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      definition TEXT NOT NULL DEFAULT '',
      reference_count INTEGER NOT NULL DEFAULT 1,
      manually_edited BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Graph edges table
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS graph_edges (
      id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      from_node_id TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
      to_node_id TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
      relationship_type TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Node-note mapping table
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS node_note_map (
      node_id TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
      note_file_id TEXT NOT NULL REFERENCES note_files(id) ON DELETE CASCADE,
      PRIMARY KEY (node_id, note_file_id)
    )
  `);

  // Flashcards table (embeddings live in Pinecone, not Postgres)
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS flashcards (
      id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      note_file_id TEXT NOT NULL REFERENCES note_files(id) ON DELETE CASCADE,
      node_ids TEXT NOT NULL DEFAULT '[]',
      front TEXT NOT NULL,
      back TEXT NOT NULL,
      card_type TEXT NOT NULL DEFAULT 'qa',
      status TEXT NOT NULL DEFAULT 'new',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      next_review_at TIMESTAMPTZ,
      interval INTEGER NOT NULL DEFAULT 1,
      ease_factor REAL NOT NULL DEFAULT 2.5,
      review_count INTEGER NOT NULL DEFAULT 0
    )
  `);

  // Review history table
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS review_history (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL REFERENCES flashcards(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rating TEXT NOT NULL,
      reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      next_review_at TIMESTAMPTZ NOT NULL,
      interval INTEGER NOT NULL,
      ease_factor REAL NOT NULL
    )
  `);

  // User preferences table
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      card_density INTEGER NOT NULL DEFAULT 20,
      graph_verbosity TEXT NOT NULL DEFAULT 'standard',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Devices table — watcher pairing (TRD FR-29/FR-30).
  // Part 3 (2026-08-09): a `type` discriminator so the unified Devices UI can
  // tell watcher rows apart from browser sessions (which live in `sessions`).
  // All rows are watchers, so the default covers existing + new rows.
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT,
      pairing_code TEXT UNIQUE,
      token TEXT UNIQUE,
      folder_path TEXT,
      subject_id TEXT REFERENCES subjects(id) ON DELETE SET NULL,
      type TEXT NOT NULL DEFAULT 'sync_watcher',
      last_sync_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Create indexes
  await client.unsafe('CREATE INDEX IF NOT EXISTS idx_subjects_user ON subjects(user_id)');
  await client.unsafe('CREATE INDEX IF NOT EXISTS idx_note_files_subject ON note_files(subject_id)');
  await client.unsafe('CREATE INDEX IF NOT EXISTS idx_note_versions_file ON note_versions(note_file_id)');
  await client.unsafe('CREATE INDEX IF NOT EXISTS idx_graph_nodes_subject ON graph_nodes(subject_id)');
  await client.unsafe('CREATE INDEX IF NOT EXISTS idx_graph_edges_subject ON graph_edges(subject_id)');
  await client.unsafe('CREATE INDEX IF NOT EXISTS idx_flashcards_subject ON flashcards(subject_id)');
  await client.unsafe('CREATE INDEX IF NOT EXISTS idx_flashcards_note ON flashcards(note_file_id)');
  await client.unsafe('CREATE INDEX IF NOT EXISTS idx_flashcards_status ON flashcards(status)');
  await client.unsafe('CREATE INDEX IF NOT EXISTS idx_review_history_card ON review_history(card_id)');
  await client.unsafe('CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id)');
  await client.unsafe('CREATE INDEX IF NOT EXISTS idx_devices_pairing_code ON devices(pairing_code)');
  await client.unsafe('CREATE INDEX IF NOT EXISTS idx_devices_token ON devices(token)');

}

/**
 * Additive backfill for EXISTING databases (Part 3).
 *
 * ensureSchema() deliberately short-circuits on the cheap `users`-table probe,
 * so ALTER-column additions never run on a database that already has tables —
 * this is the exact trap the probe comment warns about. This function probes
 * the catalog once and runs ONLY the missing ALTERs, so:
 *   - existing DBs self-migrate on the next cold instance (one catalog query,
 *     then at most a couple of idempotent ALTERs once),
 *   - fresh DBs find the columns already present (zero DDL), and
 *   - the cold-start latency win from the probe is preserved.
 */
export async function ensureDeviceMigrations(): Promise<void> {
  // Key on (table, column) pairs so a future `type` column on `sessions` can
  // never skip the devices ALTER (and vice versa).
  const rows = await queryAll<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = 'public'
       AND ((table_name = 'sessions' AND column_name IN ('device_label', 'ip_address', 'last_active_at'))
         OR (table_name = 'devices' AND column_name = 'type'))`
  );
  const have = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));

  if (!have.has('sessions.device_label')) {
    await execute('ALTER TABLE sessions ADD COLUMN device_label TEXT');
  }
  if (!have.has('sessions.ip_address')) {
    await execute('ALTER TABLE sessions ADD COLUMN ip_address TEXT');
  }
  if (!have.has('sessions.last_active_at')) {
    await execute('ALTER TABLE sessions ADD COLUMN last_active_at TIMESTAMPTZ');
  }
  if (!have.has('devices.type')) {
    // Existing rows are watcher rows; the default backfills them correctly.
    await execute("ALTER TABLE devices ADD COLUMN type TEXT NOT NULL DEFAULT 'sync_watcher'");
  }
}

export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Execute a query and return all rows.
 * Errors are swallowed and an empty array is returned — use for best-effort reads.
 */
export async function queryAll<T = Record<string, unknown>>(
  sqlQuery: string,
  args: any[] = []
): Promise<T[]> {
  try {
    return await queryAllStrict<T>(sqlQuery, args);
  } catch (err) {
    console.error('queryAll error:', { sql: sqlQuery, args, err });
    return [];
  }
}

/**
 * Execute a query and return all rows, throwing on failure.
 * Use for reads where a failure must not silently look like "no data" (e.g. the AI pipeline).
 */
export async function queryAllStrict<T = Record<string, unknown>>(
  sqlQuery: string,
  args: any[] = []
): Promise<T[]> {
  const converted = convertSql(sqlQuery);
  const result = await getSql().unsafe(converted, args);
  return result as unknown as T[];
}

/**
 * Execute a query and return a single row.
 */
export async function queryOne<T = Record<string, unknown>>(
  sqlQuery: string,
  args: any[] = []
): Promise<T | null> {
  try {
    const rows = await queryAll<T>(sqlQuery, args);
    return rows[0] ?? null;
  } catch (err) {
    console.error('queryOne error:', { sql: sqlQuery, args, err });
    return null;
  }
}

/**
 * Execute a statement (INSERT, UPDATE, DELETE).
 * Errors are swallowed and `false` is returned — use for best-effort writes.
 */
export async function execute(sqlQuery: string, args: any[] = []): Promise<boolean> {
  try {
    await executeStrict(sqlQuery, args);
    return true;
  } catch (err) {
    console.error('execute error:', { sql: sqlQuery, args, err });
    return false;
  }
}

/**
 * Execute a statement, throwing on failure.
 * Use for critical writes where silent data loss is worse than a loud error
 * (e.g. the AI pipeline's node/card persistence).
 */
export async function executeStrict(sqlQuery: string, args: any[] = []): Promise<true> {
  const converted = convertSql(sqlQuery);
  await getSql().unsafe(converted, args);
  return true;
}

/**
 * Execute a raw SQL statement without parameters.
 */
export async function executeRaw(sqlQuery: string): Promise<boolean> {
  try {
    await getSql().unsafe(sqlQuery);
    return true;
  } catch (err) {
    console.error('executeRaw error:', { sql: sqlQuery, err });
    return false;
  }
}

/**
 * Get the underlying postgres client for advanced usage (e.g., transactions).
 */
export function getClient() {
  return getSql();
}

/**
 * Get the underlying postgres client for backward compatibility.
 */
export function getDb() {
  return getSql();
}

/**
 * Close the database connection.
 */
export async function closeDb(): Promise<void> {
  await getSql().end();
}