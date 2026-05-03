// core/engine/runTrendResearchWorkflow.js
//
// M0 SCOPE NOTE: This is a direct, in-process sequential executor for the
// TrendResearchWorkflow. It intentionally bypasses TaskEngine lifecycle
// management (event sourcing, reconciler locks, idempotency) which are
// explicitly out of scope for M0. It is NOT a replacement for TaskEngine-
// managed execution — it is a standalone utility that chains pure, stateless
// step workers for direct invocation and testing.

import { runCollectSignalsWorker } from '../workers/collectSignalsWorker.js';
import { runSignalNormalizationWorker } from '../workers/signalNormalizationWorker.js';
import { runScoreTrendsWorker } from '../workers/scoreTrendsWorker.js';
import { runSelectCandidatesWorker } from '../workers/selectCandidatesWorker.js';
import { runProduceFinalOutputWorker } from '../workers/produceFinalOutputWorker.js';

/**
 * Executes the TrendResearchWorkflow sequentially through all 4 steps.
 *
 * Step 1: CollectSignals   – collects raw signals for the given keyword
 * Step 2: ScoreTrends      – scores each collected signal
 * Step 3: SelectCandidates – selects the top-scored candidates
 * Step 4: ProduceFinalOutput – ranks candidates into the final output
 *
 * Input is validated before any worker is invoked. If the keyword is absent
 * or not a non-empty string, the function returns a step-1 failure without
 * delegating to the worker.
 *
 * If any step returns { success: false }, execution aborts immediately and
 * returns { success: false, error, failedStep }.
 *
 * @param {{ keyword: string }} input
 * @returns {Promise<{ success: true, result: { ranked: string[] } }
 *          |{ success: false, error: string, failedStep: number }>}
 */
export async function runTrendResearchWorkflow(input) {
  const keyword =
    input && typeof input.keyword === 'string' ? input.keyword.trim() : '';

  if (!keyword) {
    return { success: false, error: 'missing_keyword', failedStep: 1 };
  }

  const step1 = await runCollectSignalsWorker({ keyword });
  if (!step1.success) {
    return { success: false, error: step1.error, failedStep: 1 };
  }

  const normalizedStep = runSignalNormalizationWorker({
    keyword,
    signals: step1.result.signals,
    rawSignals: step1.result.rawSignals
  });
  if (!normalizedStep.success) {
    return { success: false, error: normalizedStep.error, failedStep: 2 };
  }

  const step2 = runScoreTrendsWorker({ normalizedSignals: normalizedStep.result.normalizedSignals });
  if (!step2.success) {
    return { success: false, error: step2.error, failedStep: 2 };
  }

  const step3 = runSelectCandidatesWorker({ scored: step2.result.scored });
  if (!step3.success) {
    return { success: false, error: step3.error, failedStep: 3 };
  }

  const step4 = runProduceFinalOutputWorker({ candidates: step3.result.candidates });
  if (!step4.success) {
    return { success: false, error: step4.error, failedStep: 4 };
  }

  return { success: true, result: { ranked: step4.result.ranked } };
}
