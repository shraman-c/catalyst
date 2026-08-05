/**
 * AI client — Groq (OpenAI-compatible) for all LLM text generation.
 *
 * Per TRD.md §3 (tiered model strategy):
 * - Fast/cheap model for extraction + card generation
 * - Stronger model for graph merge reasoning (higher ambiguity)
 *
 * Groq's REST API is OpenAI-compatible:
 *   POST https://api.groq.com/openai/v1/chat/completions
 */

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

// Fast/cheap model for extraction + card generation
const FAST_MODEL = 'llama-3.1-8b-instant';
// Stronger model for graph merge reasoning (higher ambiguity)
const STRONG_MODEL = 'llama-3.3-70b-versatile';

function getGroqApiKey(): string {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GROQ_API_KEY environment variable is not set. ' +
      'Create a free key at https://console.groq.com/keys and add it to .env.local'
    );
  }
  return apiKey;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface GroqGenerateResult {
  response: { text: () => string };
}

/**
 * Minimal OpenAI-compatible model adapter so callers keep the same
 * `model.generateContent(prompt)` / `result.response.text()` interface.
 */
class GroqModel {
  constructor(private model: string) {}

  async generateContent(prompt: string): Promise<GroqGenerateResult> {
    const content = await chatCompletion(this.model, prompt);
    return { response: { text: () => content } };
  }
}

async function chatCompletion(model: string, prompt: string): Promise<string> {
  const apiKey = getGroqApiKey();

  const body = {
    model,
    messages: [
      {
        role: 'system',
        content:
          'You are a precise, reliable assistant. Always return valid JSON matching the requested schema. ' +
          'Respond with JSON only — no explanations, no markdown code fences.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.4,
    response_format: { type: 'json_object' },
  };

  // Retry transient failures (rate limits, server hiccups, network errors)
  const maxAttempts = 4;

  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(GROQ_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        // Don't let a hung upstream leave the request dangling forever
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      if (attempt >= maxAttempts) {
        throw new Error(`Groq network error: ${err instanceof Error ? err.message : String(err)}`);
      }
      await sleep(1000 * 2 ** (attempt - 1));
      continue;
    }

    if (res.ok) {
      const data = await res.json();
      const content: unknown = data?.choices?.[0]?.message?.content;
      if (typeof content === 'string' && content.trim()) {
        return content;
      }
      throw new Error('Groq returned an empty completion');
    }

    const detail = await res.text().catch(() => '');
    const retryable = res.status === 429 || res.status >= 500;

    if (!retryable || attempt >= maxAttempts) {
      throw new Error(
        `Groq API error (HTTP ${res.status}): ${detail.slice(0, 300)}`
      );
    }

    const retryAfterMs = (Number(res.headers.get('retry-after')) || 0) * 1000;
    await sleep(Math.max(retryAfterMs, 1000 * 2 ** (attempt - 1)));
  }
}

/**
 * Get the fast/cheap model for extraction and card generation.
 */
export function getFastModel() {
  return new GroqModel(FAST_MODEL);
}

/**
 * Get the stronger model for graph-merge reasoning.
 */
export function getStrongModel() {
  return new GroqModel(STRONG_MODEL);
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
