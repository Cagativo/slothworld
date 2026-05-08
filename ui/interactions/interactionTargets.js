/**
 * Priority-based interaction targets for the projected Slothworld scene.
 *
 * Targets are built from selector-safe render component descriptors and
 * workstation interaction metadata. No raw event data belongs here.
 */

import { pointInShape, scaleShape } from '../hotspots/hotspotGeometry.js';
import { buildAgentInspectionViewModel } from '../selectors/agentInspectionSelectors.js';

export const INTERACTION_PRIORITIES = Object.freeze({
  taskResult: 100,
  taskMarker: 90,
  agent: 70,
  station: 40,
});

const TASK_MARKER_SIZE = Object.freeze({ width: 36, height: 16 });
const COMPACT_RESULT_SIZE = Object.freeze({ width: 44, height: 22 });
const AGENT_FALLBACK_BOUNDS = Object.freeze({ width: 64, height: 54, dx: 0, dy: 0 });
const AGENT_DESK_BOUNDS = Object.freeze({
  'desk-0': Object.freeze({ width: 180, height: 170, dx: 0,  dy: 0 }),
  'desk-1': Object.freeze({ width: 300, height: 150, dx: 0,  dy: 0 }),
  'desk-2': Object.freeze({ width: 300, height: 150, dx: 0,  dy: 0 }),
  'desk-3': Object.freeze({ width: 200, height: 175, dx: 0,  dy: 0 }),
  'desk-4': Object.freeze({ width: 300, height: 150, dx: 14, dy: 0 }),
  'desk-5': Object.freeze({ width: 300, height: 150, dx: 14, dy: 0 }),
});

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function posOf(component, entityPositions) {
  const fromMap = entityPositions && component?.id ? entityPositions.get(component.id) : null;
  if (Number.isFinite(fromMap?.x) && Number.isFinite(fromMap?.y)) return fromMap;
  return { x: finite(component?.x), y: finite(component?.y) };
}

function rect(x, y, width, height) {
  return { type: 'rect', x, y, width: Math.max(0, width), height: Math.max(0, height) };
}

function taskMarkerViewModel(component) {
  const state = typeof component?.visualState === 'string' ? component.visualState : 'unknown';
  const title = typeof component?.title === 'string' && component.title.trim()
    ? component.title.trim()
    : 'Task';
  return Object.freeze({
    title: 'Task',
    lines: Object.freeze([
      title,
      state === 'error' ? 'Needs attention' : state === 'processing' ? 'Processing' : state === 'working' ? 'Active' : 'Waiting',
    ]),
    tone: state === 'error' ? 'warning' : 'task',
  });
}

function taskResultViewModel(component) {
  const panel = component?.trendPanelState && typeof component.trendPanelState === 'object'
    ? component.trendPanelState
    : {};
  const keyword = typeof panel.keyword === 'string' && panel.keyword.trim() ? panel.keyword.trim() : 'result';
  const results = Array.isArray(panel.results) ? panel.results : [];
  const lines = results
    .map((entry) => {
      if (entry && typeof entry === 'object') return typeof entry.item === 'string' ? entry.item : '';
      return typeof entry === 'string' ? entry : '';
    })
    .filter(Boolean)
    .slice(-3);
  if (lines.length === 0) lines.push(panel.status === 'working' ? 'Scan in progress' : 'Result ready');
  return Object.freeze({
    title: 'Task Result',
    lines: Object.freeze([`Trend: ${keyword}`, ...lines].slice(0, 3)),
    tone: 'result',
  });
}

function target(id, type, priority, hitArea, label, viewModel, source) {
  return Object.freeze({ id, type, priority, hitArea, label, viewModel, source });
}

function taskMarkerTarget(component, entityPositions) {
  const p = posOf(component, entityPositions);
  return target(
    `taskMarker:${component.id}`,
    'taskMarker',
    INTERACTION_PRIORITIES.taskMarker,
    rect(p.x - TASK_MARKER_SIZE.width / 2, p.y - TASK_MARKER_SIZE.height / 2, TASK_MARKER_SIZE.width, TASK_MARKER_SIZE.height),
    'Task',
    taskMarkerViewModel(component),
    component
  );
}

function taskResultTarget(component, entityPositions) {
  const panel = component?.trendPanelState && typeof component.trendPanelState === 'object' ? component.trendPanelState : null;
  if (!panel) return null;
  const p = posOf(component, entityPositions);
  return target(
    `taskResult:${panel.taskId || component.id}`,
    'taskResult',
    INTERACTION_PRIORITIES.taskResult,
    rect(p.x - COMPACT_RESULT_SIZE.width / 2, p.y - 48, COMPACT_RESULT_SIZE.width, COMPACT_RESULT_SIZE.height),
    'Task Result',
    taskResultViewModel(component),
    component
  );
}

function stationOwnsTrendResult(stationComponents, taskId) {
  if (!taskId || !Array.isArray(stationComponents)) return false;
  return stationComponents.some((component) => {
    const snapshot = component?.stationSnapshot;
    return component?.id === 'researchMonitorHotspot'
      && snapshot?.trendResult
      && snapshot.trendResult.taskId === taskId;
  });
}

function validAgentInspectionViewModel(model) {
  return Boolean(model
    && typeof model === 'object'
    && typeof model.title === 'string'
    && typeof model.statusLabel === 'string'
    && Array.isArray(model.lines));
}

function agentTarget(component, entityPositions, viewModel = buildAgentInspectionViewModel(component)) {
  const p = posOf(component, entityPositions);
  const b = AGENT_DESK_BOUNDS[component?.deskId] || AGENT_FALLBACK_BOUNDS;
  return target(
    `agent:${component.id}`,
    'agent',
    INTERACTION_PRIORITIES.agent,
    rect(p.x - b.width / 2 + b.dx, p.y - b.height / 2 + b.dy, b.width, b.height),
    'Agent',
    viewModel,
    component
  );
}

function stationTarget(hotspot, component, canvasSize) {
  const hitArea = scaleShape(hotspot.hitArea || { type: 'rect', ...hotspot.bounds }, canvasSize);
  return target(
    `station:${hotspot.id}`,
    'station',
    INTERACTION_PRIORITIES.station,
    hitArea,
    hotspot.title || hotspot.label || 'Station',
    component?.inspectionViewModel || component?.popoverViewModel || null,
    { hotspot, component }
  );
}

function isInteractiveAgent(component, debug) {
  if (debug) return true;
  const viewModel = component?.agentInspectionViewModel || buildAgentInspectionViewModel(component);
  return component?.normalInteractive === true && validAgentInspectionViewModel(viewModel);
}

export function buildInteractionTargets(components, options = {}) {
  const safeComponents = Array.isArray(components) ? components : [];
  const targets = [];
  const entityPositions = options.entityPositions || null;
  const debug = options.debug === true;
  const stationComponents = Array.isArray(options.stationComponents) ? options.stationComponents : [];

  for (const component of safeComponents) {
    if (!component || component.componentType !== 'agent-sprite') continue;
    const panelTaskId = typeof component.trendPanelState?.taskId === 'string'
      ? component.trendPanelState.taskId
      : null;
    if (stationOwnsTrendResult(stationComponents, panelTaskId)) continue;
    const result = taskResultTarget(component, entityPositions);
    if (result) targets.push(result);
  }

  for (const component of safeComponents) {
    if (component?.componentType === 'task-chip') targets.push(taskMarkerTarget(component, entityPositions));
  }

  for (const component of safeComponents) {
    if (component?.componentType === 'agent-sprite' && isInteractiveAgent(component, debug)) {
      targets.push(agentTarget(component, entityPositions, component.agentInspectionViewModel || buildAgentInspectionViewModel(component)));
    }
  }

  const hotspots = Array.isArray(options.hotspots) ? options.hotspots : [];
  const stationById = new Map(stationComponents.map((component) => [component.id, component]));
  for (const hotspot of hotspots) {
    if (hotspot?.id) targets.push(stationTarget(hotspot, stationById.get(hotspot.id), options.canvasSize));
  }

  return Object.freeze(targets);
}

export function getInteractionTargetAtPoint(targets, point) {
  if (!Array.isArray(targets) || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  return targets
    .filter((candidate) => candidate?.hitArea && pointInShape(point, candidate.hitArea))
    .sort((a, b) => b.priority - a.priority)
    [0] || null;
}
