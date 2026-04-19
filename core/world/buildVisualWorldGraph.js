import {
  getAllTasks,
  getAllDesks,
  getTaskOfficeRoute,
  getTaskVisualTarget,
  getTaskTransitionTimestamps,
  getOfficeLayoutSnapshot,
  getTaskStatus
} from '../../ui/selectors/taskSelectors.js';
import { isActiveTaskStatus } from '../../ui/selectors/taskSelectors.js';
import { getAllAgents } from '../../ui/selectors/agentSelectors.js';
import { getTaskCounts } from '../../ui/selectors/metricsSelectors.js';
import { getIncidentClusters } from '../../ui/selectors/anomalySelectors.js';

export function buildVisualWorldGraph(worldState, { now }) {
  const desks = getAllDesks(worldState);
  const tasks = getAllTasks(worldState);
  const deskCount = desks.length || 1;

  const taskEntities = tasks.map((t) => {
    const visualState = getTaskStatus(worldState, t.id);
    return {
      id: t.id,
      type: 'task',
      ref: t.id,
      visualState,
      isActive: isActiveTaskStatus(visualState)
    };
  });

  return {
    entities: taskEntities,
    tasks,
    desks,
    agents: getAllAgents(worldState),
    counts: getTaskCounts(worldState),
    incidents: getIncidentClusters(worldState, { now, includeSystemEvents: false }),
    officeLayout: getOfficeLayoutSnapshot(),
    transitionByTaskId: new Map(tasks.map((t) => [t.id, getTaskTransitionTimestamps(worldState, t.id)])),
    taskRouteByTaskId: new Map(tasks.map((t) => [t.id, getTaskOfficeRoute(t, { deskCount })])),
    taskVisualTargetByTaskId: new Map(tasks.map((t) => [t.id, getTaskVisualTarget(t, { deskCount })]))
  };
}
