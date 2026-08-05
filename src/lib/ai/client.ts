import { GoogleGenerativeAI } from '@google/generative-ai';

// Tiered model strategy per TRD.md §3
// Fast/cheap model for extraction tasks
const FAST_MODEL = 'gemini-2.0-flash';
// Stronger model for graph merge reasoning (higher ambiguity)
const STRONG_MODEL = 'gemini-2.0-pro';
// Embedding model for vector similarity
const EMBEDDING_MODEL = 'text-embedding-004';

let _genai: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI {
  if (_genai) return _genai;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY environment variable is not set. ' +
      'Copy .env.example to .env.local and add your Gemini API key from https://aistudio.google.com/app/apikey'
    );
  }
  _genai = new GoogleGenerativeAI(apiKey);
  return _genai;
}

export function getFastModel() {
  return getGenAI().getGenerativeModel({ model: FAST_MODEL });
}

export function getStrongModel() {
  return getGenAI().getGenerativeModel({ model: STRONG_MODEL });
}

/**
 * Generate vector embedding for text using Gemini's embedding model.
 * Returns a 768-dimension vector (text-embedding-004 outputs 768 dims).
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const model = getGenAI().getGenerativeModel({ model: EMBEDDING_MODEL });
  
  // Truncate text to avoid token limits (approx 8000 tokens max)
  const truncatedText = text.slice(0, 30000);
  
  const result = await model.embedContent(truncatedText);
  return result.embedding.values;
}

/**
 * Generate embeddings for multiple texts in batch.
 * More efficient than calling generateEmbedding one at a time.
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const model = getGenAI().getGenerativeModel({ model: EMBEDDING_MODEL });
  
  const truncatedTexts = texts.map(t => t.slice(0, 30000));
  
  const result = await model.batchEmbedContents({
    requests: truncatedTexts.map(text => ({
      model: EMBEDDING_MODEL,
      content: { role: 'user', parts: [{ text }] },
    })),
  });
  
  return result.embeddings.map(e => e.values);
}

/**
 * Parse JSON safely from an LLM response that may include markdown fences
 */
export function parseJsonResponse(text: string): unknown {
  // Strip markdown code fences if present
  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return JSON.parse(cleaned);
}
