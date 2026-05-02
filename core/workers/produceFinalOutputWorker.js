// core/workers/produceFinalOutputWorker.js

/**
 * ProduceFinalOutputWorker
 *
 * Receives an array of candidate strings and returns them sorted
 * alphabetically as the final ranked output.
 *
 * @param {{ candidates: string[] }} input
 * @returns {{ success: boolean, result?: { ranked: string[] }, error?: string }}
 */
export function runProduceFinalOutputWorker(input) {
  const candidates = Array.isArray(input && input.candidates) ? input.candidates : [];

  const ranked = candidates.slice().sort((a, b) => String(a).localeCompare(String(b)));

  return {
    success: true,
    result: { ranked }
  };
}
