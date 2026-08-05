import { getFastModel, parseJsonResponse, generateEmbedding } from './client';
import type { ExtractedConcept } from './extract';
import { queryAll, queryOne, execute, generateId, findSimilarCards } from '../db';
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

export async function generateCards(
  noteFileId: string,
  subjectId: string,
  extractedConcepts: ExtractedConcept[],
  nodeNameToId: Record<string, string>
): Promise<{ created: number; deduplicated: number }> {
  if (extractedConcepts.length === 0) return { created: 0, deduplicated: 0 };

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

  let generatedCards: (GeneratedCard & { primary_concept?: string })[] = [];

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = parseJsonResponse(text) as { cards: any[] };
    generatedCards = parsed.cards || [];
  } catch (err) {
    console.error('Card generation error:', err);
    return { created: 0, deduplicated: 0 };
  }

  // Get existing cards for dedup (both exact and vector)
  const existingCards = await queryAll<Flashcard>(
    'SELECT * FROM flashcards WHERE subject_id = $1 AND status != $2',
    [subjectId, 'deleted']
  );

  const existingFronts = new Set(existingCards.map((c) => c.front.toLowerCase().trim()));

  // Helper to check vector similarity dedup
  async function isVectorDuplicate(front: string, back: string): Promise<boolean> {
    try {
      const embeddingText = `${front}: ${back}`;
      const embedding = await generateEmbedding(embeddingText);
      const similar = await findSimilarCards(subjectId, embedding, 0.85, 1);
      return similar.length > 0;
    } catch (err) {
      // If vector search fails, fall back to string similarity only
      console.warn('Vector dedup search failed, using string similarity fallback:', err);
      return false;
    }
  }

  let created = 0;
  let deduplicated = 0;

  for (const card of generatedCards) {
    if (!card.front?.trim() || !card.back?.trim()) continue;

    const frontKey = card.front.toLowerCase().trim();

    // Check dedup (exact + string similarity + vector similarity)
    let isDuplicate = existingFronts.has(frontKey);
    
    // Check string similarity
    if (!isDuplicate) {
      for (const existingFront of existingFronts) {
        if (stringSimilarity(frontKey, existingFront) > 0.85) {
          isDuplicate = true;
          break;
        }
      }
    }
    
    // Check vector similarity (semantic dedup)
    if (!isDuplicate) {
      isDuplicate = await isVectorDuplicate(card.front.trim(), card.back.trim());
    }

    if (isDuplicate) {
      deduplicated++;
      continue;
    }

    // Get node IDs for this card
    const nodeIds: string[] = [];
    if (card.primary_concept) {
      const nodeId = nodeNameToId[card.primary_concept.toLowerCase()];
      if (nodeId) nodeIds.push(nodeId);
    }

    const cardId = generateId();
    const now = new Date().toISOString();

    // Generate embedding for the card (front + back combined)
    const embeddingText = `${card.front.trim()}: ${card.back.trim()}`;
    let embedding: number[] | null = null;
    
    try {
      embedding = await generateEmbedding(embeddingText);
    } catch (err) {
      console.error('Failed to generate embedding for card:', card.front.slice(0, 50), err);
      // Continue without embedding
    }

    // Store card with embedding
    const embeddingStr = embedding ? `[${embedding.join(',')}]` : 'NULL';
    await execute(
      `INSERT INTO flashcards (id, subject_id, note_file_id, node_ids, front, back, card_type, status, embedding, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'new', ${embedding ? '$8::vector' : 'NULL'}, $9, $10)`,
      embedding 
        ? [cardId, subjectId, noteFileId, JSON.stringify(nodeIds), card.front.trim(), card.back.trim(), card.card_type || 'qa', embeddingStr, now, now]
        : [cardId, subjectId, noteFileId, JSON.stringify(nodeIds), card.front.trim(), card.back.trim(), card.card_type || 'qa', now, now]
    );

    existingFronts.add(frontKey);
    created++;
  }

  return { created, deduplicated };
}

