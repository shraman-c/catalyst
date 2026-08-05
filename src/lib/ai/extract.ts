import { getFastModel, parseJsonResponse } from './client';

export interface ExtractedConcept {
  name: string;
  definition: string;
  relationships: Array<{
    target: string; // name of related concept
    type: string;   // "depends on" | "is a type of" | "contrasts with" | "part of" | "leads to" | "example of"
  }>;
}

export interface ExtractedCard {
  front: string;
  back: string;
  card_type: 'qa' | 'cloze';
  primary_concept?: string; // name of the concept this card is about
}

export interface ExtractionResult {
  concepts: ExtractedConcept[];
  raw_topics: string[]; // high-level topics covered in the note
  cards: ExtractedCard[]; // flashcards generated in the same LLM pass
}

// One combined LLM pass per chunk: concept extraction + flashcard generation.
// This halves the per-chunk LLM calls (extract + cards used to be two calls).
const EXTRACTION_PROMPT = `You are an expert academic tutor. Analyze the following lecture notes or study material and extract key concepts for a knowledge graph, then generate flashcards for active-recall study.

Return ONLY valid JSON matching this exact schema — no explanation, no markdown, no other text:
{
  "concepts": [
    {
      "name": "concept name (short, 1-4 words, title case)",
      "definition": "clear, concise definition as a student would need it (1-3 sentences)",
      "relationships": [
        {
          "target": "name of another concept in this list",
          "type": "one of: depends on | is a type of | contrasts with | part of | leads to | example of"
        }
      ]
    }
  ],
  "raw_topics": ["list", "of", "high-level", "topics"],
  "cards": [
    {
      "front": "Question or prompt",
      "back": "Answer",
      "card_type": "qa | cloze",
      "primary_concept": "name of the concept this card is about"
    }
  ]
}

Rules for concepts:
- Extract 5-20 concepts depending on note density. Quality over quantity.
- Only include relationships between concepts that are explicitly or strongly implied in the text.
- Definitions should be student-facing (plain language, no jargon without explanation).
- concept names should be distinct — do not repeat the same concept under different names.
- relationship targets MUST be names of other concepts in the same list.

Rules for cards:
- Generate 1-2 cards for the most important concepts, up to 12 cards total, using the definitions above.
- For Q&A cards: ask a clear, specific question. Avoid "What is...?" — use "Explain", "How does", "Why is", "Compare".
- For cloze cards: write a sentence with {{c1::the key term}} blanked out.
- Back must be concise (1-3 sentences max).
- Do not create duplicate cards. "cards" may be an empty list if the content has no study-worthy concepts.

Notes content:
---
{NOTES_CONTENT}
---`;

/**
 * Extract concepts AND generate flashcards from a chunk of note text in a
 * single fast-model call. Returns empty concepts/cards on parse failure so the
 * pipeline never crashes on malformed output.
 */
export async function extractConcepts(noteContent: string): Promise<ExtractionResult> {
  const model = getFastModel();

  const prompt = EXTRACTION_PROMPT.replace(
    // Cap at ~6K chars so the combined concepts+cards output stays comfortably
    // inside the fast model's context window (prevents truncation of the JSON).
    '{NOTES_CONTENT}',
    noteContent.slice(0, 6000)
  );

  const result = await model.generateContent(prompt);
  const text = result.response.text();

  try {
    const parsed = parseJsonResponse(text) as ExtractionResult;

    // Validate structure
    if (!parsed.concepts || !Array.isArray(parsed.concepts)) {
      throw new Error('Invalid response structure: missing concepts array');
    }

    return {
      concepts: parsed.concepts,
      raw_topics: Array.isArray(parsed.raw_topics) ? parsed.raw_topics : [],
      cards: Array.isArray(parsed.cards) ? parsed.cards : [],
    };
  } catch (err) {
    console.error('Concept extraction parse error:', err);
    console.error('Raw response:', text);
    // Return empty result rather than crashing the pipeline
    return { concepts: [], raw_topics: [], cards: [] };
  }
}

/**
 * Chunk long note content into semantically coherent segments.
 * Splits on headings (##) or double newlines for now (Stage 1 simple version).
 * TRD.md §2.3 specifies heading/paragraph-aware chunking.
 */
export function chunkNote(content: string, maxChunkSize = 3000): string[] {
  // Split on heading markers first
  const headingSplit = content.split(/(?=^#{1,3}\s)/m);

  const chunks: string[] = [];
  let currentChunk = '';

  for (const section of headingSplit) {
    if (currentChunk.length + section.length > maxChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = section;
    } else {
      currentChunk += '\n' + section;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks.length > 0 ? chunks : [content];
}
