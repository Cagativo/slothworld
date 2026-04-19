/**
 * 🚨 ARCHITECTURE LOCK
 *
 * UI module is read-only and selector-driven:
 * events -> deriveWorldState -> selectors -> rendering
 */



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

function getGraphSnapshot() {
  if (window.controlAPI && typeof window.controlAPI.getGraph === 'function') {
    return window.controlAPI.getGraph();
  }
  return { nodes: [], edges: [], metadata: {} };
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
      <div class="ocp-debug-actions">
        <button type="button" class="ocp-debug-create" data-action="create-test-task">+ Create Test Task</button>
        <span class="ocp-debug-indicator" data-role="create-task-indicator"></span>
      </div>
      <div class="ocp-toolbar">
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
      <div class="ocp-grid-2">
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
      <pre class="ocp-detail" data-detail="task">Click a task to inspect derived details.</pre>
      <div class="ocp-timeline-wrap">
        <h4>Selected Task Timeline</h4>
        <ul class="ocp-list ocp-timeline" data-list="timeline"></ul>
        <pre class="ocp-detail" data-detail="event">Click a timeline event to inspect payload.</pre>
      </div>
    </section>

    <section class="ocp-section" data-section="agents">
      <h3>Agents (Derived)</h3>
      <ul class="ocp-list" data-list="agents"></ul>
      <pre class="ocp-detail" data-detail="agent">Click an agent to inspect derived assignment.</pre>
    </section>

    <section class="ocp-section" data-section="events">
      <h3>Event Stream</h3>
      <div class="ocp-toolbar">
        <label class="ocp-control">
          Show last
          <select data-control="max-events">
            <option value="30">30</option>
            <option value="100" selected>100</option>
            <option value="300">300</option>
          </select>
          events
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
  const taskDetail = panel.querySelector('[data-detail="task"]');
  const agentDetail = panel.querySelector('[data-detail="agent"]');
  const eventDetail = panel.querySelector('[data-detail="event"]');
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
    const graph = getGraphSnapshot();
    const allNodes = Array.isArray(graph.nodes) ? graph.nodes : [];
    const graphEdges = Array.isArray(graph.edges) ? graph.edges : [];

    const taskNodes = allNodes.filter((n) => n && n.type === 'task');
    const workerNodes = allNodes.filter((n) => n && n.type === 'worker');

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
}
