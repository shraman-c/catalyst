import { getStrongModel, parseJsonResponse, generateEmbedding } from './client';
import type { ExtractedConcept } from './extract';
import type { GraphNode } from '../types';
import { queryAll, queryOne, execute, generateId, findSimilarNodes, updateNodeEmbedding } from '../db';
import { stringSimilarity } from './utils';

// Re-export for external use
export { stringSimilarity } from './utils';

export interface GraphDelta {
  nodes_created: GraphNode[];
  nodes_merged: Array<{ existing_id: string; merged_name: string }>;
  edges_created: Array<{
    from_node_id: string;
    to_node_id: string;
    relationship_type: string;
  }>;
}

const MERGE_PROMPT = `You are an expert knowledge graph curator. Given a list of newly extracted concepts and an existing knowledge graph, decide how to merge them.

Return ONLY valid JSON matching this exact schema — no explanation, no markdown:
{
  "decisions": [
    {
      "new_concept_name": "name of incoming concept",
      "action": "create | merge | skip",
      "merge_with_id": "existing node id if action=merge (null otherwise)",
      "reason": "brief reason"
    }
  ]
}

Rules:
- "create": this is a genuinely new concept not in the graph
- "merge": this concept is the same as an existing one (even if named slightly differently)
- "skip": too generic to be a useful graph node (e.g. "Introduction", "Summary", "Notes")

Existing graph nodes:
{EXISTING_NODES_JSON}

Newly extracted concepts:
{NEW_CONCEPTS_JSON}`;

export async function mergeConceptsIntoGraph(
  subjectId: string,
  extractedConcepts: ExtractedConcept[],
  existingNodes: GraphNode[]
): Promise<GraphDelta> {
  const delta: GraphDelta = {
    nodes_created: [],
    nodes_merged: [],
    edges_created: [],
  };

  if (extractedConcepts.length === 0) return delta;

  const nodeMergeMap: Record<string, string> = {};

  if (existingNodes.length > 0) {
    const model = getStrongModel();

    const existingSummary = existingNodes
      .map((n) => `  { "id": "${n.id}", "name": "${n.name}" }`)
      .join(',\n');

    const newConceptsSummary = extractedConcepts
      .map((c) => `  { "name": "${c.name}", "definition": "${c.definition.slice(0, 80)}" }`)
      .join(',\n');

    const prompt = MERGE_PROMPT
      .replace('{EXISTING_NODES_JSON}', `[\n${existingSummary}\n]`)
      .replace('{NEW_CONCEPTS_JSON}', `[\n${newConceptsSummary}\n]`);

    try {
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const parsed = parseJsonResponse(text) as {
        decisions: Array<{
          new_concept_name: string;
          action: 'create' | 'merge' | 'skip';
          merge_with_id: string | null;
        }>;
      };

      for (const decision of parsed.decisions) {
        const concept = extractedConcepts.find(
          (c) => c.name.toLowerCase() === decision.new_concept_name.toLowerCase()
        );
        if (!concept) continue;

        if (decision.action === 'skip') {
          nodeMergeMap[concept.name] = '';
        } else if (decision.action === 'merge' && decision.merge_with_id) {
          await execute(
            'UPDATE graph_nodes SET reference_count = reference_count + 1, updated_at = NOW() WHERE id = $1',
            [decision.merge_with_id]
          );
          nodeMergeMap[concept.name] = decision.merge_with_id;
          delta.nodes_merged.push({ existing_id: decision.merge_with_id, merged_name: concept.name });
        } else if (decision.action === 'create') {
          const node = await createNode(subjectId, concept);
          nodeMergeMap[concept.name] = node.id;
          delta.nodes_created.push(node);
        }
      }
    } catch (err) {
      console.error('Graph merge error:', err);
      // Fallback: create all
      for (const concept of extractedConcepts) {
        const node = await createNode(subjectId, concept);
        nodeMergeMap[concept.name] = node.id;
        delta.nodes_created.push(node);
      }
    }
  } else {
    for (const concept of extractedConcepts) {
      const node = await createNode(subjectId, concept);
      nodeMergeMap[concept.name] = node.id;
      delta.nodes_created.push(node);
    }
  }

  // Create edges
  const allNodeMap = buildAllNodeMap(existingNodes, delta.nodes_created);

  for (const concept of extractedConcepts) {
    const fromId = nodeMergeMap[concept.name];
    if (!fromId) continue;

    for (const rel of concept.relationships) {
      const toId = nodeMergeMap[rel.target] || allNodeMap[rel.target.toLowerCase()];
      if (!toId || fromId === toId) continue;

      const existingEdge = await queryOne(
        'SELECT id FROM graph_edges WHERE from_node_id = $1 AND to_node_id = $2 AND relationship_type = $3',
        [fromId, toId, rel.type]
      );

      if (!existingEdge) {
        const edgeId = generateId();
        await execute(
          "INSERT INTO graph_edges (id, subject_id, from_node_id, to_node_id, relationship_type, created_at) VALUES ($1, $2, $3, $4, $5, NOW())",
          [edgeId, subjectId, fromId, toId, rel.type]
        );
        delta.edges_created.push({ from_node_id: fromId, to_node_id: toId, relationship_type: rel.type });
      }
    }
  }

  return delta;
}

async function createNode(subjectId: string, concept: ExtractedConcept): Promise<GraphNode> {
  const id = generateId();

  // Generate embedding for the concept (name + definition combined)
  const embeddingText = `${concept.name}: ${concept.definition}`;
  let embedding: number[] | null = null;
  
  try {
    embedding = await generateEmbedding(embeddingText);
  } catch (err) {
    console.error('Failed to generate embedding for node:', concept.name, err);
    // Continue without embedding - will work but dedup won't be as effective
  }

  // Store node with embedding
  const embeddingStr = embedding ? `[${embedding.join(',')}]` : 'NULL';
  await execute(
    `INSERT INTO graph_nodes (id, subject_id, name, definition, reference_count, manually_edited, embedding, created_at, updated_at) 
     VALUES ($1, $2, $3, $4, 1, FALSE, ${embedding ? '$5::vector' : 'NULL'}, NOW(), NOW())`,
    embedding ? [id, subjectId, concept.name, concept.definition, embeddingStr] : [id, subjectId, concept.name, concept.definition]
  );

  const now = new Date().toISOString();
  return {
    id,
    subject_id: subjectId,
    name: concept.name,
    definition: concept.definition,
    reference_count: 1,
    manually_edited: false,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Check if a concept is similar to existing nodes using vector embeddings.
 * Returns the most similar node if above threshold, null otherwise.
 */
export async function findSimilarConcept(
  subjectId: string,
  concept: ExtractedConcept
): Promise<{ id: string; name: string; similarity: number } | null> {
  try {
    const embeddingText = `${concept.name}: ${concept.definition}`;
    const embedding = await generateEmbedding(embeddingText);
    
    const similar = await findSimilarNodes(subjectId, embedding, 0.85, 1);
    return similar.length > 0 ? similar[0] : null;
  } catch (err) {
    console.error('Vector similarity search failed:', err);
    return null;
  }
}

function buildAllNodeMap(existing: GraphNode[], created: GraphNode[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const n of [...existing, ...created]) {
    map[n.name.toLowerCase()] = n.id;
  }
  return map;
}

