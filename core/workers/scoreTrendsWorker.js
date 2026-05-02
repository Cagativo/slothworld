// core/workers/scoreTrendsWorker.js
import { hashString } from '../utils.js';

/**
 * ScoreTrendsWorker
 *
 * Receives an array of signal strings and assigns each a deterministic
 * numeric score derived from the signal's content via hashString.
 *
 * @param {{ signals: string[] }} input
 * @returns {{ success: boolean, result?: { scored: Array<{ item: string, score: number }> }, error?: string }}
 */
export function runScoreTrendsWorker(input) {
  const signals = Array.isArray(input && input.signals) ? input.signals : [];

  const scored = signals.map((item) => ({
    item: String(item),
    score: hashString(String(item)) % 100 || 0
  }));

  return {
    success: true,
    result: { scored }
  };
}
