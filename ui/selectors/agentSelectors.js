import { getTaskIds, getTaskSnapshot, getTaskStatus } from './taskSelectors.js';

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

function resolveTrendAgentId(payload, taskSnapshot) {
  const payloadAgentId = normalizeWorkerId(payload && (payload.assignedAgentId || payload.workerId || payload.agentId));
  if (payloadAgentId) {
    return payloadAgentId;
  }

  const taskSnapshotAgentId = normalizeWorkerId(taskSnapshot && taskSnapshot.assignedAgentId);
  if (taskSnapshotAgentId) {
    return taskSnapshotAgentId;
  }

  return null;
}

function buildTrendPanelsByAgent(indexedWorld) {
  if (!indexedWorld || !(indexedWorld.eventsByTaskId instanceof Map)) {
    return new Map();
  }

  const panelByAgentAndTask = new Map();

  for (const [taskId, events] of indexedWorld.eventsByTaskId.entries()) {
    const snapshot = getTaskSnapshot(indexedWorld, taskId);
    if (snapshot && snapshot.type !== 'TREND_RESEARCH' && snapshot.type !== 'unknown') {
      continue;
    }

    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      if (!event || event.type !== 'TREND_RESEARCH_COMPLETED') {
        continue;
      }

      const payload = event && typeof event.payload === 'object' ? event.payload : {};
      const resultPayload = resolveTrendResultPayload(payload);
      const trendResult = normalizeTrendResultItems(resultPayload);
      if (!hasValidTrendResultItems(trendResult)) {
        continue;
      }

      const agentId = resolveTrendAgentId(payload, snapshot);
      if (!agentId) {
        continue;
      }

      const normalizedTaskId = normalizeWorkerId(taskId);
      const panelKey = `${agentId}:${normalizedTaskId}`;
      const timestamp = Number.isFinite(event && event.timestamp) ? Number(event.timestamp) : 0;
      const normalizedResults = normalizeTrendPanelResults(trendResult);

      if (!panelByAgentAndTask.has(panelKey)) {
        panelByAgentAndTask.set(panelKey, {
          taskId: normalizedTaskId,
          agentId,
          createdAt: timestamp,
          lastUpdated: timestamp,
          keyword: typeof payload.keyword === 'string' ? payload.keyword : null,
          results: []
        });
      }

      const panelState = panelByAgentAndTask.get(panelKey);
      panelState.results.push(...normalizedResults);
      panelState.lastUpdated = timestamp;
      if (typeof payload.keyword === 'string' && payload.keyword) {
        panelState.keyword = payload.keyword;
      }
    }
  }

  const latestPanelByAgent = new Map();
  for (const panelState of panelByAgentAndTask.values()) {
    if (!panelState || !panelState.agentId || panelState.results.length === 0) {
      continue;
    }

    const existing = latestPanelByAgent.get(panelState.agentId);
    if (!existing || panelState.lastUpdated >= existing.lastUpdated) {
      latestPanelByAgent.set(panelState.agentId, panelState);
    }
  }

  return latestPanelByAgent;
}

function buildTrendPanelState(indexedWorld, workerId, trendPanelsByAgent) {
  const id = normalizeWorkerId(workerId);
  if (!id || !(trendPanelsByAgent instanceof Map)) {
    return null;
  }

  const panelState = trendPanelsByAgent.get(id);
  if (!panelState) {
    return null;
  }

  const derivedPanel = {
    taskId: panelState.taskId,
    agentId: id,
    createdAt: panelState.createdAt,
    lastUpdated: panelState.lastUpdated,
    keyword: panelState.keyword || null,
    results: Array.isArray(panelState.results) ? panelState.results : []
  };

  if (TREND_UI_DEBUG) {
    console.log('[TrendResearchUI][selector] trend panel state', {
      workerId: id,
      taskId: derivedPanel.taskId,
      resultCount: derivedPanel.results.length
    });
  }

  return derivedPanel;
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

  const tasks = getAgentTasks(indexedWorld, id);
  const state = getAgentState(indexedWorld, id);

  // Walk the task list newest-first and find the most recent task that is still
  // active (i.e. TASK_CLAIMED has fired but TASK_ACKED has not yet fired for it).
  //
  // Active statuses set by getTaskStatus via TASK_CLAIMED / TASK_EXECUTE_STARTED /
  // TASK_EXECUTE_FINISHED:   'claimed' | 'executing' | 'awaiting_ack'
  //
  // Terminal statuses set by TASK_ACKED:   'completed' | 'failed'
  //
  // currentTaskId returns to null as soon as TASK_ACKED is observed by getTaskStatus.
  // No raw event payload is inspected here — all status logic lives in taskSelectors.
  let currentTaskId = null;
  for (let i = tasks.length - 1; i >= 0; i--) {
    const status = getTaskStatus(indexedWorld, tasks[i]);
    if (status === 'claimed' || status === 'executing' || status === 'awaiting_ack') {
      currentTaskId = tasks[i];
      break;
    }
    // Terminal — this task is done; no point searching further back.
    if (status === 'completed' || status === 'failed') {
      break;
    }
    // 'created', 'queued', 'unknown' — task exists but is not yet assigned to this
    // agent; keep searching in case an earlier claimed task is still in flight.
  }

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

  const trendPanelsByAgent = options && options.trendPanelsByAgent instanceof Map
    ? options.trendPanelsByAgent
    : buildTrendPanelsByAgent(indexedWorld);

  return {
    id,
    role: 'operator',
    state,
    currentTaskId,
    deskId,
    targetDeskId: deskId,
    trendPanelState: buildTrendPanelState(indexedWorld, id, trendPanelsByAgent),
    uiAssets: []
  };
}

export function getAllAgents(indexedWorld) {
  const agentIds = getAllAgentIds(indexedWorld);
  const trendPanelsByAgent = buildTrendPanelsByAgent(indexedWorld);

  return agentIds
    .map((workerId) => getAgentSnapshot(indexedWorld, workerId, { trendPanelsByAgent }))
    .filter(Boolean);
}
