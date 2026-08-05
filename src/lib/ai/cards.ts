import { getFastModel, parseJsonResponse } from './client';
import { generateEmbeddings, upsertEmbeddings, querySimilarVectorsBatched, cardsNamespace } from './vector';
import type { ExtractedConcept } from './extract';
import { queryAllStrict, executeStrict, generateId } from '../db';
import { stringSimilarity } from './utils';
import type { Flashcard } from '../types';

export type GeneratedCard = {
  front: string;
  back: string;
  card_type: 'qa' | 'cloze';
};

const CARD_PROMPT = `You are an expert flashcard creator for active recall study. Given a set of concepts and their definitions, generate high-quality flashcards.

Return ONLY valid JSON — no explanation, no markdown:
{
  "cards": [
    {
      "front": "Question or prompt",
      "back": "Answer",
      "card_type": "qa | cloze",
      "primary_concept": "concept name this card is about"
    }
  ]
}

Rules:
- For Q&A cards: ask a clear, specific question. Avoid "What is...?" — use "Explain", "How does", "Why is", "Compare"
- For cloze cards: write a sentence with {{c1::the key term}} blanked out
- 1-2 cards per concept (not more)
- Back must be concise (1-3 sentences max)
- Do not create duplicate cards

Concepts:
{CONCEPTS_JSON}`;

/**
 * Fallback path: generate flashcards from extracted concepts with a dedicated
 * LLM call. Only used when the combined extraction call produced no cards.
 */
export async function generateCardsFromConcepts(
  extractedConcepts: ExtractedConcept[]
): Promise<GeneratedCard[]> {
  if (extractedConcepts.length === 0) return [];

  const model = getFastModel();

  const conceptsJson = JSON.stringify(
    extractedConcepts.slice(0, 15).map((c) => ({
      name: c.name,
      definition: c.definition,
    })),
    null,
    2
  );

  const prompt = CARD_PROMPT.replace('{CONCEPTS_JSON}', conceptsJson);

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = parseJsonResponse(text) as { cards: any[] };
    return (parsed.cards || []).filter(
      (c) => c && typeof c.front === 'string' && c.front.trim() && typeof c.back === 'string' && c.back.trim()
    );
  } catch (err) {
    console.error('Card generation error:', err);
    return [];
  }
}

/**
 * Deduplicate, persist, and store embeddings for generated cards.
 *
 * Vector work is batched instead of one Pinecone round trip per card:
 *   1. local dedup (exact + string similarity) — no API calls
 *   2. vector dedup — ONE batched embed + parallel queries
 *   3. DB inserts
 *   4. storage — ONE batched embed + ONE multi-record upsert
 */
export async function persistCards(
  noteFileId: string,
  subjectId: string,
  generatedCards: GeneratedCard[],
  nodeNameToId: Record<string, string>
): Promise<{ created: number; deduplicated: number }> {
  if (generatedCards.length === 0) return { created: 0, deduplicated: 0 };

  // Get existing cards for dedup (both exact and vector)
  // Strict read: a DB failure must surface instead of silently allowing duplicates
  const existingCards = await queryAllStrict<Flashcard>(
    'SELECT * FROM flashcards WHERE subject_id = $1 AND status != $2',
    [subjectId, 'deleted']
  );

  const existingFronts = new Set(existingCards.map((c) => c.front.toLowerCase().trim()));    // --- Pass 1: local dedup (exact + string similarity) — zero API calls ---
    // Empty/malformed cards are silently skipped, NOT counted as deduplicated
    // (matches pre-refactor behaviour).
    const candidates: Array<GeneratedCard & { primary_concept?: string }> = [];
    let deduplicated = 0;
    for (const card of generatedCards) {
      if (!card.front?.trim() || !card.back?.trim()) continue;
      const frontKey = card.front.toLowerCase().trim();

      let isDuplicate = existingFronts.has(frontKey);
      if (!isDuplicate) {
        for (const existingFront of existingFronts) {
          if (stringSimilarity(frontKey, existingFront) > 0.85) {
            isDuplicate = true;
            break;
          }
        }
      }

      if (isDuplicate) {
        deduplicated++;
        continue;
      }
      // Add to the set so near-duplicates within this batch also dedup
      existingFronts.add(frontKey);
      candidates.push(card);
    }

    // --- Pass 2: vector dedup — one batched embed + bounded-concurrency queries ---
    const survivors: Array<GeneratedCard & { primary_concept?: string }> = [];
    if (candidates.length > 0) {
      let embeddings: number[][] = [];
      try {
        embeddings = await generateEmbeddings(
          candidates.map((c) => `${c.front.trim()}: ${c.back.trim()}`),
          'query'
        );
      } catch (err) {
        // If vector search fails, fall back to string similarity only
        console.warn('Batched card dedup embedding failed, skipping vector dedup:', err);
      }

      if (embeddings.length === candidates.length) {
        const queryResults = await querySimilarVectorsBatched(
          cardsNamespace(subjectId),
          embeddings,
          1,
          0.85
        );
        for (let i = 0; i < candidates.length; i++) {
          if (queryResults[i] && queryResults[i].length > 0) {
            deduplicated++;
          } else {
            survivors.push(candidates[i]);
          }
        }
      } else {
        survivors.push(...candidates);
      }
    }

  // --- Pass 3: persist survivors (DB inserts) ---
  const now = new Date().toISOString();
  const storedCards: Array<{ id: string; card: GeneratedCard & { primary_concept?: string } }> = [];

  for (const card of survivors) {
    // Get node IDs for this card
    const nodeIds: string[] = [];
    if (card.primary_concept) {
      const nodeId = nodeNameToId[card.primary_concept.toLowerCase()];
      if (nodeId) nodeIds.push(nodeId);
    }

    const cardId = generateId();

    // Persist the card (strict — a failure here must surface, not vanish)
    await executeStrict(
      `INSERT INTO flashcards (id, subject_id, note_file_id, node_ids, front, back, card_type, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'new', $8, $9)`,
      [cardId, subjectId, noteFileId, JSON.stringify(nodeIds), card.front.trim(), card.back.trim(), card.card_type || 'qa', now, now]
    );

    storedCards.push({ id: cardId, card });
  }

  // --- Pass 4: store embeddings — one batched embed + one upsert ---
  if (storedCards.length > 0) {
    try {
      const embeddings = await generateEmbeddings(
        storedCards.map(({ card }) => `${card.front.trim()}: ${card.back.trim()}`)
      );
      await upsertEmbeddings(
        cardsNamespace(subjectId),
        storedCards.map(({ id, card }, i) => ({
          id,
          embedding: embeddings[i],
          metadata: { subject_id: subjectId, front: card.front.trim() },
        }))
      );
    } catch (err) {
      console.error('Failed to store card embeddings in Pinecone:', err);
    }
  }

  return { created: storedCards.length, deduplicated };
}
