// core/workers/produceFinalOutputWorker.js

/**
 * ProduceFinalOutputWorker
 *
 * Receives the candidate array (preserving { item, score } objects from
 * SelectCandidatesWorker) and returns the items sorted by score descending
 * as the final ranked string array.
 *
 * @param {{ candidates: Array<{ item: string, score: number }> }} input
 * @returns {{ success: boolean, result?: { ranked: string[] }, error?: string }}
 */
export function runProduceFinalOutputWorker(input) {
  const candidates = Array.isArray(input && input.candidates) ? input.candidates : [];

  const ranked = candidates
    .slice()
    .sort((a, b) => b.score - a.score)
    .map((entry) => String(entry.item));

  return {
    success: true,
    result: { ranked }
  };
}
