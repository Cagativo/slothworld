// core/workers/collectSignalsWorker.js

/**
 * CollectSignalsWorker
 *
 * Given a keyword string, returns three deterministic signal strings:
 * the keyword itself plus two suffixed variants.
 *
 * @param {{ keyword: string }} input
 * @returns {{ success: boolean, result?: { signals: string[] }, error?: string }}
 */
export function runCollectSignalsWorker(input) {
  const keyword = input && typeof input.keyword === 'string' ? input.keyword.trim() : '';

  if (!keyword) {
    return { success: false, error: 'missing_keyword' };
  }

  return {
    success: true,
    result: {
      signals: [keyword, `${keyword}_1`, `${keyword}_2`]
    }
  };
}
