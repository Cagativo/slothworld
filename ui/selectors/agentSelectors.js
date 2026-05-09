import { getTaskSnapshot, getTaskStatus } from './taskSelectors.js';

const TREND_UI_DEBUG = false;

function normalizeWorkerId(workerId) {
  return workerId === null || workerId === undefined ? null : String(workerId);
}

function eventTaskId(event) {
  if (!event || typeof event !== 'object') {
    return null;
  }

  const payload = event && typeof event.payload === 'object' ? event.payload : {};
  return (event.taskId !== undefined && event.taskId !== null)
    ? String(event.taskId)
    : (payload.taskId !== undefined && payload.taskId !== null)
      ? String(payload.taskId)
      : null;
}

function resolveCurrentTaskId(indexedWorld, workerId) {
  if (!indexedWorld || !(indexedWorld.eventsByWorkerId instanceof Map)) {
    return null;
  }

  const workerEvents = indexedWorld.eventsByWorkerId.get(workerId) || [];
  for (let i = workerEvents.length - 1; i >= 0; i -= 1) {
    const event = workerEvents[i];
    if (!event || event.type !== 'TASK_CLAIMED') {
      continue;
    }

    const taskId = eventTaskId(event);
    if (taskId) {
      return taskId;
    }
  }

  return null;
}

function normalizeTrendResultItems(resultPayload) {
  const directRanked = resultPayload && Array.isArray(resultPayload.ranked) ? resultPayload.ranked : null;
  if (directRanked) {
    return directRanked;
  }

  const nestedRanked = resultPayload && resultPayload.result && Array.isArray(resultPayload.result.ranked)
    ? resultPayload.result.ranked
    : null;
  if (nestedRanked) {
    return nestedRanked;
  }

  const directScored = resultPayload && Array.isArray(resultPayload.scored) ? resultPayload.scored : null;
  if (directScored) {
    return directScored;
  }

  const nestedScored = resultPayload && resultPayload.result && Array.isArray(resultPayload.result.scored)
    ? resultPayload.result.scored
    : null;
  if (nestedScored) {
    return nestedScored;
  }

  return [];
}

function hasValidTrendResultItems(items) {
  return Array.isArray(items) && items.some((entry) => {
    if (typeof entry === 'string') {
      return entry.trim().length > 0;
    }

    if (entry && typeof entry === 'object' && typeof entry.item === 'string') {
      return entry.item.trim().length > 0;
    }

    return false;
  });
}

function normalizeTrendPanelResults(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((entry) => {
      if (entry && typeof entry === 'object') {
        return {
          item: typeof entry.item === 'string' ? entry.item.trim() : '',
          score: Number.isFinite(entry.score) ? Number(entry.score) : null
        };
      }

      if (typeof entry === 'string') {
        return {
          item: entry.trim(),
          score: null
        };
      }

      return {
        item: '',
        score: null
      };
    })
    .filter((entry) => entry.item.length > 0);
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter(Boolean)
    : [];
}

function normalizeTrendAnalysis(analysis) {
  if (!analysis || typeof analysis !== 'object') {
    return null;
  }

  const summary = typeof analysis.summary === 'string' ? analysis.summary.trim() : '';
  const recommendation = typeof analysis.recommendation === 'string' ? analysis.recommendation.trim() : '';
  const opportunities = normalizeStringArray(analysis.opportunities);
  const risks = normalizeStringArray(analysis.risks);
  const audienceSignals = normalizeStringArray(analysis.audienceSignals);
  const contentAngles = normalizeStringArray(analysis.contentAngles);

  if (!summary && !recommendation && opportunities.length === 0 && risks.length === 0) {
    return null;
  }

  return {
    summary,
    recommendation,
    opportunities,
    risks,
    audienceSignals,
    contentAngles,
    confidence: Number.isFinite(analysis.confidence)
      ? Number(analysis.confidence)
      : (typeof analysis.confidence === 'string' && analysis.confidence.trim()
          ? analysis.confidence.trim().toLowerCase()
          : null),
    provider: typeof analysis.provider === 'string' && analysis.provider.trim() ? analysis.provider.trim() : null,
    model: typeof analysis.model === 'string' && analysis.model.trim() ? analysis.model.trim() : null
  };
}

function resolveTrendResultPayload(payload) {
  if (payload && payload.result && typeof payload.result === 'object') {
    return payload.result;
  }

  if (payload && Array.isArray(payload.trendResult)) {
    return { ranked: payload.trendResult };
  }

  if (payload && payload.trendResult && typeof payload.trendResult === 'object') {
    return payload.trendResult;
  }

  return null;
}

function resolveLatestTrendAnalysis(taskEvents, agentId) {
  for (let i = taskEvents.length - 1; i >= 0; i -= 1) {
    const event = taskEvents[i];
    if (!event || event.type !== 'TREND_RESEARCH_COMPLETED') {
      continue;
    }

    const payload = event && typeof event.payload === 'object' ? event.payload : {};
    const payloadAgentId = normalizeWorkerId(payload.assignedAgentId || payload.workerId || payload.agentId);
    if (payloadAgentId && payloadAgentId !== agentId) {
      continue;
    }

    const resultPayload = resolveTrendResultPayload(payload);
    const analysis = normalizeTrendAnalysis(resultPayload && resultPayload.analysis);
    if (analysis) {
      return analysis;
    }
  }

  return null;
}

export function resolveTrendResultItems(events) {
  const stream = Array.isArray(events) ? events : [];
  const results = [];

  for (const event of stream) {
    if (!event || event.type !== 'TREND_RESEARCH_COMPLETED') {
      continue;
    }

    const payload = event && typeof event.payload === 'object' ? event.payload : {};
    const resultPayload = resolveTrendResultPayload(payload);
    const trendResult = normalizeTrendResultItems(resultPayload);
    if (!hasValidTrendResultItems(trendResult)) {
      continue;
    }

    results.push(...normalizeTrendPanelResults(trendResult));
  }

  return results;
}

export function getAgentTrendPanelState(indexedWorld, agentId) {
  const id = normalizeWorkerId(agentId);
  if (!id) {
    return {
      taskId: null,
      keyword: null,
      results: []
    };
  }

  if (!indexedWorld || !(indexedWorld.eventsByTaskId instanceof Map) || !(indexedWorld.eventsByWorkerId instanceof Map)) {
    return {
      taskId: null,
      keyword: null,
      results: []
    };
  }

  const workerEvents = indexedWorld.eventsByWorkerId.get(id) || [];
  let taskId = null;

  for (let i = workerEvents.length - 1; i >= 0; i -= 1) {
    const event = workerEvents[i];
    if (!event || event.type !== 'TREND_RESEARCH_COMPLETED') {
      continue;
    }

    const completedTaskId = eventTaskId(event);
    if (completedTaskId) {
      taskId = completedTaskId;
      break;
    }
  }

  if (!taskId) {
    taskId = resolveCurrentTaskId(indexedWorld, id);
  }

  if (!taskId) {
    return {
      taskId: null,
      keyword: null,
      results: []
    };
  }

  const taskEvents = indexedWorld.eventsByTaskId.get(taskId) || [];
  let keyword = null;
  let lastUpdated = null;

  for (let i = taskEvents.length - 1; i >= 0; i -= 1) {
    const event = taskEvents[i];
    if (!event || event.type !== 'TREND_RESEARCH_COMPLETED') {
      continue;
    }

    const payload = event && typeof event.payload === 'object' ? event.payload : {};
    const payloadAgentId = normalizeWorkerId(payload.assignedAgentId || payload.workerId || payload.agentId);
    if (payloadAgentId && payloadAgentId !== id) {
      continue;
    }

    if (typeof payload.keyword === 'string' && payload.keyword.trim()) {
      keyword = payload.keyword.trim();
      if (lastUpdated === null && Number.isFinite(event.timestamp)) {
        lastUpdated = Number(event.timestamp);
      }
      break;
    }
  }

  const results = resolveTrendResultItems(taskEvents);
  const analysis = resolveLatestTrendAnalysis(taskEvents, id);

  if (lastUpdated === null) {
    for (let i = taskEvents.length - 1; i >= 0; i -= 1) {
      const event = taskEvents[i];
      if (event && event.type === 'TREND_RESEARCH_COMPLETED' && Number.isFinite(event.timestamp)) {
        lastUpdated = Number(event.timestamp);
        break;
      }
    }
  }

  if (TREND_UI_DEBUG) {
    console.log('[TrendResearchUI][selector] trend panel state', {
      workerId: id,
      taskId,
      resultCount: results.length
    });
  }

  return {
    taskId,
    keyword,
    results,
    analysis,
    lastUpdated,
    agentId: id
  };
}

export function getAgentTasks(indexedWorld, workerId) {
  const id = normalizeWorkerId(workerId);
  if (!id || !indexedWorld || !(indexedWorld.eventsByWorkerId instanceof Map)) {
    return [];
  }

  const workerEvents = indexedWorld.eventsByWorkerId.get(id) || [];
  const orderedTaskIds = [];
  const seen = new Set();

  for (const event of workerEvents) {
    const taskId = eventTaskId(event);
    if (!taskId || seen.has(taskId)) {
      continue;
    }
    seen.add(taskId);
    orderedTaskIds.push(taskId);
  }

  return orderedTaskIds;
}

export function getAgentState(indexedWorld, workerId) {
  const taskIds = getAgentTasks(indexedWorld, workerId);
  let state = 'idle';

  for (const taskId of taskIds) {
    const status = getTaskStatus(indexedWorld, taskId);

    if (status === 'claimed') {
      state = 'moving';
      continue;
    }

    if (status === 'executing') {
      state = 'working';
      continue;
    }

    if (status === 'awaiting_ack') {
      state = 'delivering';
      continue;
    }

    if (status === 'failed') {
      state = 'error';
    }
  }

  return state;
}

export function getAllAgentIds(indexedWorld) {
  if (!indexedWorld || !(indexedWorld.eventsByWorkerId instanceof Map)) {
    return [];
  }

  return Array.from(indexedWorld.eventsByWorkerId.keys())
    .map((value) => String(value))
    .sort((a, b) => a.localeCompare(b));
}

export function getAgentSnapshot(indexedWorld, workerId, options = {}) {
  const id = normalizeWorkerId(workerId);
  if (!id) {
    return null;
  }

  void options;
  const state = getAgentState(indexedWorld, id);
  const currentTaskId = resolveCurrentTaskId(indexedWorld, id);

  const currentTask = currentTaskId ? getTaskSnapshot(indexedWorld, currentTaskId) : null;
  const taskDeskId = currentTask && currentTask.deskId ? currentTask.deskId : null;

  // Fall back to the desk registered at agent spawn (AGENT_ASSIGNED_IDLE) when
  // the agent has no active task. Mirrors core/world/agentSelectors.js which reads
  // the same event. Without this, idle agents resolve to deskId=null, causing the
  // position map to fall through to {x:0, y:0} and draw sprites at the canvas origin.
  let registeredDeskId = null;
  if (!taskDeskId) {
    const workerEvents = (indexedWorld.eventsByWorkerId instanceof Map)
      ? (indexedWorld.eventsByWorkerId.get(id) || [])
      : [];
    for (const evt of workerEvents) {
      if (evt && evt.type === 'AGENT_ASSIGNED_IDLE' &&
          evt.payload && evt.payload.deskId != null) {
        registeredDeskId = String(evt.payload.deskId);
        break;
      }
    }
  }

  const deskId = taskDeskId || registeredDeskId;

  return {
    id,
    role: 'operator',
    state,
    currentTaskId,
    deskId,
    targetDeskId: deskId,
    trendPanelState: getAgentTrendPanelState(indexedWorld, id),
    uiAssets: []
  };
}

export function getAllAgents(indexedWorld) {
  const agentIds = getAllAgentIds(indexedWorld);

  return agentIds
    .map((workerId) => getAgentSnapshot(indexedWorld, workerId))
    .filter(Boolean);
}
