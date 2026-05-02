// core/workers/selectCandidatesWorker.js

/**
 * SelectCandidatesWorker
 *
 * Receives a scored array and returns the top 3 items by score descending.
 * Returns the item strings only (scores are discarded).
 *
 * @param {{ scored: Array<{ item: string, score: number }> }} input
 * @returns {{ success: boolean, result?: { candidates: string[] }, error?: string }}
 */
export function runSelectCandidatesWorker(input) {
  const scored = Array.isArray(input && input.scored) ? input.scored : [];

  const sorted = scored.slice().sort((a, b) => b.score - a.score);
  const candidates = sorted.slice(0, 3).map((entry) => String(entry.item));

  return {
    success: true,
    result: { candidates }
  };
}
