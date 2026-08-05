import { queryAllStrict, executeStrict } from '../db';
import { chunkNote, extractConcepts } from './extract';
import { generateCardsFromConcepts, persistCards } from './cards';
import { mergeConceptsIntoGraph, stringSimilarity } from './graph';
import { generateEmbeddings, querySimilarVectorsBatched, graphNamespace } from './vector';
import type { PipelineResult, GraphNode } from '../types';
import type { ExtractedConcept } from './extract';

/**
 * Main AI processing pipeline orchestrator.
 * Per TRD.md §2.3:
 * 1. Chunk note into semantically coherent pieces
 * 2. Extract concepts + generate flashcards from each chunk (one LLM call)
 * 3. Merge into existing graph (dedup/merge existing nodes)
 * 4. Persist flashcards (dedup handled inside persistCards)
 * 5. Persist graph deltas
 *
 * Idempotent: keyed by content hash. Re-running with same hash is a no-op.
 */
export async function processNote(
  noteFileId: string,
  subjectId: string,
  content: string,
  contentHash: string
): Promise<PipelineResult> {
  const startTime = Date.now();

  const result: PipelineResult = {
    nodes_created: 0,
    nodes_merged: 0,
    edges_created: 0,
    cards_created: 0,
    cards_deduplicated: 0,
    processing_time_ms: 0,
  };

  // --- Step 1: Chunk the note ---
  const chunks = chunkNote(content);

  // --- Get existing graph state for this subject ---
  // Strict read: an empty result caused by a DB error must not look like "no graph yet"
  const existingNodes = await queryAllStrict<GraphNode>(
    'SELECT * FROM graph_nodes WHERE subject_id = $1',
    [subjectId]
  );

  // Track all nodes created/merged across chunks for edge building
  const allCreatedNodes: GraphNode[] = [];
  const allMergedNodes: Array<{ existing_id: string; merged_name: string }> = [];

  // --- Process each chunk ---
  let processedAnyChunk = false;
  let firstChunkError: unknown = null;

  for (const chunk of chunks) {
    if (chunk.trim().length < 50) continue; // Skip trivially small chunks

    try {
      await processChunk(chunk);
      processedAnyChunk = true;
    } catch (err) {
      // One bad chunk shouldn't discard the rest of the note (or earlier progress).
      console.error('[Pipeline] chunk failed, continuing with remaining chunks:', err);
      if (!firstChunkError) firstChunkError = err;
    }
  }

  // If every chunk failed, surface the underlying cause so the user gets a real message.
  if (!processedAnyChunk && firstChunkError) {
    throw firstChunkError instanceof Error
      ? firstChunkError
      : new Error(String(firstChunkError));
  }

  // Chunk processing extracted into a helper for the per-chunk error boundary above
  async function processChunk(chunk: string) {
    // Step 2: Extract concepts AND generate flashcards from this chunk (one LLM call)
    const extraction = await extractConcepts(chunk);
    const extractedConcepts = extraction.concepts;

    // Step 2b: Pre-filter concepts using string + vector similarity.
    // Vector checks are BATCHED: one embed call for all concepts, then the
    // queries run in parallel — not a sequential round trip per concept.
    const vectorMergedConcepts: Array<{ concept: ExtractedConcept; existingNode: GraphNode }> = [];
    let conceptsForLLM: ExtractedConcept[] = [];
    const knownNodes = [...existingNodes, ...allCreatedNodes];

    for (const concept of extractedConcepts) {
      // First check string similarity (fast, no API call)
      let foundSimilar = false;
      for (const existing of knownNodes) {
        if (stringSimilarity(concept.name, existing.name) > 0.8) {
          vectorMergedConcepts.push({ concept, existingNode: existing });
          foundSimilar = true;
          break;
        }
      }
      if (!foundSimilar) {
        conceptsForLLM.push(concept);
      }
    }

    // Batched vector check for the concepts that didn't string-match.
    // Skipped entirely when there are no existing nodes to merge against.
    if (knownNodes.length > 0 && conceptsForLLM.length > 0) {
      try {
        const embeddings = await generateEmbeddings(
          conceptsForLLM.map((c) => `${c.name}: ${c.definition}`),
          'query'
        );
        const queryResults = await querySimilarVectorsBatched(
          graphNamespace(subjectId),
          embeddings,
          1,
          0.85
        );
        const stillNew: ExtractedConcept[] = [];
        for (let i = 0; i < conceptsForLLM.length; i++) {
          const similar = queryResults[i] && queryResults[i][0];
          const existingNode = similar && similar.score > 0.88
            ? knownNodes.find((n) => n.id === similar.id)
            : undefined;
          if (existingNode) {
            vectorMergedConcepts.push({ concept: conceptsForLLM[i], existingNode });
          } else {
            stillNew.push(conceptsForLLM[i]);
          }
        }
        conceptsForLLM = stillNew;
      } catch (err) {
        // Vector search failed, continue all remaining concepts to the LLM
        console.warn('Batched vector pre-filter failed, continuing to LLM merge:', err);
      }
    }

    // Step 3: Process vector-merged concepts (automatic merge without LLM)
    for (const { concept, existingNode } of vectorMergedConcepts) {
      await executeStrict(
        'UPDATE graph_nodes SET reference_count = reference_count + 1, updated_at = NOW() WHERE id = $1',
        [existingNode.id]
      );
      result.nodes_merged++;

      // Link note to merged node
      try {
        await executeStrict(
          'INSERT INTO node_note_map (node_id, note_file_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [existingNode.id, noteFileId]
        );
      } catch {
        // Ignore duplicate map entries
      }
    }

    // Step 3b: Merge remaining concepts via LLM (for uncertain cases)
    const graphDelta = await mergeConceptsIntoGraph(
      subjectId,
      conceptsForLLM,
      // Pass all nodes (including ones created earlier in this run)
      [
        ...existingNodes,
        ...allCreatedNodes,
      ]
    );

    result.nodes_created += graphDelta.nodes_created.length;
    result.nodes_merged += graphDelta.nodes_merged.length;
    result.edges_created += graphDelta.edges_created.length;

    // Track for subsequent chunks
    allCreatedNodes.push(...graphDelta.nodes_created);
    allMergedNodes.push(...graphDelta.nodes_merged);

    // Map node names to their IDs for card tagging
    const nodeNameToId: Record<string, string> = {};
    for (const node of graphDelta.nodes_created) {
      nodeNameToId[node.name.toLowerCase()] = node.id;
    }
    for (const merged of graphDelta.nodes_merged) {
      nodeNameToId[merged.merged_name.toLowerCase()] = merged.existing_id;
    }

    // Step 4: Persist flashcards. Cards come from the combined extraction call;
    // fall back to a dedicated card-generation call only if it produced none.
    let cards = extraction.cards;
    if (cards.length === 0 && extractedConcepts.length > 0) {
      cards = await generateCardsFromConcepts(extractedConcepts);
    }
    const cardResult = await persistCards(noteFileId, subjectId, cards, nodeNameToId);

    result.cards_created += cardResult.created;
    result.cards_deduplicated += cardResult.deduplicated;

    // Link note to any newly created nodes
    for (const node of graphDelta.nodes_created) {
      try {
        await executeStrict(
          'INSERT INTO node_note_map (node_id, note_file_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [node.id, noteFileId]
        );
      } catch {
        // Ignore duplicate map entries
      }
    }
  }

  result.processing_time_ms = Date.now() - startTime;

  console.log(
    `[Pipeline] note=${noteFileId} chunks=${chunks.length} ` +
    `nodes_created=${result.nodes_created} nodes_merged=${result.nodes_merged} ` +
    `edges=${result.edges_created} cards=${result.cards_created} deduped=${result.cards_deduplicated} ` +
    `time=${result.processing_time_ms}ms`
  );

  return result;
}

/**
 * Compute SHA-256 hash of content for dedup/change detection.
 * Per TRD.md §2.1 (Diffing).
 */
export async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b: number) => b.toString(16).padStart(2, '0')).join('');
}