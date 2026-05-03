// M0.5 BRIDGE — remove in M1 and replace with TaskEngine routing

import { createEventBus } from './eventBus.js';
import { runTrendResearchWorkflow } from './runTrendResearchWorkflow.js';

/**
 * Module-level singleton EventBus for M0.5.
 * Exported so other M0.5 modules (e.g. issue #94) can subscribe to results.
 */
export const eventBus = createEventBus();

/**
 * Wire up the trend research bridge on the given eventBus.
 * Listens for TREND_RESEARCH_REQUESTED window CustomEvents and emits
 * TREND_RESEARCH_COMPLETED or TREND_RESEARCH_FAILED onto the internal bus.
 *
 * @param {ReturnType<import('./eventBus.js').createEventBus>} bus
 */
export function initTrendResearchBridge(bus) {
  window.addEventListener('slothworld:event', (e) => {
    if (!e.detail || e.detail.type !== 'TREND_RESEARCH_REQUESTED') {
      return;
    }

    const { requestId, keyword } = e.detail.payload || {};
    if (!requestId || !keyword) {
      return;
    }
    const workflowResult = runTrendResearchWorkflow({ keyword });

    if (workflowResult.success) {
      bus.emit({
        type: 'TREND_RESEARCH_COMPLETED',
        payload: {
          requestId,
          keyword,
          result: workflowResult.result,
          success: true
        }
      });
    } else {
      bus.emit({
        type: 'TREND_RESEARCH_FAILED',
        payload: {
          requestId,
          keyword,
          error: workflowResult.error
        }
      });
    }
  });
}
