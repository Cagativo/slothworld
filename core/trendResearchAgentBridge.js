// Sloth state mapping for TrendResearch server lifecycle events.
// Frontend consumes server events only and never executes TrendResearch locally.

import { subscribeEventStream } from './world/eventStore.js';

const DEBUG_AGENT = false;

/**
 * Wire the agent array to TrendResearch lifecycle events.
 *
 * Reacts to server TaskEngine events only:
 *  - TASK_CREATED(type=TREND_RESEARCH)
 *  - TASK_CLAIMED(taskId)
 *  - TASK_ACKED(taskId)
 *
 * @param {Array} agents - The shared mutable agents array from core/app-state.js
 */
export function initTrendResearchAgentReactions(agents) {
  const trendTasks = new Map();

  function normalizeTaskId(value) {
    return String(value ?? '').trim();
  }

  function hasValidTrendResults(trendResult) {
    return Array.isArray(trendResult) && trendResult.some((entry) => {
      if (typeof entry === 'string') {
        return entry.trim().length > 0;
      }

      if (entry && typeof entry === 'object' && typeof entry.item === 'string') {
        return entry.item.trim().length > 0;
      }

      return false;
    });
  }

  function applyWorkingToSloth(sloth, taskId, keyword) {
    if (!sloth) {
      return;
    }

    sloth.state = 'working';
    sloth.requestId = taskId;
    sloth.keyword = keyword || null;
    sloth.trendResult = null;
  }

  function applyCompletedToSloth(sloth, taskId, keyword, trendResult) {
    if (!sloth || !hasValidTrendResults(trendResult)) {
      return;
    }

    sloth.state = 'done';
    sloth.requestId = taskId;
    sloth.keyword = keyword || null;
    sloth.trendResult = trendResult;
  }

  function applyFailedToSloth(sloth) {
    sloth.state = 'idle';
    sloth.requestId = null;
    sloth.keyword = null;
    sloth.trendResult = null;
  }

  function handleTaskCreated(event) {
    const taskType = event && event.payload && typeof event.payload.type === 'string'
      ? event.payload.type
      : null;

    if (taskType !== 'TREND_RESEARCH') {
      return;
    }

    const taskId = normalizeTaskId(event.taskId);
    if (!taskId) {
      return;
    }

    const keyword = event && event.payload && typeof event.payload.keyword === 'string'
      ? event.payload.keyword
      : null;

    trendTasks.set(taskId, {
      keyword,
      trendResult: null
    });
  }

  function handleTaskClaimed(event) {
    const taskId = normalizeTaskId(event.taskId);
    if (!taskId || !trendTasks.has(taskId)) {
      return;
    }

    const existing = agents.find((agent) => agent.state === 'working' && normalizeTaskId(agent.requestId) === taskId);
    if (existing) {
      return;
    }

    const sloth = agents.find((agent) => agent.state === 'idle');
    if (!sloth) {
      return;
    }

    const trendMeta = trendTasks.get(taskId);
    applyWorkingToSloth(sloth, taskId, trendMeta && trendMeta.keyword ? trendMeta.keyword : null);
  }

  function resolveTrendResultItems(resultPayload) {
    const directRanked = resultPayload
      && Array.isArray(resultPayload.ranked)
      ? resultPayload.ranked
      : null;
    if (directRanked) {
      return directRanked;
    }

    const nestedRanked = resultPayload
      && resultPayload.result
      && Array.isArray(resultPayload.result.ranked)
      ? resultPayload.result.ranked
      : null;
    if (nestedRanked) {
      return nestedRanked;
    }

    const directScored = resultPayload
      && Array.isArray(resultPayload.scored)
      ? resultPayload.scored
      : null;
    if (directScored) {
      return directScored;
    }

    const nestedScored = resultPayload
      && resultPayload.result
      && Array.isArray(resultPayload.result.scored)
      ? resultPayload.result.scored
      : null;
    if (nestedScored) {
      return nestedScored;
    }

    return [];
  }

  function handleTaskAcked(event) {
    const taskId = normalizeTaskId(event.taskId);
    if (!taskId || !trendTasks.has(taskId)) {
      return;
    }

    const status = event && event.payload && typeof event.payload.status === 'string'
      ? event.payload.status
      : null;

    const sloth = agents.find((agent) => agent.state === 'working' && normalizeTaskId(agent.requestId) === taskId);

    if (status === 'failed') {
      if (sloth) {
        applyFailedToSloth(sloth);
      }
      trendTasks.delete(taskId);
      return;
    }
  }

  function handleTrendResearchCompleted(event) {
    const payload = event && event.payload && typeof event.payload === 'object' ? event.payload : {};
    const requestId = normalizeTaskId(payload.requestId || payload.taskId || event.taskId);
    if (!requestId) {
      return;
    }

    const tracked = trendTasks.has(requestId);
    const trendMeta = tracked ? trendTasks.get(requestId) : null;
    const resultSource = (payload.result && typeof payload.result === 'object')
      ? payload.result
      : Array.isArray(payload.trendResult)
        ? { ranked: payload.trendResult }
        : (payload.trendResult && typeof payload.trendResult === 'object' ? payload.trendResult : null);
    const trendResult = resolveTrendResultItems(resultSource);
    if (!hasValidTrendResults(trendResult)) {
      return;
    }

    const keyword = typeof payload.keyword === 'string' && payload.keyword.trim()
      ? payload.keyword.trim()
      : (trendMeta && trendMeta.keyword ? trendMeta.keyword : null);

    console.log('[TrendResearchUI] TREND_RESEARCH_COMPLETED received', {
      requestId,
      tracked,
      keyword,
      resultCount: Array.isArray(trendResult) ? trendResult.length : 0,
      visible: hasValidTrendResults(trendResult)
    });

    trendTasks.set(requestId, {
      keyword,
      trendResult
    });

    const sloth = agents.find((agent) => normalizeTaskId(agent.requestId) === requestId)
      || agents.find((agent) => agent.state === 'idle')
      || agents[0];
    if (!sloth) {
      return;
    }

    applyCompletedToSloth(sloth, requestId, keyword, trendResult);
    trendTasks.delete(requestId);
  }

  subscribeEventStream((events) => {
    const stream = Array.isArray(events) ? events : [];
    for (const event of stream) {
      if (!event || typeof event.type !== 'string') {
        continue;
      }
      if (event.type === 'TASK_CREATED') {
        handleTaskCreated(event);
      } else if (event.type === 'TASK_CLAIMED') {
        handleTaskClaimed(event);
      } else if (event.type === 'TASK_ACKED') {
        handleTaskAcked(event);
      } else if (event.type === 'TREND_RESEARCH_COMPLETED') {
        handleTrendResearchCompleted(event);
      }
    }

    if (DEBUG_AGENT) {
      console.log('[agent] trend tasks tracked', trendTasks.size);
    }
  });
}
