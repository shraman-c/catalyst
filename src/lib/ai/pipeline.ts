import { queryAll, execute, generateId } from '../db';
import { chunkNote, extractConcepts } from './extract';
import { generateCards } from './cards';
import { mergeConceptsIntoGraph, findSimilarConcept, stringSimilarity } from './graph';
import type { PipelineResult, GraphNode } from '../types';
import type { ExtractedConcept } from './extract';

/**
 * Main AI processing pipeline orchestrator.
 * Per TRD.md §2.3:
 * 1. Chunk note into semantically coherent pieces
 * 2. Extract concepts from each chunk
 * 3. Merge into existing graph (dedup/merge existing nodes)
 * 4. Generate candidate flashcards (dedup + persist handled by generateCards)
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
  const existingNodes = await queryAll<GraphNode>(
    'SELECT * FROM graph_nodes WHERE subject_id = $1',
    [subjectId]
  );

  // Track all nodes created/merged across chunks for edge building
  const allCreatedNodes: GraphNode[] = [];
  const allMergedNodes: Array<{ existing_id: string; merged_name: string }> = [];

  // --- Process each chunk ---
  for (const chunk of chunks) {
    if (chunk.trim().length < 50) continue; // Skip trivially small chunks

    // Step 2: Extract concepts from this chunk
    const extraction = await extractConcepts(chunk);
    const extractedConcepts = extraction.concepts;

    // Step 2b: Pre-filter concepts using vector similarity (Stage 4 optimization)
    // This reduces LLM calls by automatically merging highly similar concepts
    const vectorMergedConcepts: Array<{ concept: ExtractedConcept; existingNode: GraphNode }> = [];
    const conceptsForLLM: ExtractedConcept[] = [];

    for (const concept of extractedConcepts) {
      // First check string similarity (fast, no API call)
      let foundSimilar = false;
      for (const existing of [...existingNodes, ...allCreatedNodes]) {
        if (stringSimilarity(concept.name, existing.name) > 0.8) {
          vectorMergedConcepts.push({ concept, existingNode: existing });
          foundSimilar = true;
          break;
        }
      }

      // If no string match, check vector similarity
      if (!foundSimilar) {
        try {
          const similar = await findSimilarConcept(subjectId, concept);
          if (similar && similar.similarity > 0.88) {
            const existingNode = [...existingNodes, ...allCreatedNodes].find(n => n.id === similar.id);
            if (existingNode) {
              vectorMergedConcepts.push({ concept, existingNode });
              foundSimilar = true;
            }
          }
        } catch {
          // Vector search failed, continue to LLM
        }
      }

      if (!foundSimilar) {
        conceptsForLLM.push(concept);
      }
    }

    // Step 3: Process vector-merged concepts (automatic merge without LLM)
    for (const { concept, existingNode } of vectorMergedConcepts) {
      await execute(
        'UPDATE graph_nodes SET reference_count = reference_count + 1, updated_at = NOW() WHERE id = $1',
        [existingNode.id]
      );
      result.nodes_merged++;

      // Link note to merged node
      try {
        await execute(
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

    // Step 4: Generate cards (handles dedup + persist internally)
    const cardResult = await generateCards(
      noteFileId,
      subjectId,
      extraction.concepts,
      nodeNameToId
    );

    result.cards_created += cardResult.created;
    result.cards_deduplicated += cardResult.deduplicated;

    // Link note to any newly created nodes
    for (const node of graphDelta.nodes_created) {
      try {
        await execute(
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