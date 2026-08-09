// Repro script: run the actual AI pipeline end-to-end (Groq + Pinecone + Postgres)
// to verify nodes/cards/graph persist and embeddings are stored in Pinecone.
import { readFileSync } from 'fs';

const lines = readFileSync('.env.local', 'utf8').split(/\r?\n/);
for (const line of lines) {
  const t = line.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const idx = t.indexOf('=');
  process.env[t.substring(0, idx).trim()] = t.substring(idx + 1).trim();
}

const { getClient, initializeSchema, executeStrict } = await import('../src/lib/db.ts');
const { processNote, hashContent } = await import('../src/lib/ai/pipeline.ts');
const { graphNamespace, cardsNamespace, querySimilarVectors } = await import('../src/lib/ai/vector.ts');
const { Pinecone } = await import('@pinecone-database/pinecone');

const client = getClient();
const userId = 'repro-user-' + Date.now();
const subjectId = 'repro-subject-' + Date.now();
const noteId = 'repro-note-' + Date.now();

const sampleNote = `# Cellular Respiration

Glycolysis is the first stage of cellular respiration. It occurs in the cytoplasm and breaks down one glucose molecule into two pyruvate molecules, producing 2 ATP and 2 NADH.

The Krebs cycle (citric acid cycle) happens in the mitochondrial matrix. It processes acetyl-CoA derived from pyruvate, producing ATP, NADH, FADH2, and releasing CO2.

The electron transport chain is located on the inner mitochondrial membrane. It uses NADH and FADH2 to pump protons and generate a proton gradient. ATP synthase uses this gradient to produce ATP through oxidative phosphorylation.

Pyruvate oxidation converts pyruvate to acetyl-CoA, linking glycolysis to the Krebs cycle. It is catalyzed by the pyruvate dehydrogenase complex and produces NADH and CO2.

Oxygen is the final electron acceptor in the electron transport chain. Without oxygen, the electron transport chain stops, and cells rely on anaerobic respiration or fermentation to regenerate NAD+.`;

try {
  // 1. Run schema init + migration (drops old pgvector embedding columns)
  await initializeSchema();
  const cols = await client.unsafe(
    `SELECT table_name FROM information_schema.columns
     WHERE table_name IN ('graph_nodes','flashcards') AND column_name='embedding'`
  );
  console.log('EMBEDDING COLUMNS AFTER MIGRATION:', JSON.stringify(cols));

  // 2. Create a real user + subject (FKs require them to exist)
  await executeStrict(
    `INSERT INTO users (id, email, name, password_hash, created_at) VALUES ($1, $2, $3, $4, NOW())`,
    [userId, userId + '@repro.local', 'Repro User', 'repro']
  );
  await executeStrict(
    `INSERT INTO subjects (id, user_id, name, description, created_at, archived) VALUES ($1, $2, $3, NULL, NOW(), FALSE)`,
    [subjectId, userId, 'Repro Subject']
  );
  await executeStrict(
    `INSERT INTO note_files (id, subject_id, filename, content_hash, source, created_at, updated_at) VALUES ($1, $2, $3, $4, 'upload', NOW(), NOW())`,
    [noteId, subjectId, 'repro-note.md', 'repro-hash']
  );

  // 3. Run the pipeline
  const hash = await hashContent(sampleNote);
  console.log('\nRUNNING processNote (Groq + Pinecone)...');
  const result = await processNote(noteId, subjectId, sampleNote, hash);
  console.log('PIPELINE OK:', JSON.stringify(result, null, 2));

  // 4. Verify Postgres persistence
  const nodes = await client.unsafe('SELECT id, name FROM graph_nodes WHERE subject_id = $1', [subjectId]);
  const cards = await client.unsafe('SELECT id, front FROM flashcards WHERE subject_id = $1', [subjectId]);
  const edges = await client.unsafe('SELECT id FROM graph_edges WHERE subject_id = $1', [subjectId]);
  console.log('POSTGRES NODES:', nodes.length, JSON.stringify(nodes.map(n => n.name)));
  console.log('POSTGRES CARDS:', cards.length);
  console.log('POSTGRES EDGES:', edges.length);

  // 5. Verify Pinecone has the embeddings
  const gMatch = await querySimilarVectors(graphNamespace(subjectId), new Array(1024).fill(0.01), 1, 0);
  const cMatch = await querySimilarVectors(cardsNamespace(subjectId), new Array(1024).fill(0.01), 1, 0);
  console.log('PINECONE GRAPH NS MATCHES:', gMatch.length, '| CARDS NS MATCHES:', cMatch.length);
} catch (e) {
  console.log('\nPIPELINE THREW:', e.constructor?.name, '::', e.message);
  console.log('STACK:', e.stack?.split('\n').slice(0, 8).join('\n'));
}

// Cleanup test data
try {
  await client.unsafe('DELETE FROM subjects WHERE id = $1', [subjectId]); // cascades notes/nodes/cards/edges
  await client.unsafe('DELETE FROM users WHERE id = $1', [userId]);
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  const name = process.env.PINECONE_INDEX || 'catalyst';
  const existing = await pc.listIndexes();
  if (existing.indexes?.some((i) => i.name === name)) {
    const index = pc.index(name);
    await index.namespace(graphNamespace(subjectId)).deleteAll();
    await index.namespace(cardsNamespace(subjectId)).deleteAll();
  }
  console.log('CLEANUP DONE');
} catch (e) {
  console.log('CLEANUP ERR:', e.message);
}
await client.end();
