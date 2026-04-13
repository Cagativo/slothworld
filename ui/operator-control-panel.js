import { agents, desks, workflows, eventStream } from '../core/app-state.js';
import { sanitizeTaskForView } from '../core/task-handling.js';

const panelState = {
  selectedTaskId: null,
  selectedAgentId: null,
  selectedWorkflowId: null
};

function formatTime(timestamp) {
  if (!Number.isFinite(timestamp)) {
    return 'n/a';
  }

  const time = new Date(timestamp);
  return time.toLocaleTimeString();
}

function stringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return String(value);
  }
}

function getTaskBuckets() {
  const pending = [];
  const running = [];

  desks.forEach((desk, deskIndex) => {
    if (desk.currentTask) {
      running.push({
        ...sanitizeTaskForView(desk.currentTask),
        deskIndex,
        lane: 'running'
      });
    }

    desk.queue.forEach((task) => {
      pending.push({
        ...sanitizeTaskForView(task),
        deskIndex,
        lane: 'pending'
      });
    });
  });

  const completedById = new Map();
  for (const event of eventStream) {
    if (event.type !== 'TASK_COMPLETED' || !event.payload || !event.payload.taskId) {
      continue;
    }

    completedById.set(event.payload.taskId, {
      id: event.payload.taskId,
      type: event.payload.taskType || 'unknown',
      status: event.payload.success ? 'done' : 'failed',
      deskIndex: event.payload.deskIndex,
      timestamp: event.timestamp,
      error: event.payload.error || event.payload.reason || null,
      channelId: event.payload.channelId || null,
      content: typeof event.payload.content === 'string' ? event.payload.content : null
    });
  }

  const completed = [];
  const failed = [];
  for (const item of completedById.values()) {
    if (item.status === 'failed') {
      failed.push(item);
    } else {
      completed.push(item);
    }
  }

  completed.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  failed.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  return { pending, running, completed, failed };
}

function getAgentAssignment(agent) {
  const deskIndex = agent.targetDesk ? desks.indexOf(agent.targetDesk) : -1;
  if (deskIndex >= 0) {
    const desk = desks[deskIndex];
    return {
      deskIndex,
      taskId: desk.currentTask ? desk.currentTask.id : null,
      activity: desk.currentTask ? desk.currentTask.title : 'positioned'
    };
  }

  return {
    deskIndex: null,
    taskId: null,
    activity: 'unassigned'
  };
}

function getWorkflowHistory(workflow) {
  const history = [];

  if (workflow && workflow.context && typeof workflow.context === 'object') {
    for (const [contextKey, contextEntry] of Object.entries(workflow.context)) {
      if (!contextEntry || typeof contextEntry !== 'object' || !contextEntry.taskId) {
        continue;
      }

      history.push({
        contextKey,
        taskId: contextEntry.taskId,
        status: contextEntry.status || 'unknown',
        attempts: contextEntry.attempts,
        maxRetries: contextEntry.maxRetries,
        completedAt: contextEntry.completedAt,
        output: contextEntry.output || null
      });
    }
  }

  history.sort((a, b) => (a.completedAt || 0) - (b.completedAt || 0));
  return history;
}

function createPanelRoot() {
  const panel = document.createElement('aside');
  panel.id = 'operator-control-panel';
  panel.innerHTML = `
    <div class="ocp-header">
      <h2>Operator Control Panel</h2>
      <p>Read-only runtime observer</p>
    </div>

    <section class="ocp-section" data-section="tasks">
      <h3>Task Queue</h3>
      <div class="ocp-grid-2">
        <div>
          <h4>Pending</h4>
          <ul class="ocp-list" data-list="pending"></ul>
        </div>
        <div>
          <h4>Running</h4>
          <ul class="ocp-list" data-list="running"></ul>
        </div>
        <div>
          <h4>Completed</h4>
          <ul class="ocp-list" data-list="completed"></ul>
        </div>
        <div>
          <h4>Failed</h4>
          <ul class="ocp-list" data-list="failed"></ul>
        </div>
      </div>
      <pre class="ocp-detail" data-detail="task">Click a task to inspect details.</pre>
    </section>

    <section class="ocp-section" data-section="agents">
      <h3>Agent Status</h3>
      <ul class="ocp-list" data-list="agents"></ul>
      <pre class="ocp-detail" data-detail="agent">Click an agent to inspect assignment.</pre>
    </section>

    <section class="ocp-section" data-section="workflows">
      <h3>Workflow Inspector</h3>
      <ul class="ocp-list" data-list="workflows"></ul>
      <pre class="ocp-detail" data-detail="workflow">Click a workflow to inspect execution history.</pre>
    </section>

    <section class="ocp-section" data-section="events">
      <h3>Live Event Stream</h3>
      <ul class="ocp-list" data-list="events"></ul>
    </section>
  `;

  return panel;
}

function renderTaskList(listElement, items, labelBuilder) {
  listElement.innerHTML = '';

  if (!items.length) {
    const empty = document.createElement('li');
    empty.className = 'ocp-empty';
    empty.textContent = 'none';
    listElement.appendChild(empty);
    return;
  }

  items.slice(0, 25).forEach((item) => {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ocp-item';
    button.dataset.taskId = item.id;
    button.textContent = labelBuilder(item);
    li.appendChild(button);
    listElement.appendChild(li);
  });
}

export function initOperatorControlPanel() {
  const panel = createPanelRoot();
  document.body.appendChild(panel);

  const pendingList = panel.querySelector('[data-list="pending"]');
  const runningList = panel.querySelector('[data-list="running"]');
  const completedList = panel.querySelector('[data-list="completed"]');
  const failedList = panel.querySelector('[data-list="failed"]');
  const agentsList = panel.querySelector('[data-list="agents"]');
  const workflowsList = panel.querySelector('[data-list="workflows"]');
  const eventsList = panel.querySelector('[data-list="events"]');

  const taskDetail = panel.querySelector('[data-detail="task"]');
  const agentDetail = panel.querySelector('[data-detail="agent"]');
  const workflowDetail = panel.querySelector('[data-detail="workflow"]');

  panel.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.dataset.taskId) {
      panelState.selectedTaskId = target.dataset.taskId;
      return;
    }

    if (target.dataset.agentId) {
      panelState.selectedAgentId = Number(target.dataset.agentId);
      return;
    }

    if (target.dataset.workflowId) {
      panelState.selectedWorkflowId = target.dataset.workflowId;
    }
  });

  function renderAgents() {
    agentsList.innerHTML = '';
    agents.forEach((agent) => {
      const assignment = getAgentAssignment(agent);
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ocp-item';
      button.dataset.agentId = String(agent.id);
      button.textContent = `#${agent.id} ${agent.role} | ${agent.state} | ${assignment.activity}`;
      li.appendChild(button);
      agentsList.appendChild(li);
    });

    if (panelState.selectedAgentId !== null) {
      const selectedAgent = agents.find((agent) => agent.id === panelState.selectedAgentId);
      if (!selectedAgent) {
        agentDetail.textContent = 'Selected agent no longer exists.';
        return;
      }

      const assignment = getAgentAssignment(selectedAgent);
      agentDetail.textContent = stringify({
        id: selectedAgent.id,
        role: selectedAgent.role,
        state: selectedAgent.state,
        assignment,
        position: {
          x: Math.round(selectedAgent.x),
          y: Math.round(selectedAgent.y)
        },
        productivity: selectedAgent.productivity,
        skills: selectedAgent.skills
      });
    }
  }

  function renderWorkflows() {
    workflowsList.innerHTML = '';
    const workflowEntries = Array.from(workflows.values());

    if (!workflowEntries.length) {
      const empty = document.createElement('li');
      empty.className = 'ocp-empty';
      empty.textContent = 'none';
      workflowsList.appendChild(empty);
    }

    workflowEntries.forEach((workflow) => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ocp-item';
      button.dataset.workflowId = workflow.id;
      const totalSteps = Array.isArray(workflow.steps) ? workflow.steps.length : 0;
      const current = Number.isFinite(workflow.currentStepIndex) ? workflow.currentStepIndex + 1 : 0;
      button.textContent = `${workflow.id} | ${workflow.status} | step ${current}/${totalSteps}`;
      li.appendChild(button);
      workflowsList.appendChild(li);
    });

    if (!panelState.selectedWorkflowId) {
      return;
    }

    const selected = workflows.get(panelState.selectedWorkflowId);
    if (!selected) {
      workflowDetail.textContent = 'Selected workflow no longer exists.';
      return;
    }

    const stepView = (selected.steps || []).map((step, index) => ({
      index,
      name: step.action || step.title || `step_${index}`,
      status: selected.stepStatuses && selected.stepStatuses[index] ? selected.stepStatuses[index] : 'pending',
      attempts: selected.stepAttempts && selected.stepAttempts[index] !== undefined ? selected.stepAttempts[index] : 0,
      maxRetries: selected.stepMaxRetries && selected.stepMaxRetries[index] !== undefined ? selected.stepMaxRetries[index] : 0
    }));

    workflowDetail.textContent = stringify({
      id: selected.id,
      status: selected.status,
      currentStepIndex: selected.currentStepIndex,
      steps: stepView,
      executionHistory: getWorkflowHistory(selected)
    });
  }

  function renderEvents() {
    eventsList.innerHTML = '';
    const events = eventStream.slice(-30).reverse();
    if (!events.length) {
      const empty = document.createElement('li');
      empty.className = 'ocp-empty';
      empty.textContent = 'none';
      eventsList.appendChild(empty);
      return;
    }

    events.forEach((event) => {
      const li = document.createElement('li');
      li.className = 'ocp-event';
      const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
      const keyInfo = payload.taskId || payload.workflowId || payload.agentId || payload.deskIndex || '';
      li.textContent = `${formatTime(event.timestamp)} | ${event.type} ${keyInfo}`.trim();
      eventsList.appendChild(li);
    });
  }

  function renderTasks() {
    const buckets = getTaskBuckets();

    renderTaskList(pendingList, buckets.pending, (task) => {
      return `${task.title} (#${task.id.slice(-4)}) d${task.deskIndex} p${task.priority}`;
    });

    renderTaskList(runningList, buckets.running, (task) => {
      const pct = task.required > 0 ? Math.round((task.progress / task.required) * 100) : 0;
      return `${task.title} d${task.deskIndex} ${pct}%`;
    });

    renderTaskList(completedList, buckets.completed, (task) => {
      return `${task.id} d${task.deskIndex} ${formatTime(task.timestamp)}`;
    });

    renderTaskList(failedList, buckets.failed, (task) => {
      return `${task.id} d${task.deskIndex} ${task.error || 'failed'}`;
    });

    if (!panelState.selectedTaskId) {
      return;
    }

    const selectedLiveTask = [...buckets.running, ...buckets.pending].find((task) => task.id === panelState.selectedTaskId);
    if (selectedLiveTask) {
      taskDetail.textContent = stringify(selectedLiveTask);
      return;
    }

    const selectedResult = [...buckets.completed, ...buckets.failed].find((task) => task.id === panelState.selectedTaskId);
    if (selectedResult) {
      taskDetail.textContent = stringify(selectedResult);
      return;
    }

    taskDetail.textContent = 'Selected task no longer available in active state.';
  }

  function renderPanel() {
    renderTasks();
    renderAgents();
    renderWorkflows();
    renderEvents();
  }

  renderPanel();
  window.setInterval(renderPanel, 300);
}
