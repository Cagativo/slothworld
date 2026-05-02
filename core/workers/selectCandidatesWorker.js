// core/workers/selectCandidatesWorker.js

/** Maximum number of candidates to select. */
const MAX_CANDIDATES = 3;

/**
 * SelectCandidatesWorker
 *
 * Receives a scored array and returns the top MAX_CANDIDATES items by score
 * descending, preserving { item, score } objects so the final worker can
 * re-sort by score without losing ranking information.
 *
 * @param {{ scored: Array<{ item: string, score: number }> }} input
 * @returns {{ success: boolean, result?: { candidates: Array<{ item: string, score: number }> }, error?: string }}
 */
export function runSelectCandidatesWorker(input) {
  const scored = Array.isArray(input && input.scored) ? input.scored : [];

  const candidates = scored
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES);

  return {
    success: true,
    result: { candidates }
  };
}
