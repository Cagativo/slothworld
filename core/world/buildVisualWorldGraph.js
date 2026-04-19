/**
 * buildVisualWorldGraph
 *
 * Accepts pre-computed selector output and returns the graph structure
 * that the rendering layer will project onto the canvas.
 *
 * Contract:
 *  - input MUST be selector output only; no raw world state or event arrays
 *  - no interpretation of input is performed here
 *  - returns a stable graph shape every time
 *
 * Expected input shape:
 *  {
 *    tasks:       Array<taskSelectors.getTaskSnapshot>                    — result of getAllTasks()
 *    transitions: Map<taskId, taskSelectors.getTaskTransitionTimestamps>  — or plain object keyed by taskId
 *    agents:      Array<agentSelectors.getAgentSnapshot>                  — result of getAllAgents() (optional)
 *    metrics:     Map<taskId, { queueTime, duration, ackLatency }>          — pre-computed metricsSelectors output (optional)
 *    incidents:     Array<anomalySelectors.getIncidentClusters>                 — pre-computed cluster list (optional)
 *    systemEvents:  Map<taskId, Array<systemEvent>> | Object                    — pre-computed system events per task (optional)
 *  }
 *
 * Second argument (options):
 *  {
 *    observability: boolean  — when true, the output includes the observability overlay (default: false)
 *  }
 *
 * metrics and incidents are attached as visualization metadata only; no interpretation is performed.
 * The observability overlay never alters nodes or edges; it is a separate, toggleable output field.
 */

/**
 * Ordered lifecycle steps that can produce an edge.
 * A step is emitted only when both selector-provided timestamps are non-null,
 * meaning the selector confirmed the transition occurred.
 * No event scanning or inference is performed here.
 */
const LIFECYCLE_STEPS = [
  { from: 'CREATED',  to: 'ENQUEUED', fromKey: 'createdAt',     toKey: 'queuedAt'    },
  { from: 'ENQUEUED', to: 'CLAIMED',  fromKey: 'queuedAt',      toKey: 'claimedAt'   },
  { from: 'CLAIMED',  to: 'EXECUTED', fromKey: 'claimedAt',     toKey: 'executingAt' },
  { from: 'EXECUTED', to: 'ACKED',    fromKey: 'awaitingAckAt', toKey: 'ackedAt'     }
];

export function buildVisualWorldGraph(input, options) {
  const tasks        = (input && Array.isArray(input.tasks))      ? input.tasks      : [];
  const transitions  = (input && input.transitions)               ? input.transitions : {};
  const agents       = (input && Array.isArray(input.agents))     ? input.agents     : [];
  const metrics      = (input && input.metrics)                   ? input.metrics    : {};
  const incidents    = (input && Array.isArray(input.incidents))  ? input.incidents  : [];
  const systemEvents = (input && input.systemEvents)              ? input.systemEvents : {};
  const withOverlay  = !!(options && options.observability);

  // Reverse index: taskId → array of { clusterType, severity } references.
  // Built once from selector output; no clustering logic is applied here.
  const incidentsByTaskId = new Map();
  for (const cluster of incidents) {
    if (!Array.isArray(cluster.taskIds)) { continue; }
    for (const taskId of cluster.taskIds) {
      if (!incidentsByTaskId.has(taskId)) { incidentsByTaskId.set(taskId, []); }
      incidentsByTaskId.get(taskId).push({ clusterType: cluster.type, severity: cluster.severity });
    }
  }

  const nodes = tasks.map((task) => {
    const m = (metrics instanceof Map) ? metrics.get(task.id) : metrics[task.id];
    return {
      id: task.id,
      type: 'task',
      status: task.status,
      metadata: {
        title: task.title,
        taskType: task.type,
        assignedAgentId: task.assignedAgentId,
        deskId: task.deskId,
        error: task.error,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        queueTime:   (m && m.queueTime   != null) ? m.queueTime   : null,
        duration:    (m && m.duration    != null) ? m.duration    : null,
        ackLatency:  (m && m.ackLatency  != null) ? m.ackLatency  : null,
        incidents:   incidentsByTaskId.get(task.id) || []
      }
    };
  });

  // Worker nodes — one per agent snapshot provided by agentSelectors.
  for (const agent of agents) {
    nodes.push({
      id: agent.id,
      type: 'worker',
      status: agent.state,
      metadata: {
        role: agent.role,
        currentTaskId: agent.currentTaskId,
        deskId: agent.deskId
      }
    });
  }

  const edges = [];
  for (const task of tasks) {
    const t = (transitions instanceof Map)
      ? transitions.get(task.id)
      : transitions[task.id];

    if (!t) {
      continue;
    }

    for (const step of LIFECYCLE_STEPS) {
      const fromAt = t[step.fromKey];
      const toAt   = t[step.toKey];
      if (fromAt == null || toAt == null) {
        continue;
      }
      edges.push({
        id:       `${task.id}:${step.from}->${step.to}`,
        taskId:   task.id,
        from:     step.from,
        to:       step.to,
        fromAt,
        toAt,
        incidents: incidentsByTaskId.get(task.id) || []
      });
    }
  }

  // Task → worker edges — derived solely from task.assignedAgentId (selector output).
  // Emitted only when the task snapshot confirms an assignment.
  const workerNodeIds = new Set(agents.map((a) => a.id));
  for (const task of tasks) {
    if (!task.assignedAgentId) {
      continue;
    }
    edges.push({
      id:       `${task.id}:ASSIGNED->${task.assignedAgentId}`,
      taskId:   task.id,
      workerId: task.assignedAgentId,
      from:     task.id,
      to:       task.assignedAgentId,
      type:     'assignment',
      // resolved indicates the worker node is present in this graph snapshot
      resolved:  workerNodeIds.has(task.assignedAgentId),
      incidents: incidentsByTaskId.get(task.id) || []
    });
  }

  // ── Observability overlay ────────────────────────────────────────────────
  // System events are passed in pre-computed by the caller.
  // The overlay is populated only when options.observability is true;
  // nodes and edges are identical in both modes.
  let observability;
  if (withOverlay) {
    const byTaskId = new Map();
    const source   = systemEvents instanceof Map
      ? systemEvents
      : new Map(Object.entries(systemEvents));
    for (const [taskId, events] of source) {
      if (Array.isArray(events) && events.length > 0) {
        byTaskId.set(taskId, events);
      }
    }
    observability = { enabled: true, byTaskId };
  } else {
    observability = { enabled: false, byTaskId: new Map() };
  }

  return {
    nodes,
    edges,
    metadata: {},
    observability
  };
}
