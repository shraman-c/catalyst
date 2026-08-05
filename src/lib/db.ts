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
      max: 10,
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
  
  // Enable vector extension for embeddings
  await client.unsafe('CREATE EXTENSION IF NOT EXISTS vector');

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

  // Graph nodes table with vector embedding
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS graph_nodes (
      id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      definition TEXT NOT NULL DEFAULT '',
      reference_count INTEGER NOT NULL DEFAULT 1,
      manually_edited BOOLEAN NOT NULL DEFAULT FALSE,
      embedding vector(1536),
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

  // Flashcards table with vector embedding
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
      embedding vector(1536),
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

  // Devices table
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT,
      pairing_code TEXT UNIQUE,
      token TEXT UNIQUE,
      folder_path TEXT,
      subject_id TEXT REFERENCES subjects(id) ON DELETE SET NULL,
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

  // Vector similarity indexes (for fast embedding search)
  await client.unsafe('CREATE INDEX IF NOT EXISTS idx_graph_nodes_embedding ON graph_nodes USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)');
  await client.unsafe('CREATE INDEX IF NOT EXISTS idx_flashcards_embedding ON flashcards USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)');
}

export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Execute a query and return all rows.
 */
export async function queryAll<T = Record<string, unknown>>(
  sqlQuery: string,
  args: any[] = []
): Promise<T[]> {
  try {
    const converted = convertSql(sqlQuery);
    const result = await getSql().unsafe(converted, args);
    return result as unknown as T[];
  } catch (err) {
    console.error('queryAll error:', { sql: sqlQuery, args, err });
    return [];
  }
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
 */
export async function execute(sqlQuery: string, args: any[] = []): Promise<boolean> {
  try {
    const converted = convertSql(sqlQuery);
    await getSql().unsafe(converted, args);
    return true;
  } catch (err) {
    console.error('execute error:', { sql: sqlQuery, args, err });
    return false;
  }
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
 * Vector similarity search for graph nodes.
 * Finds concepts similar to the given embedding vector.
 */
export async function findSimilarNodes(
  subjectId: string,
  embedding: number[],
  threshold: number = 0.85,
  limit: number = 5
): Promise<Array<{ id: string; name: string; definition: string; similarity: number }>> {
  const embeddingStr = `[${embedding.join(',')}]`;
  
  const query = `
    SELECT id, name, definition,
      1 - (embedding <=> $1::vector) AS similarity
    FROM graph_nodes
    WHERE subject_id = $2
      AND embedding IS NOT NULL
      AND 1 - (embedding <=> $1::vector) > $3
    ORDER BY similarity DESC
    LIMIT $4
  `;
  
  return await queryAll(query, [embeddingStr, subjectId, threshold, limit]);
}

/**
 * Vector similarity search for flashcards.
 * Finds cards similar to the given embedding vector.
 */
export async function findSimilarCards(
  subjectId: string,
  embedding: number[],
  threshold: number = 0.85,
  limit: number = 5
): Promise<Array<{ id: string; front: string; back: string; similarity: number }>> {
  const embeddingStr = `[${embedding.join(',')}]`;
  
  const query = `
    SELECT id, front, back,
      1 - (embedding <=> $1::vector) AS similarity
    FROM flashcards
    WHERE subject_id = $2
      AND status != 'deleted'
      AND embedding IS NOT NULL
      AND 1 - (embedding <=> $1::vector) > $3
    ORDER BY similarity DESC
    LIMIT $4
  `;
  
  return await queryAll(query, [embeddingStr, subjectId, threshold, limit]);
}

/**
 * Update the embedding for a graph node.
 */
export async function updateNodeEmbedding(
  nodeId: string,
  embedding: number[]
): Promise<boolean> {
  const embeddingStr = `[${embedding.join(',')}]`;
  return await execute(
    'UPDATE graph_nodes SET embedding = $1::vector WHERE id = $2',
    [embeddingStr, nodeId]
  );
}

/**
 * Update the embedding for a flashcard.
 */
export async function updateCardEmbedding(
  cardId: string,
  embedding: number[]
): Promise<boolean> {
  const embeddingStr = `[${embedding.join(',')}]`;
  return await execute(
    'UPDATE flashcards SET embedding = $1::vector WHERE id = $2',
    [embeddingStr, cardId]
  );
}

/**
 * Close the database connection.
 */
export async function closeDb(): Promise<void> {
  await getSql().end();
}