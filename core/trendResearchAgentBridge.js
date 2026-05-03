// M0.5 — Sloth state machine for TrendResearch events (issue #94)
// Agents react to events only — no workflow calls permitted here.

import { eventBus } from './engine/trendResearchBridge.js';

/** Delay before an agent in 'done' state resets back to 'idle' (ms). */
const AGENT_RESET_DELAY_MS = 5000;

/**
 * Wire the agent array to TrendResearch lifecycle events.
 *
 * Reacts to:
 *  - `slothworld:event` window CustomEvent with type TREND_RESEARCH_REQUESTED
 *  - TREND_RESEARCH_COMPLETED / TREND_RESEARCH_FAILED on the internal eventBus
 *
 * @param {Array} agents - The shared mutable agents array from core/app-state.js
 */
export function initTrendResearchAgentReactions(agents) {
  // Module-level map to track pending reset timers per agent, so we can
  // clear a stale timer if a new COMPLETED event arrives for the same agent.
  const resetTimers = new Map();

  // React to TREND_RESEARCH_REQUESTED dispatched by the UI
  window.addEventListener('slothworld:event', (e) => {
    if (e.detail?.type !== 'TREND_RESEARCH_REQUESTED') return;

    const { requestId, keyword } = e.detail.payload || {};
    if (!requestId || !keyword) return;

    const sloth = agents.find(a => a.state === 'idle');
    if (!sloth) return; // no idle sloth available — silently ignore (no queueing in M0.5)

    sloth.state = 'working';
    sloth.requestId = requestId;
    sloth.keyword = keyword;
  });

  // React to TREND_RESEARCH_COMPLETED / TREND_RESEARCH_FAILED on the internal bus
  eventBus.subscribe((event) => {
    if (event.type === 'TREND_RESEARCH_COMPLETED') {
      const sloth = agents.find(a => a.requestId === event.payload.requestId);
      if (!sloth) return;

      // Clear any existing reset timer for this agent before setting a new one
      if (resetTimers.has(sloth)) {
        clearTimeout(resetTimers.get(sloth));
      }

      sloth.state = 'done';
      sloth.trendResult = event.payload.result?.ranked ?? [];

      // Reset after AGENT_RESET_DELAY_MS so future tasks can be assigned
      const timerId = setTimeout(() => {
        resetTimers.delete(sloth);
        sloth.state = 'idle';
        sloth.trendResult = null;
        sloth.requestId = null;
        sloth.keyword = null;
      }, AGENT_RESET_DELAY_MS);

      resetTimers.set(sloth, timerId);
    }

    if (event.type === 'TREND_RESEARCH_FAILED') {
      const sloth = agents.find(a => a.requestId === event.payload.requestId);
      if (!sloth) return;

      // Cancel any pending reset timer (shouldn't normally exist here, but defensive)
      if (resetTimers.has(sloth)) {
        clearTimeout(resetTimers.get(sloth));
        resetTimers.delete(sloth);
      }

      sloth.state = 'idle';
      sloth.requestId = null;
      sloth.keyword = null;
    }
  });
}
