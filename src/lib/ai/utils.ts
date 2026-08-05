/**
 * Shared utility functions for AI pipeline deduplication
 */

/**
 * Compute Jaccard string similarity between two strings.
 * Returns a value between 0 (completely different) and 1 (identical).
 */
export function stringSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}
