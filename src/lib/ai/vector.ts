/**
 * Vector storage + embeddings — Pinecone.
 *
 * Replaces the previous pgvector columns in Postgres. One serverless index
 * holds embeddings for both graph nodes and flashcards, split into per-subject
 * namespaces so queries never leak across subjects.
 *
 * Embeddings come from Pinecone's Inference API (voyage-3-lite, 512 dims) so
 * a single Pinecone key covers both embedding generation and vector search.
 */

import { Pinecone } from '@pinecone-database/pinecone';

export const EMBED_MODEL = 'llama-text-embed-v2'; // 1024-dim, Pinecone-hosted inference
export const EMBED_DIM = 1024;

const DEFAULT_INDEX = 'catalyst';
const PINECONE_CLOUD = process.env.PINECONE_CLOUD || 'aws';
const PINECONE_REGION = process.env.PINECONE_REGION || 'us-east-1';

let _pc: Pinecone | null = null;
let _indexReady: Promise<void> | null = null;

function getPinecone(): Pinecone {
  if (_pc) return _pc;
  const apiKey = process.env.PINECONE_API_KEY;
  if (!apiKey) {
    throw new Error(
      'PINECONE_API_KEY environment variable is not set. ' +
      'Create a free account at https://app.pinecone.io and add the API key to .env.local'
    );
  }
  _pc = new Pinecone({ apiKey });
  return _pc;
}

function indexName(): string {
  return process.env.PINECONE_INDEX || DEFAULT_INDEX;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Lazily create the serverless index on first use (free tier supports one).
 * Subsequent calls reuse the same in-flight promise.
 */
async function ensureIndexReady(): Promise<void> {
  if (!_indexReady) {
    _indexReady = (async () => {
      const pc = getPinecone();
      const name = indexName();
      const existing = await pc.listIndexes();
      const exists = existing.indexes?.some((i) => i.name === name);

      if (!exists) {
        await pc.createIndex({
          name,
          dimension: EMBED_DIM,
          metric: 'cosine',
          spec: {
            serverless: {
              cloud: PINECONE_CLOUD,
              region: PINECONE_REGION,
            },
          },
        });
        // Poll until the index reports ready before using it
        for (let i = 0; i < 30; i++) {
          await sleep(2000);
          const desc = await pc.describeIndex(name);
          if (desc.status?.ready) return;
        }
        throw new Error(
          `Pinecone index '${name}' did not become ready within 60s — check the Pinecone console`
        );
      }
    })();
    // Reset on failure so a transient error doesn't permanently poison the module
    _indexReady.catch(() => {
      _indexReady = null;
    });
  }
  return _indexReady;
}

export function graphNamespace(subjectId: string): string {
  return `graph-${subjectId}`;
}

export function cardsNamespace(subjectId: string): string {
  return `cards-${subjectId}`;
}

/**
 * Extract a dense embedding from an inference response (which may be dense or sparse).
 */
function denseValues(item: { vectorType: string; values?: number[] }): number[] {
  if (item.vectorType !== 'dense' || !item.values) {
    throw new Error(`Pinecone inference returned non-dense embedding for ${EMBED_MODEL}`);
  }
  return item.values;
}

/**
 * Embed a single text. Throws if the Pinecone inference API is unavailable.
 * Use inputType 'query' when the embedding is used to search, 'passage' when stored.
 */
export async function generateEmbedding(
  text: string,
  inputType: 'passage' | 'query' | 'document' = 'passage'
): Promise<number[]> {
  const pc = getPinecone();
  const res = await pc.inference.embed({
    model: EMBED_MODEL,
    inputs: [text],
    parameters: { inputType, truncate: 'END' },
  });
  return denseValues(res.data[0]);
}

/**
 * Embed multiple texts in one API call (~5x cheaper per text than one call
 * each — benchmarked: 5 sequential calls ≈3.3s vs 1 batched call ≈0.7s).
 */
export async function generateEmbeddings(
  texts: string[],
  inputType: 'passage' | 'query' | 'document' = 'passage'
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const pc = getPinecone();
  const res = await pc.inference.embed({
    model: EMBED_MODEL,
    inputs: texts,
    parameters: { inputType, truncate: 'END' },
  });
  return res.data.map((d) => denseValues(d));
}

export interface EmbeddingRecord {
  id: string;
  embedding: number[];
  metadata?: Record<string, string | number | boolean>;
}

/**
 * Upsert many vectors into a namespace in a single API call. Best-effort at
 * call sites — a failure here should degrade dedup, never break the pipeline's
 * DB writes.
 */
export async function upsertEmbeddings(
  namespace: string,
  records: EmbeddingRecord[]
): Promise<void> {
  if (records.length === 0) return;
  await ensureIndexReady();
  await getPinecone()
    .index(indexName())
    .namespace(namespace)
    .upsert({
      records: records.map((r) => ({
        id: r.id,
        values: r.embedding,
        ...(r.metadata ? { metadata: r.metadata } : {}),
      })),
    });
}

/**
 * Remove a vector from a namespace (e.g. node/card deletion).
 */
export async function deleteEmbedding(namespace: string, id: string): Promise<void> {
  try {
    await ensureIndexReady();
    await getPinecone().index(indexName()).namespace(namespace).deleteOne({ id });
  } catch (err) {
    console.error('Pinecone delete failed:', namespace, id, err);
  }
}

export interface SimilarVector {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
}

/**
 * Run many vector queries with bounded concurrency — keeps the speedup of
 * parallel round trips without tripping free-tier rate limits.
 * Results are returned in the same order as the input embeddings.
 */
export async function querySimilarVectorsBatched(
  namespace: string,
  embeddings: number[][],
  topK = 5,
  minScore = 0,
  concurrency = 8
): Promise<SimilarVector[][]> {
  const results: SimilarVector[][] = new Array(embeddings.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < embeddings.length) {
      const i = next++;
      results[i] = await querySimilarVectors(namespace, embeddings[i], topK, minScore);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, embeddings.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Query a namespace for vectors similar to the given embedding.
 * Returns matches with score >= minScore, sorted by descending similarity.
 */
export async function querySimilarVectors(
  namespace: string,
  embedding: number[],
  topK = 5,
  minScore = 0
): Promise<SimilarVector[]> {
  await ensureIndexReady();
  const res = await getPinecone()
    .index(indexName())
    .namespace(namespace)
    .query({ vector: embedding, topK, includeMetadata: true });

  return (res.matches || [])
    .filter((m) => m.score !== undefined && m.score >= minScore)
    .map((m) => ({
      id: m.id,
      score: m.score ?? 0,
      metadata: (m.metadata as Record<string, unknown> | undefined) ?? undefined,
    }));
}
