/**
 * Read-only workstation status snapshots.
 *
 * Input contract:
 * - selector-derived task snapshots (ui/selectors/taskSelectors.js)
 * - selector-derived agent snapshots (ui/selectors/agentSelectors.js)
 *
 * This module is pure projection logic: no raw event access, no side effects.
 */

import { placeEntityInWorldZone } from '../config/worldZoneMapper.js';

const STATION_DEFS = Object.freeze([
  Object.freeze({ stationId: 'engine_core', label: 'Engine Core' }),
  Object.freeze({ stationId: 'intake_desk', label: 'Intake Desk' }),
  Object.freeze({ stationId: 'research_desk', label: 'Research Desk' }),
  Object.freeze({ stationId: 'render_desk', label: 'Render Desk' }),
  Object.freeze({ stationId: 'shopify_desk', label: 'Shopify Desk' }),
  Object.freeze({ stationId: 'support_desk', label: 'Support Desk' }),
  Object.freeze({ stationId: 'approval_desk', label: 'Approval Desk' }),
  Object.freeze({ stationId: 'archive_shelf', label: 'Archive Shelf' }),
  Object.freeze({ stationId: 'anomaly_shelf', label: 'Anomaly Shelf' }),
]);

const ZONE_TO_STATION_ID = Object.freeze({
  engineCrystal: 'engine_core',
  intakeDesk: 'intake_desk',
  researchDesk: 'research_desk',
  renderDesk: 'render_desk',
  shopifyDesk: 'shopify_desk',
  supportDesk: 'support_desk',
  approvalDesk: 'approval_desk',
  archiveLibrary: 'archive_shelf',
  anomalyShelf: 'anomaly_shelf',
});

const CURRENT_STATUSES = new Set(['created', 'queued', 'claimed', 'executing', 'awaiting_ack']);
const DOMAIN_TASK_TYPE_TO_STATION = Object.freeze({
  TREND_RESEARCH: 'research_desk',
  image_render: 'render_desk',
  shopify: 'shopify_desk',
  discord: 'support_desk',
});

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeTimestamp(value) {
  return Number.isFinite(value) ? Number(value) : null;
}

function normalizeStatus(status) {
  if (typeof status !== 'string') return 'unknown';
  return status.trim().toLowerCase();
}

function titleCaseStatus(status) {
  if (status === 'awaiting_ack') return 'Awaiting Ack';
  return String(status || 'unknown')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function titleCaseTaskType(taskType) {
  return String(taskType || 'task')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function inferStationFromText(task) {
  const text = [task?.title, task?.type]
    .filter((value) => typeof value === 'string' && value.trim())
    .join(' ')
    .toLowerCase();

  if (text.includes('trend') || text.includes('research') || text.includes('scan')) return 'research_desk';
  if (text.includes('render') || text.includes('image') || text.includes('mockup') || text.includes('design')) return 'render_desk';
  if (text.includes('shopify') || text.includes('listing') || text.includes('product') || text.includes('publish')) return 'shopify_desk';
  if (text.includes('discord') || text.includes('support') || text.includes('message') || text.includes('reply')) return 'support_desk';
  if (text.includes('approval') || text.includes('review')) return 'approval_desk';
  return null;
}

function domainStationForTask(task) {
  const taskType = safeString(task?.type);
  if (taskType && DOMAIN_TASK_TYPE_TO_STATION[taskType]) {
    return DOMAIN_TASK_TYPE_TO_STATION[taskType];
  }
  return inferStationFromText(task);
}

function taskToStationId(task) {
  const status = normalizeStatus(task?.status);
  const taskType = safeString(task?.type);
  const placed = placeEntityInWorldZone({
    type: 'task',
    status,
    taskType,
  });

  const direct = placed && typeof placed.zoneId === 'string'
    ? ZONE_TO_STATION_ID[placed.zoneId] || null
    : null;

  if (direct && direct !== 'engine_core') {
    return direct;
  }

  const inferred = inferStationFromText(task);
  return inferred || direct || 'engine_core';
}

function toCurrentWorkItem(task) {
  const title = safeString(task?.title) || titleCaseTaskType(task?.type);
  const status = normalizeStatus(task?.status);
  return Object.freeze({
    title,
    status,
    summary: `${titleCaseStatus(status)} in progress`,
    taskId: safeString(task?.id),
    updatedAt: safeTimestamp(task?.updatedAt),
  });
}

function toResultModel(task) {
  const title = safeString(task?.title) || titleCaseTaskType(task?.type);
  const status = normalizeStatus(task?.status);
  return Object.freeze({
    title,
    status,
    summary: `${titleCaseStatus(status)} at ${title}`,
    taskId: safeString(task?.id),
    completedAt: safeTimestamp(task?.updatedAt),
  });
}

function toFailureModel(task) {
  const title = safeString(task?.title) || titleCaseTaskType(task?.type);
  const summary = safeString(task?.error) || 'Task failed';
  return Object.freeze({
    title,
    summary,
    taskId: safeString(task?.id),
  });
}

function normalizeTrendRows(results) {
  return safeArray(results)
    .map((entry) => {
      if (entry && typeof entry === 'object') {
        const item = safeString(entry.item);
        if (!item) return null;
        return Object.freeze({
          item,
          score: Number.isFinite(entry.score) ? Number(entry.score) : null,
        });
      }

      const item = safeString(entry);
      return item ? Object.freeze({ item, score: null }) : null;
    })
    .filter(Boolean);
}

function normalizeStringArray(value) {
  return safeArray(value)
    .map((entry) => safeString(entry))
    .filter(Boolean);
}

function normalizeTrendAnalysis(analysis) {
  if (!analysis || typeof analysis !== 'object') return null;

  const summary = safeString(analysis.summary);
  const recommendation = safeString(analysis.recommendation);
  const opportunities = normalizeStringArray(analysis.opportunities);
  const risks = normalizeStringArray(analysis.risks);
  const audienceSignals = normalizeStringArray(analysis.audienceSignals);
  const contentAngles = normalizeStringArray(analysis.contentAngles);

  if (!summary && !recommendation && opportunities.length === 0 && risks.length === 0) {
    return null;
  }

  return Object.freeze({
    summary,
    recommendation,
    opportunities: Object.freeze(opportunities),
    risks: Object.freeze(risks),
    audienceSignals: Object.freeze(audienceSignals),
    contentAngles: Object.freeze(contentAngles),
    confidence: Number.isFinite(analysis.confidence)
      ? Number(analysis.confidence)
      : (typeof analysis.confidence === 'string' && analysis.confidence.trim()
          ? analysis.confidence.trim().toLowerCase()
          : null),
    provider: safeString(analysis.provider),
    model: safeString(analysis.model),
    unavailable: analysis.unavailable === true,
    reason: safeString(analysis.reason),
  });
}

function buildTrendResultModel(agent, tasksById) {
  const panel = agent?.trendPanelState && typeof agent.trendPanelState === 'object'
    ? agent.trendPanelState
    : null;
  if (!panel) return null;

  const taskId = safeString(panel.taskId);
  const rows = normalizeTrendRows(panel.results);
  const analysis = normalizeTrendAnalysis(panel.analysis);
  if (!taskId || (rows.length === 0 && !analysis)) return null;

  const task = tasksById.get(taskId) || null;
  return Object.freeze({
    taskId,
    keyword: safeString(panel.keyword),
    status: normalizeStatus(panel.status || task?.status),
    updatedAt: safeTimestamp(panel.lastUpdated) ?? safeTimestamp(task?.updatedAt),
    analysis,
    rows: Object.freeze(rows.slice(0, 5)),
  });
}

function latestTrendResult(agents, tasksById) {
  const candidates = safeArray(agents)
    .map((agent) => buildTrendResultModel(agent, tasksById))
    .filter(Boolean)
    .sort((a, b) => {
      const at = safeTimestamp(a?.updatedAt) ?? -1;
      const bt = safeTimestamp(b?.updatedAt) ?? -1;
      if (at !== bt) return bt - at;
      return String(a?.taskId || '').localeCompare(String(b?.taskId || ''));
    });

  return candidates[0] || null;
}

function sortByUpdatedDesc(a, b) {
  const at = safeTimestamp(a?.updatedAt) ?? -1;
  const bt = safeTimestamp(b?.updatedAt) ?? -1;
  if (at !== bt) return bt - at;
  return String(a?.id || '').localeCompare(String(b?.id || ''));
}

function emptySnapshot(def) {
  return {
    stationId: def.stationId,
    label: def.label,
    currentWork: { count: 0, items: [] },
    lastResult: null,
    latestFailure: null,
    trendResult: null,
  };
}

function freezeSnapshot(snapshot) {
  return Object.freeze({
    stationId: snapshot.stationId,
    label: snapshot.label,
    currentWork: Object.freeze({
      count: snapshot.currentWork.count,
      items: Object.freeze(snapshot.currentWork.items.slice()),
    }),
    lastResult: snapshot.lastResult || null,
    latestFailure: snapshot.latestFailure || null,
    trendResult: snapshot.trendResult || null,
  });
}

/**
 * Build read-only station snapshots keyed by semantic station id.
 *
 * @param {{ tasks?: Array<object>, agents?: Array<object> }} input
 * @returns {Readonly<Record<string, {
 *   stationId: string,
 *   label: string,
 *   currentWork: { count: number, items: ReadonlyArray<object> },
 *   lastResult: { title: string, status: string, summary: string, taskId: string|null, completedAt: number|null } | null,
 *   latestFailure: { title: string, summary: string, taskId: string|null } | null,
 *   trendResult: { taskId: string, keyword: string|null, status: string, updatedAt: number|null, analysis: object|null, rows: ReadonlyArray<object> } | null,
 * }>>}
 */
export function buildWorkstationStatusSnapshots(input = {}) {
  const tasks = safeArray(input.tasks);
  const agents = safeArray(input.agents);

  const byStation = new Map();
  for (const def of STATION_DEFS) {
    byStation.set(def.stationId, emptySnapshot(def));
  }

  const tasksByStation = new Map();
  const tasksById = new Map();
  for (const task of tasks) {
    const taskId = safeString(task?.id);
    if (taskId) tasksById.set(taskId, task);
    const stationId = taskToStationId(task);
    if (!tasksByStation.has(stationId)) tasksByStation.set(stationId, []);
    tasksByStation.get(stationId).push(task);
  }

  const terminalByDomain = new Map();
  const failedByDomain = new Map();
  const completedGlobal = [];
  const failedGlobal = [];
  for (const task of tasks) {
    const status = normalizeStatus(task?.status);
    const domainStation = domainStationForTask(task);

    if (status === 'completed' || status === 'acknowledged' || status === 'acked' || status === 'done') {
      completedGlobal.push(task);
      if (domainStation) {
        if (!terminalByDomain.has(domainStation)) terminalByDomain.set(domainStation, []);
        terminalByDomain.get(domainStation).push(task);
      }
      continue;
    }

    if (status === 'failed') {
      failedGlobal.push(task);
      if (domainStation) {
        if (!terminalByDomain.has(domainStation)) terminalByDomain.set(domainStation, []);
        if (!failedByDomain.has(domainStation)) failedByDomain.set(domainStation, []);
        terminalByDomain.get(domainStation).push(task);
        failedByDomain.get(domainStation).push(task);
      }
    }
  }

  completedGlobal.sort(sortByUpdatedDesc);
  failedGlobal.sort(sortByUpdatedDesc);
  for (const [stationId, list] of terminalByDomain) {
    terminalByDomain.set(stationId, list.slice().sort(sortByUpdatedDesc));
  }
  for (const [stationId, list] of failedByDomain) {
    failedByDomain.set(stationId, list.slice().sort(sortByUpdatedDesc));
  }

  for (const def of STATION_DEFS) {
    const stationTasks = (tasksByStation.get(def.stationId) || []).slice().sort(sortByUpdatedDesc);
    const current = stationTasks.filter((task) => CURRENT_STATUSES.has(normalizeStatus(task?.status)));
    let terminal;
    let failed;

    if (def.stationId === 'archive_shelf') {
      terminal = completedGlobal;
      failed = [];
    } else if (def.stationId === 'anomaly_shelf') {
      terminal = failedGlobal;
      failed = failedGlobal;
    } else {
      terminal = terminalByDomain.get(def.stationId) || [];
      failed = failedByDomain.get(def.stationId) || [];
    }

    const snapshot = byStation.get(def.stationId);
    snapshot.currentWork = {
      count: current.length,
      items: current.slice(0, 3).map(toCurrentWorkItem),
    };
    snapshot.lastResult = terminal.length > 0 ? toResultModel(terminal[0]) : null;
    snapshot.latestFailure = failed.length > 0 ? toFailureModel(failed[0]) : null;
    if (def.stationId === 'research_desk') {
      snapshot.trendResult = latestTrendResult(agents, tasksById);
    }
  }

  const result = {};
  for (const def of STATION_DEFS) {
    result[def.stationId] = freezeSnapshot(byStation.get(def.stationId));
  }
  return Object.freeze(result);
}
