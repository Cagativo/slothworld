/**
 * 🚨 ARCHITECTURE LOCK
 *
 * UI module is read-only and selector-driven:
 * events -> deriveWorldState -> selectors -> rendering
 */

import { getGraphSnapshot } from './graph-snapshot.js';



const panelState = {
  selectedTaskId: null,
  selectedAgentId: null,
  selectedTimelineIndex: null,
  activeTasksOnly: false,
  recentSeconds: 0,
  maxEventRows: 100,
  createTaskPending: false,
  createTaskMessage: '',
  createTaskTone: ''
};

const NORMAL_AWAITING_ACK_STALE_MS = 2 * 60 * 1000;

function stringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (_error) {
    return String(value);
  }
}

function formatIso(timestamp) {
  if (!Number.isFinite(timestamp)) {
    return 'n/a';
  }
  return new Date(timestamp).toISOString();
}

function taskTone(status) {
  if (status === 'failed') {
    return 'failed';
  }
  if (status === 'awaiting_ack') {
    return 'pending';
  }
  if (status === 'claimed' || status === 'executing') {
    return 'active';
  }
  if (status === 'completed' || status === 'acknowledged') {
    return 'done';
  }
  return 'queued';
}

function taskIcon(status) {
  if (status === 'failed') {
    return '✖';
  }
  if (status === 'awaiting_ack') {
    return '⧗';
  }
  if (status === 'claimed') {
    return '➤';
  }
  if (status === 'executing') {
    return '⚙';
  }
  if (status === 'completed' || status === 'acknowledged') {
    return '✔';
  }
  return '•';
}

function formatTaskErrorMessage(taskType, rawError) {
  if (!rawError) {
    return null;
  }

  if (rawError.startsWith('provider_timeout:')) {
    const timeoutMs = rawError.split(':')[1] || 'unknown';
    return `provider timeout (${timeoutMs}ms)`;
  }

  if (rawError === 'openai_api_key_missing') {
    return 'OpenAI API key missing';
  }

  if (rawError === 'huggingface_api_key_missing') {
    return 'HuggingFace API key missing';
  }

  if (taskType === 'image_render') {
    return `image render failed: ${rawError}`;
  }

  return rawError;
}

function buildExecutionTrace(edges) {
  return (Array.isArray(edges) ? edges : []).map((edge) => ({
    from: edge.from,
    to: edge.to,
    fromAt: formatIso(edge.fromAt),
    toAt: formatIso(edge.toAt)
  }));
}

function isActiveNodeStatus(status) {
  return status === 'claimed' || status === 'executing' || status === 'awaiting_ack';
}

function bucketNodesByStatus(taskNodes) {
  const queued = [];
  const active = [];
  const done = [];
  const failed = [];
  for (const node of taskNodes) {
    const s = String(node.status || '').toLowerCase();
    if (s === 'failed' || s === 'error') {
      failed.push(node);
    } else if (s === 'completed' || s === 'acknowledged') {
      done.push(node);
    } else if (isActiveNodeStatus(s)) {
      active.push(node);
    } else {
      queued.push(node);
    }
  }
  return { queued, active, done, failed };
}

function getNodeTimestamp(node) {
  const meta = node && node.metadata && typeof node.metadata === 'object' ? node.metadata : {};
  const updatedAt = Number(meta.updatedAt);
  if (Number.isFinite(updatedAt) && updatedAt > 0) {
    return updatedAt;
  }
  const createdAt = Number(meta.createdAt);
  if (Number.isFinite(createdAt) && createdAt > 0) {
    return createdAt;
  }
  return 0;
}

function getTaskTitle(node) {
  const meta = node && node.metadata && typeof node.metadata === 'object' ? node.metadata : {};
  if (typeof meta.title === 'string' && meta.title.trim()) {
    return meta.title.trim();
  }
  return node && node.id ? String(node.id) : 'unknown task';
}

function buildActiveWorkModel(taskNodes, workerNodes) {
  const activeStatuses = new Set(['claimed', 'executing', 'awaiting_ack']);
  const activeTasks = (Array.isArray(taskNodes) ? taskNodes : [])
    .filter((node) => activeStatuses.has(String(node && node.status || '').toLowerCase()))
    .sort((a, b) => getNodeTimestamp(b) - getNodeTimestamp(a));

  const engagedWorkers = (Array.isArray(workerNodes) ? workerNodes : [])
    .filter((node) => {
      const meta = node && node.metadata && typeof node.metadata === 'object' ? node.metadata : {};
      return typeof meta.currentTaskId === 'string' && meta.currentTaskId.trim();
    });

  const rows = activeTasks.slice(0, 4).map((node) => {
    const meta = node && node.metadata && typeof node.metadata === 'object' ? node.metadata : {};
    return {
      id: node.id,
      title: getTaskTitle(node),
      status: String(node.status || 'unknown'),
      assignedAgentId: meta.assignedAgentId || null
    };
  });

  return {
    count: activeTasks.length,
    engagedAgents: engagedWorkers.length,
    rows
  };
}

function buildNeedsAttentionModel(taskNodes) {
  const now = Date.now();
  const allTasks = Array.isArray(taskNodes) ? taskNodes : [];
  const failed = allTasks.filter((node) => {
    const status = String(node && node.status || '').toLowerCase();
    return status === 'failed' || status === 'error';
  });

  const staleAwaitingAck = allTasks.filter((node) => {
    const status = String(node && node.status || '').toLowerCase();
    if (status !== 'awaiting_ack') {
      return false;
    }
    const t = getNodeTimestamp(node);
    return t > 0 && (now - t) >= NORMAL_AWAITING_ACK_STALE_MS;
  });

  const imageRenderFailures = failed.filter((node) => {
    const meta = node && node.metadata && typeof node.metadata === 'object' ? node.metadata : {};
    return meta.taskType === 'image_render';
  });

  const rows = failed.slice(0, 3).map((node) => ({
    id: node.id,
    title: getTaskTitle(node),
    reason: 'failed'
  }));

  if (rows.length < 3) {
    staleAwaitingAck.slice(0, 3 - rows.length).forEach((node) => {
      rows.push({
        id: node.id,
        title: getTaskTitle(node),
        reason: 'awaiting_ack_stale'
      });
    });
  }

  return {
    failedCount: failed.length,
    staleAwaitingAckCount: staleAwaitingAck.length,
    imageRenderFailureCount: imageRenderFailures.length,
    rows
  };
}

function buildRecentResultsModel(taskNodes, graphEdges) {
  const edges = Array.isArray(graphEdges) ? graphEdges : [];
  const fallbackByTaskId = new Map();

  edges.forEach((edge) => {
    if (!edge || typeof edge.taskId !== 'string') {
      return;
    }
    const edgeTs = Number(edge.toAt) || Number(edge.fromAt) || 0;
    if (!fallbackByTaskId.has(edge.taskId) || edgeTs > fallbackByTaskId.get(edge.taskId)) {
      fallbackByTaskId.set(edge.taskId, edgeTs);
    }
  });

  const doneStatuses = new Set(['completed', 'acknowledged']);
  const doneTasks = (Array.isArray(taskNodes) ? taskNodes : [])
    .filter((node) => doneStatuses.has(String(node && node.status || '').toLowerCase()))
    .map((node) => {
      const fallbackTs = fallbackByTaskId.get(node.id) || 0;
      return {
        node,
        ts: Math.max(getNodeTimestamp(node), fallbackTs)
      };
    })
    .sort((a, b) => b.ts - a.ts);

  const rows = doneTasks.slice(0, 5).map((entry) => ({
    id: entry.node.id,
    title: getTaskTitle(entry.node),
    status: String(entry.node.status || 'unknown'),
    at: entry.ts > 0 ? formatIso(entry.ts) : 'n/a'
  }));

  return {
    count: doneTasks.length,
    rows
  };
}

function renderNormalCardRows(listElement, rows, formatter) {
  if (!listElement) {
    return;
  }

  listElement.innerHTML = '';
  if (!rows.length) {
    const empty = document.createElement('li');
    empty.className = 'ocp-empty';
    empty.textContent = 'none';
    listElement.appendChild(empty);
    return;
  }

  rows.forEach((row) => {
    const li = document.createElement('li');
    li.className = 'ocp-normal-card-row';
    li.textContent = formatter(row);
    listElement.appendChild(li);
  });
}

function renderTaskList(listElement, nodes, selectedTaskId) {
  listElement.innerHTML = '';

  if (!nodes.length) {
    const empty = document.createElement('li');
    empty.className = 'ocp-empty';
    empty.textContent = 'none';
    listElement.appendChild(empty);
    return;
  }

  nodes.slice(0, 25).forEach((node) => {
    const meta = node.metadata || {};
    const rawError = typeof meta.error === 'string' && meta.error ? meta.error : null;
    const displayError = formatTaskErrorMessage(meta.taskType, rawError);

    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `ocp-item ocp-task-${taskTone(node.status)}${selectedTaskId === node.id ? ' is-selected' : ''}`;
    button.dataset.taskId = node.id;
    const statusLabel = `status:${node.status || 'unknown'}`;
    const errorLabel = displayError ? ` | error:${displayError}` : '';
    const label = `${meta.title || node.id} | ${statusLabel}${meta.assignedAgentId ? ` | ${meta.assignedAgentId}` : ''}${errorLabel}`;
    button.textContent = `${taskIcon(node.status)} ${label}`;

    if (meta.taskType === 'image_render' && displayError) {
      button.classList.add('ocp-task-image-failed');
    }

    li.appendChild(button);
    listElement.appendChild(li);
  });
}

function getLeftUiMode() {
  return document.body.dataset.leftUiMode === 'debug' ? 'debug' : 'normal';
}

function createPanelRoot() {
  const panel = document.createElement('aside');
  panel.id = 'operator-control-panel';
  panel.innerHTML = `
    <div class="ocp-header">
      <h2>Operator Control Panel</h2>
      <p>Selector-driven observer (event-sourced)</p>
    </div>

    <section class="ocp-section" data-section="tasks">
      <h3>Tasks (Derived)</h3>
      <div class="ocp-normal-cards ui-normal-only">
        <article class="ocp-normal-card" data-card="active-work">
          <header>
            <h4>Active Work</h4>
            <span class="ocp-normal-card-count" data-card-count="active-work">0</span>
          </header>
          <p class="ocp-normal-card-meta" data-card-meta="active-work">Engaged agents: 0</p>
          <ul class="ocp-list ocp-normal-card-list" data-card-list="active-work"></ul>
        </article>

        <article class="ocp-normal-card" data-card="needs-attention">
          <header>
            <h4>Needs Attention</h4>
            <span class="ocp-normal-card-count" data-card-count="needs-attention">0</span>
          </header>
          <p class="ocp-normal-card-meta" data-card-meta="needs-attention">Failed: 0 | Stale ACK: 0 | Image failures: 0</p>
          <ul class="ocp-list ocp-normal-card-list" data-card-list="needs-attention"></ul>
        </article>

        <article class="ocp-normal-card" data-card="recent-results">
          <header>
            <h4>Recent Results</h4>
            <span class="ocp-normal-card-count" data-card-count="recent-results">0</span>
          </header>
          <p class="ocp-normal-card-meta" data-card-meta="recent-results">Latest completed/acknowledged tasks</p>
          <ul class="ocp-list ocp-normal-card-list" data-card-list="recent-results"></ul>
        </article>
      </div>
      <div class="ocp-debug-actions ui-debug-only">
        <button type="button" class="ocp-debug-create" data-action="create-test-task">+ Create Test Task</button>
        <span class="ocp-debug-indicator" data-role="create-task-indicator"></span>
      </div>
      <div class="ocp-toolbar ui-debug-only">
        <label class="ocp-control">
          <input type="checkbox" data-control="active-only" />
          Active tasks only
        </label>
        <label class="ocp-control">
          Recent window
          <select data-control="recent-seconds">
            <option value="0">All</option>
            <option value="60">Last 60s</option>
            <option value="300">Last 5m</option>
          </select>
        </label>
      </div>
      <div class="ocp-compact-summary" data-detail="summary">No tasks yet.</div>
      <div class="ocp-grid-2 ui-debug-only">
        <div>
          <h4>Queued</h4>
          <ul class="ocp-list" data-list="queued"></ul>
        </div>
        <div>
          <h4>Active</h4>
          <ul class="ocp-list" data-list="active"></ul>
        </div>
        <div>
          <h4>Done</h4>
          <ul class="ocp-list" data-list="done"></ul>
        </div>
        <div>
          <h4>Failed</h4>
          <ul class="ocp-list" data-list="failed"></ul>
        </div>
      </div>
      <pre class="ocp-detail ui-debug-only" data-detail="task">Click a task to inspect derived details.</pre>
      <div class="ocp-timeline-wrap ui-debug-only">
        <h4>Selected Task Timeline</h4>
        <ul class="ocp-list ocp-timeline" data-list="timeline"></ul>
        <pre class="ocp-detail" data-detail="event">Click a timeline event to inspect payload.</pre>
      </div>
    </section>

    <section class="ocp-section ui-debug-only" data-section="agents">
      <h3>Agents (Derived)</h3>
      <ul class="ocp-list" data-list="agents"></ul>
      <pre class="ocp-detail ui-debug-only" data-detail="agent">Click an agent to inspect derived assignment.</pre>
    </section>

    <section class="ocp-section ui-debug-only" data-section="events">
      <h3>Transition Stream</h3>
      <div class="ocp-toolbar">
        <label class="ocp-control">
          Show last
          <select data-control="max-events">
            <option value="30">30</option>
            <option value="100" selected>100</option>
            <option value="300">300</option>
          </select>
          transitions
        </label>
      </div>
      <ul class="ocp-list" data-list="events"></ul>
    </section>
  `;

  return panel;
}

export function initOperatorControlPanel() {
  const panel = createPanelRoot();
  const panelStack = document.getElementById('control-panels-stack');
  if (panelStack) {
    panelStack.appendChild(panel);
  } else {
    document.body.appendChild(panel);
  }

  const queuedList = panel.querySelector('[data-list="queued"]');
  const activeList = panel.querySelector('[data-list="active"]');
  const doneList = panel.querySelector('[data-list="done"]');
  const failedList = panel.querySelector('[data-list="failed"]');
  const timelineList = panel.querySelector('[data-list="timeline"]');
  const agentsList = panel.querySelector('[data-list="agents"]');
  const eventsList = panel.querySelector('[data-list="events"]');
  const summaryDetail = panel.querySelector('[data-detail="summary"]');
  const taskDetail = panel.querySelector('[data-detail="task"]');
  const agentDetail = panel.querySelector('[data-detail="agent"]');
  const eventDetail = panel.querySelector('[data-detail="event"]');
  const activeWorkCount = panel.querySelector('[data-card-count="active-work"]');
  const activeWorkMeta = panel.querySelector('[data-card-meta="active-work"]');
  const activeWorkList = panel.querySelector('[data-card-list="active-work"]');
  const needsAttentionCount = panel.querySelector('[data-card-count="needs-attention"]');
  const needsAttentionMeta = panel.querySelector('[data-card-meta="needs-attention"]');
  const needsAttentionList = panel.querySelector('[data-card-list="needs-attention"]');
  const recentResultsCount = panel.querySelector('[data-card-count="recent-results"]');
  const recentResultsMeta = panel.querySelector('[data-card-meta="recent-results"]');
  const recentResultsList = panel.querySelector('[data-card-list="recent-results"]');
  const activeOnlyInput = panel.querySelector('[data-control="active-only"]');
  const recentSecondsSelect = panel.querySelector('[data-control="recent-seconds"]');
  const maxEventsSelect = panel.querySelector('[data-control="max-events"]');
  const createTaskButton = panel.querySelector('[data-action="create-test-task"]');
  const createTaskIndicator = panel.querySelector('[data-role="create-task-indicator"]');

  if (activeOnlyInput) {
    activeOnlyInput.checked = panelState.activeTasksOnly;
  }
  if (recentSecondsSelect) {
    recentSecondsSelect.value = String(panelState.recentSeconds);
  }
  if (maxEventsSelect) {
    maxEventsSelect.value = String(panelState.maxEventRows);
  }

  panel.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.dataset.taskId) {
      panelState.selectedTaskId = target.dataset.taskId;
      panelState.selectedTimelineIndex = null;
      renderPanel();
      return;
    }

    if (target.dataset.agentId) {
      panelState.selectedAgentId = target.dataset.agentId;
      renderPanel();
      return;
    }

    if (target.dataset.timelineIndex) {
      panelState.selectedTimelineIndex = Number(target.dataset.timelineIndex);
      renderPanel();
      return;
    }

    if (target.matches('[data-action="create-test-task"]')) {
      createTestTask();
    }
  });

  panel.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.matches('[data-control="active-only"]')) {
      panelState.activeTasksOnly = Boolean(target.checked);
      renderPanel();
      return;
    }

    if (target.matches('[data-control="recent-seconds"]')) {
      panelState.recentSeconds = Number(target.value) || 0;
      renderPanel();
      return;
    }

    if (target.matches('[data-control="max-events"]')) {
      panelState.maxEventRows = Math.max(1, Number(target.value) || 100);
      renderPanel();
    }
  });

  function renderPanel() {
    panel.dataset.uiMode = getLeftUiMode();
    const graph = getGraphSnapshot();
    const allNodes = Array.isArray(graph.nodes) ? graph.nodes : [];
    const graphEdges = Array.isArray(graph.edges) ? graph.edges : [];

    const taskNodes = allNodes.filter((n) => n && n.type === 'task');
    const workerNodes = allNodes.filter((n) => n && n.type === 'worker');

    const activeWorkModel = buildActiveWorkModel(taskNodes, workerNodes);
    const needsAttentionModel = buildNeedsAttentionModel(taskNodes);
    const recentResultsModel = buildRecentResultsModel(taskNodes, graphEdges);

    if (activeWorkCount) {
      activeWorkCount.textContent = String(activeWorkModel.count);
    }
    if (activeWorkMeta) {
      activeWorkMeta.textContent = `Engaged agents: ${activeWorkModel.engagedAgents}`;
    }
    renderNormalCardRows(
      activeWorkList,
      activeWorkModel.rows,
      (row) => `${taskIcon(row.status)} ${row.title} | ${row.status}${row.assignedAgentId ? ` | ${row.assignedAgentId}` : ''}`
    );

    if (needsAttentionCount) {
      const count = needsAttentionModel.failedCount + needsAttentionModel.staleAwaitingAckCount;
      needsAttentionCount.textContent = String(count);
    }
    if (needsAttentionMeta) {
      needsAttentionMeta.textContent = `Failed: ${needsAttentionModel.failedCount} | Stale ACK: ${needsAttentionModel.staleAwaitingAckCount} | Image failures: ${needsAttentionModel.imageRenderFailureCount}`;
    }
    renderNormalCardRows(
      needsAttentionList,
      needsAttentionModel.rows,
      (row) => `! ${row.title} | ${row.reason}`
    );

    if (recentResultsCount) {
      recentResultsCount.textContent = String(recentResultsModel.count);
    }
    if (recentResultsMeta) {
      recentResultsMeta.textContent = recentResultsModel.rows.length
        ? 'Latest completed/acknowledged tasks'
        : 'No completed tasks yet';
    }
    renderNormalCardRows(
      recentResultsList,
      recentResultsModel.rows,
      (row) => `${taskIcon(row.status)} ${row.title} | ${row.status} | ${row.at}`
    );

    // Apply filters using already-computed node.status — no derivation from events.
    let filteredTaskNodes = taskNodes;
    if (panelState.activeTasksOnly) {
      filteredTaskNodes = taskNodes.filter((n) => isActiveNodeStatus(n.status));
    }
    if (panelState.recentSeconds > 0) {
      const cutoff = Date.now() - panelState.recentSeconds * 1000;
      filteredTaskNodes = filteredTaskNodes.filter((n) => {
        if (isActiveNodeStatus(n.status)) { return true; }
        const meta = n.metadata || {};
        const t = meta.updatedAt || meta.createdAt;
        return Number.isFinite(t) && t >= cutoff;
      });
    }

    const buckets = bucketNodesByStatus(filteredTaskNodes);
    renderTaskList(queuedList, buckets.queued, panelState.selectedTaskId);
    renderTaskList(activeList, buckets.active, panelState.selectedTaskId);
    renderTaskList(doneList, buckets.done, panelState.selectedTaskId);
    renderTaskList(failedList, buckets.failed, panelState.selectedTaskId);

    if (summaryDetail) {
      const summary = [
        `Total ${filteredTaskNodes.length}`,
        `Queued ${buckets.queued.length}`,
        `Active ${buckets.active.length}`,
        `Failed ${buckets.failed.length}`,
        `Agents ${workerNodes.length}`
      ];
      if (panelState.selectedTaskId) {
        summary.push(`Selected ${panelState.selectedTaskId}`);
      }
      summaryDetail.textContent = summary.join(' | ');
    }

    eventsList.innerHTML = '';
    {
      const edgeRows = graphEdges.slice(-panelState.maxEventRows).reverse();
      if (!edgeRows.length) {
        const empty = document.createElement('li');
        empty.className = 'ocp-empty';
        empty.textContent = 'none';
        eventsList.appendChild(empty);
      } else {
        edgeRows.forEach((edge) => {
          const li = document.createElement('li');
          li.className = 'ocp-event';
          li.textContent = `${formatIso(edge.fromAt)} | ${edge.from}->${edge.to} ${edge.taskId || ''}`.trim();
          if (panelState.selectedTaskId && edge.taskId === panelState.selectedTaskId) {
            li.classList.add('is-selected');
          }
          eventsList.appendChild(li);
        });
      }
    }

    agentsList.innerHTML = '';
    if (!workerNodes.length) {
      const empty = document.createElement('li');
      empty.className = 'ocp-empty';
      empty.textContent = 'none';
      agentsList.appendChild(empty);
    } else {
      workerNodes.forEach((node) => {
        const meta = node.metadata || {};
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `ocp-item${panelState.selectedAgentId === node.id ? ' is-selected' : ''}`;
        if (panelState.selectedTaskId && meta.currentTaskId === panelState.selectedTaskId) {
          button.classList.add('ocp-agent-active');
        }
        button.dataset.agentId = node.id;
        button.textContent = `${node.id} | ${node.status} | task ${meta.currentTaskId || 'none'}`;
        li.appendChild(button);
        agentsList.appendChild(li);
      });
    }

    if (panelState.selectedTaskId) {
      const selectedNode = allNodes.find((n) => n && n.id === panelState.selectedTaskId) || null;
      if (!selectedNode) {
        taskDetail.textContent = 'Selected task not found.';
        eventDetail.textContent = 'Selected event not found.';
        timelineList.innerHTML = '';
      } else {
        const taskEdges = graphEdges.filter((e) => e.taskId === selectedNode.id).slice(-20);
        const timelineRows = taskEdges.map((edge, index) => ({
          index,
          from: edge.from,
          to: edge.to,
          fromAt: formatIso(edge.fromAt),
          toAt: formatIso(edge.toAt)
        }));

        if (!timelineRows.some((entry) => entry.index === panelState.selectedTimelineIndex)) {
          panelState.selectedTimelineIndex = timelineRows.length ? timelineRows[timelineRows.length - 1].index : null;
        }

        timelineList.innerHTML = '';
        if (!timelineRows.length) {
          const empty = document.createElement('li');
          empty.className = 'ocp-empty';
          empty.textContent = 'No transitions observed for this task yet.';
          timelineList.appendChild(empty);
        } else {
          timelineRows.forEach((entry) => {
            const li = document.createElement('li');
            li.className = 'ocp-event';
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `ocp-item ocp-event-row${panelState.selectedTimelineIndex === entry.index ? ' is-selected' : ''}`;
            button.dataset.timelineIndex = String(entry.index);
            button.textContent = `${entry.fromAt} | ${entry.from}->${entry.to}`;
            li.appendChild(button);
            timelineList.appendChild(li);
          });

          const selectedEntry = timelineRows.find((entry) => entry.index === panelState.selectedTimelineIndex) || timelineRows[timelineRows.length - 1];
          eventDetail.textContent = stringify(selectedEntry);
        }

        const meta = selectedNode.metadata || {};
        const rawError = typeof meta.error === 'string' && meta.error ? meta.error : null;
        const displayError = formatTaskErrorMessage(meta.taskType, rawError);
        const executionTrace = buildExecutionTrace(taskEdges);

        taskDetail.textContent = stringify({
          id: selectedNode.id,
          status: selectedNode.status,
          title: meta.title,
          taskType: meta.taskType,
          assignedAgentId: meta.assignedAgentId,
          deskId: meta.deskId,
          error: displayError,
          createdAt: formatIso(meta.createdAt),
          updatedAt: formatIso(meta.updatedAt),
          queueTime: meta.queueTime,
          duration: meta.duration,
          ackLatency: meta.ackLatency,
          incidents: meta.incidents,
          executionTrace,
          timeline: timelineRows
        });
      }
    } else {
      timelineList.innerHTML = '';
      eventDetail.textContent = 'Select a task, then click a timeline event to inspect payload.';
      const empty = document.createElement('li');
      empty.className = 'ocp-empty';
      empty.textContent = 'Select a task to inspect timeline.';
      timelineList.appendChild(empty);
    }

    if (panelState.selectedAgentId) {
      const selectedWorker = workerNodes.find((n) => n.id === panelState.selectedAgentId) || null;
      agentDetail.textContent = selectedWorker ? stringify(selectedWorker) : 'Selected agent not found.';
    } else {
      agentDetail.textContent = 'Click an agent to inspect derived assignment.';
    }

    if (createTaskButton) {
      createTaskButton.disabled = panelState.createTaskPending;
      createTaskButton.textContent = panelState.createTaskPending
        ? 'Creating...'
        : '+ Create Test Task';
    }

    if (createTaskIndicator) {
      createTaskIndicator.textContent = panelState.createTaskMessage;
      createTaskIndicator.className = panelState.createTaskMessage
        ? `ocp-debug-indicator is-visible ${panelState.createTaskTone === 'error' ? 'is-error' : 'is-success'}`
        : 'ocp-debug-indicator';
    }
  }

  async function createTestTask() {
    if (panelState.createTaskPending) {
      return;
    }

    if (!window.controlAPI || typeof window.controlAPI.injectTask !== 'function') {
      panelState.createTaskMessage = 'Create failed: controlAPI unavailable';
      panelState.createTaskTone = 'error';
      renderPanel();
      console.error('[CreateTestTask] controlAPI.injectTask unavailable');
      return;
    }

    panelState.createTaskPending = true;
    panelState.createTaskMessage = '';
    panelState.createTaskTone = '';
    renderPanel();

    try {
      const response = await window.controlAPI.injectTask({
        type: 'image_render',
        title: 'Test Task',
        intent: 'render_product_image',
        payload: {
          source: 'operator_control_panel',
          prompt: 'minimal product test render'
        }
      });

      console.log('[CreateTestTask] /task response', {
        success: response && response.success === true,
        statusCode: response && response.statusCode ? response.statusCode : null,
        body: response && Object.prototype.hasOwnProperty.call(response, 'body') ? response.body : (response && response.data ? response.data : null),
        error: response && response.error ? response.error : null
      });

      if (!response || !response.success) {
        const status = response && response.statusCode ? ` (${response.statusCode})` : '';
        const detail = response && response.data ? ` ${stringify(response.data)}` : (response && response.error ? ` ${response.error}` : '');
        panelState.createTaskMessage = `Create failed${status}${detail}`;
        panelState.createTaskTone = 'error';
      } else {
        panelState.createTaskMessage = `Task created (${response.statusCode || 200}) ${stringify(response.body || response.data || {})}`;
        panelState.createTaskTone = 'success';
      }
    } catch (error) {
      console.error('[CreateTestTask] request_failed', error);
      panelState.createTaskMessage = `Create failed ${error && error.message ? error.message : 'request_failed'}`;
      panelState.createTaskTone = 'error';
    } finally {
      panelState.createTaskPending = false;
      renderPanel();
    }
  }

  renderPanel();
  window.addEventListener('slothworld:graph', () => {
    renderPanel();
  });
  window.addEventListener('slothworld:ui-mode', () => {
    renderPanel();
  });
}
