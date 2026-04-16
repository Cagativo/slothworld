/**
 * 🚨 ARCHITECTURE LOCK
 *
 * This module participates in the event-sourced execution model.
 *
 * DO NOT:
 * - Infer lifecycle state
 * - Introduce fallback transitions
 * - Derive failure outside TASK_ACKED
 * - Treat any event other than TASK_ACKED as terminal authority
 *
 * ONLY TaskEngine defines lifecycle.
 * TASK_ACKED is the ONLY terminal authority.
 * ONLY events define truth.
 *
 * If something is missing -> FIX EVENT EMISSION, not derivation.
 */

import { getRawEvents, subscribeEventStream } from '../core/world/eventStore.js';
import { deriveWorldState } from '../core/world/deriveWorldState.js';

const panelState = {
  selectedTaskId: null,
  selectedAgentId: null,
  selectedTimelineIndex: null,
  activeTasksOnly: false,
  recentSeconds: 0,
  maxEventRows: 100
};

function formatTime(timestamp) {
  if (!Number.isFinite(timestamp)) {
    return 'n/a';
  }
  return new Date(timestamp).toLocaleTimeString();
}

function stringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (_error) {
    return String(value);
  }
}

function eventTaskId(event) {
  if (!event || typeof event !== 'object') {
    return null;
  }

  if (event.taskId) {
    return String(event.taskId);
  }

  if (event.task && event.task.id) {
    return String(event.task.id);
  }

  if (event.payload && event.payload.taskId) {
    return String(event.payload.taskId);
  }

  return null;
}

function eventTypeLabel(event) {
  if (!event || typeof event !== 'object') {
    return 'UNKNOWN';
  }

  if (typeof event.type === 'string') {
    return event.type;
  }

  if (event.task && event.task.status) {
    return `TASK_SNAPSHOT:${event.task.status}`;
  }

  return 'UNKNOWN';
}

function deskAnchor(desk) {
  if (!desk) {
    return null;
  }

  return {
    x: Number(desk.x),
    y: Number(desk.y) + 34
  };
}

function computeDerivedAgentPosition(agent, desksById, frameNow) {
  if (!agent) {
    return null;
  }

  const homeDesk = agent.deskId ? desksById.get(agent.deskId) : null;
  const targetDesk = agent.targetDeskId ? desksById.get(agent.targetDeskId) : null;
  const home = deskAnchor(homeDesk || targetDesk);
  const target = deskAnchor(targetDesk || homeDesk);

  if (!home && !target) {
    return null;
  }

  const start = home || target;
  const end = target || home;
  const seed = String(agent.id || 'agent').length;
  const phase = ((frameNow / 1000) + (seed % 11) * 0.13) % 1;

  if (agent.state === 'moving') {
    return {
      x: start.x + (end.x - start.x) * phase,
      y: start.y + (end.y - start.y) * phase
    };
  }

  return end;
}

function ensureSelectionOverlay() {
  const canvas = document.querySelector('canvas');
  if (!(canvas instanceof HTMLCanvasElement)) {
    return null;
  }

  const parent = canvas.parentElement;
  if (!parent) {
    return null;
  }

  if (getComputedStyle(parent).position === 'static') {
    parent.style.position = 'relative';
  }

  let overlay = parent.querySelector('[data-role="task-selection-overlay"]');
  if (!(overlay instanceof HTMLCanvasElement)) {
    overlay = document.createElement('canvas');
    overlay.dataset.role = 'task-selection-overlay';
    overlay.style.position = 'absolute';
    overlay.style.left = `${canvas.offsetLeft}px`;
    overlay.style.top = `${canvas.offsetTop}px`;
    overlay.style.width = `${canvas.clientWidth}px`;
    overlay.style.height = `${canvas.clientHeight}px`;
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '4';
    parent.appendChild(overlay);
  }

  const width = canvas.width;
  const height = canvas.height;
  if (overlay.width !== width) {
    overlay.width = width;
  }
  if (overlay.height !== height) {
    overlay.height = height;
  }

  overlay.style.left = `${canvas.offsetLeft}px`;
  overlay.style.top = `${canvas.offsetTop}px`;
  overlay.style.width = `${canvas.clientWidth}px`;
  overlay.style.height = `${canvas.clientHeight}px`;

  return overlay;
}

function drawTaskSelectionOverlay(worldState, selectedTaskId) {
  const overlay = ensureSelectionOverlay();
  if (!(overlay instanceof HTMLCanvasElement)) {
    return;
  }

  const octx = overlay.getContext('2d');
  if (!octx) {
    return;
  }

  octx.clearRect(0, 0, overlay.width, overlay.height);

  if (!selectedTaskId) {
    return;
  }

  const tasks = Array.isArray(worldState && worldState.tasks) ? worldState.tasks : [];
  const desks = Array.isArray(worldState && worldState.desks) ? worldState.desks : [];
  const agents = Array.isArray(worldState && worldState.agents) ? worldState.agents : [];

  const task = tasks.find((item) => item && item.id === selectedTaskId);
  if (!task) {
    return;
  }

  const desksById = new Map(desks.map((desk) => [desk.id, desk]));
  const selectedDesk = task.deskId ? desksById.get(task.deskId) : null;
  const deskPoint = deskAnchor(selectedDesk);
  const selectedAgent = agents.find((agent) => {
    if (!agent) {
      return false;
    }

    if (task.assignedAgentId && agent.id === task.assignedAgentId) {
      return true;
    }

    return agent.currentTaskId && agent.currentTaskId === task.id;
  }) || null;
  const agentPoint = computeDerivedAgentPosition(selectedAgent, desksById, Date.now());

  if (deskPoint) {
    octx.strokeStyle = 'rgba(56, 189, 248, 0.95)';
    octx.lineWidth = 2;
    octx.strokeRect(deskPoint.x - 52, deskPoint.y - 34, 104, 68);
  }

  if (agentPoint) {
    octx.strokeStyle = 'rgba(34, 197, 94, 0.95)';
    octx.lineWidth = 2;
    octx.beginPath();
    octx.arc(agentPoint.x, agentPoint.y, 16, 0, Math.PI * 2);
    octx.stroke();
  }

  if (deskPoint && agentPoint) {
    octx.strokeStyle = 'rgba(251, 191, 36, 0.9)';
    octx.lineWidth = 2;
    octx.setLineDash([6, 4]);
    octx.beginPath();
    octx.moveTo(deskPoint.x, deskPoint.y);
    octx.lineTo(agentPoint.x, agentPoint.y);
    octx.stroke();
    octx.setLineDash([]);
  }
}

function createPanelRoot() {
  const panel = document.createElement('aside');
  panel.id = 'operator-control-panel';
  panel.innerHTML = `
    <div class="ocp-header">
      <h2>Operator Control Panel</h2>
      <p>Derived world observer (event-sourced)</p>
    </div>

    <section class="ocp-section" data-section="tasks">
      <h3>Tasks (Derived)</h3>
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
      <h3>Raw Event Stream</h3>
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

function renderTaskList(listElement, tasks, selectedTaskId, builder) {
  listElement.innerHTML = '';

  if (!tasks.length) {
    const empty = document.createElement('li');
    empty.className = 'ocp-empty';
    empty.textContent = 'none';
    listElement.appendChild(empty);
    return;
  }

  tasks.slice(0, 25).forEach((task) => {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `ocp-item${selectedTaskId === task.id ? ' is-selected' : ''}`;
    button.dataset.taskId = task.id;
    const itemView = builder(task);
    button.classList.add(`ocp-task-${itemView.tone}`);
    button.textContent = `${itemView.icon} ${itemView.label}`;
    li.appendChild(button);
    listElement.appendChild(li);
  });
}

function isTaskActive(task) {
  return task.status === 'claimed' || task.status === 'executing' || task.status === 'awaiting_ack';
}

function isTaskTerminal(task) {
  return task.status === 'completed' || task.status === 'acknowledged' || task.status === 'failed';
}

function taskLabelView(task, section) {
  const agentHint = task.assignedAgentId ? ` | claimed by ${task.assignedAgentId}` : '';
  if (section === 'failed') {
    return {
      icon: '✖',
      tone: 'failed',
      label: `${task.id} | failed${task.error ? ` | ${task.error}` : ''}`
    };
  }

  if (task.status === 'awaiting_ack') {
    return { icon: '⧗', tone: 'pending', label: `${task.title} | awaiting_ack` };
  }
  if (task.status === 'executing') {
    return { icon: '⚙', tone: 'active', label: `${task.title} | executing${agentHint}` };
  }
  if (task.status === 'claimed') {
    return { icon: '➤', tone: 'active', label: `${task.title} | claimed${agentHint}` };
  }
  if (task.status === 'acknowledged' || task.status === 'completed') {
    return { icon: '✔', tone: 'done', label: `${task.id} | ${task.status}` };
  }

  return { icon: '•', tone: 'queued', label: `${task.title} | ${task.status}` };
}

function filterTasks(tasks, now) {
  let filtered = tasks;

  if (panelState.activeTasksOnly) {
    filtered = filtered.filter((task) => isTaskActive(task));
  }

  if (panelState.recentSeconds > 0) {
    const cutoff = now - panelState.recentSeconds * 1000;
    filtered = filtered.filter((task) => {
      const touchedAt = Number.isFinite(task.updatedAt) ? task.updatedAt : task.createdAt;
      return isTaskActive(task) || (Number.isFinite(touchedAt) && touchedAt >= cutoff);
    });
  }

  return filtered;
}

function classifyTasks(tasks) {
  const queued = [];
  const active = [];
  const done = [];
  const failed = [];

  for (const task of tasks) {
    if (task.status === 'failed') {
      failed.push(task);
      continue;
    }

    if (task.status === 'acknowledged' || task.status === 'completed') {
      done.push(task);
      continue;
    }

    if (task.status === 'claimed' || task.status === 'executing' || task.status === 'awaiting_ack') {
      active.push(task);
      continue;
    }

    queued.push(task);
  }

  return { queued, active, done, failed };
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
      renderPanel(getRawEvents());
      return;
    }

    if (target.dataset.agentId) {
      panelState.selectedAgentId = target.dataset.agentId;
      renderPanel(getRawEvents());
      return;
    }

    if (target.dataset.timelineIndex) {
      panelState.selectedTimelineIndex = Number(target.dataset.timelineIndex);
      renderPanel(getRawEvents());
    }
  });

  panel.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.matches('[data-control="active-only"]')) {
      panelState.activeTasksOnly = Boolean(target.checked);
      renderPanel(getRawEvents());
      return;
    }

    if (target.matches('[data-control="recent-seconds"]')) {
      panelState.recentSeconds = Number(target.value) || 0;
      renderPanel(getRawEvents());
      return;
    }

    if (target.matches('[data-control="max-events"]')) {
      panelState.maxEventRows = Math.max(1, Number(target.value) || 100);
      renderPanel(getRawEvents());
    }
  });

  function renderPanel(eventStreamSnapshot) {
    const events = Array.isArray(eventStreamSnapshot) ? eventStreamSnapshot : getRawEvents();
    const worldState = deriveWorldState(events);
    const allTasks = Array.isArray(worldState.tasks) ? worldState.tasks : [];
    const tasks = filterTasks(allTasks, Date.now());
    const agents = Array.isArray(worldState.agents) ? worldState.agents : [];
    const buckets = classifyTasks(tasks);

    renderTaskList(queuedList, buckets.queued, panelState.selectedTaskId, (task) => taskLabelView(task, 'queued'));
    renderTaskList(activeList, buckets.active, panelState.selectedTaskId, (task) => taskLabelView(task, 'active'));
    renderTaskList(doneList, buckets.done, panelState.selectedTaskId, (task) => taskLabelView(task, 'done'));
    renderTaskList(failedList, buckets.failed, panelState.selectedTaskId, (task) => taskLabelView(task, 'failed'));

    agentsList.innerHTML = '';
    if (!agents.length) {
      const empty = document.createElement('li');
      empty.className = 'ocp-empty';
      empty.textContent = 'none';
      agentsList.appendChild(empty);
    } else {
      agents.forEach((agent) => {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ocp-item';
        button.dataset.agentId = agent.id;
        const selectedTaskId = panelState.selectedTaskId;
        const selectedTask = selectedTaskId ? allTasks.find((task) => task.id === selectedTaskId) : null;
        const isSelectedTaskWorker = !!(
          selectedTask
          && (
            (selectedTask.assignedAgentId && selectedTask.assignedAgentId === agent.id)
            || (agent.currentTaskId && agent.currentTaskId === selectedTask.id)
          )
        );

        if (isSelectedTaskWorker) {
          button.classList.add('ocp-agent-active');
        }
        if (panelState.selectedAgentId === agent.id) {
          button.classList.add('is-selected');
        }

        button.textContent = `${isSelectedTaskWorker ? '▶ ' : ''}${agent.id} | ${agent.state} | desk ${agent.deskId}`;
        if (agent.state === 'working') {
          button.classList.add('ocp-agent-working');
        } else if (agent.state === 'delivering') {
          button.classList.add('ocp-agent-delivering');
        } else if (agent.state === 'error') {
          button.classList.add('ocp-agent-error');
        }
        li.appendChild(button);
        agentsList.appendChild(li);
      });
    }

    const recentEvents = events.slice(-panelState.maxEventRows).reverse();
    eventsList.innerHTML = '';
    if (!recentEvents.length) {
      const empty = document.createElement('li');
      empty.className = 'ocp-empty';
      empty.textContent = 'none';
      eventsList.appendChild(empty);
    } else {
      recentEvents.forEach((event) => {
        const li = document.createElement('li');
        li.className = 'ocp-event';
        const eventType = eventTypeLabel(event);
        const taskId = eventTaskId(event) || '';
        const stamp = Number.isFinite(event.timestamp) ? new Date(event.timestamp).toISOString() : 'n/a';
        li.textContent = `${stamp} | ${eventType} ${taskId}`.trim();
        if (panelState.selectedTaskId && taskId === panelState.selectedTaskId) {
          li.classList.add('is-selected');
        }
        eventsList.appendChild(li);
      });
    }

    if (panelState.selectedTaskId) {
      const selectedTask = allTasks.find((task) => task.id === panelState.selectedTaskId);
      if (!selectedTask) {
        taskDetail.textContent = 'Selected task not found in derived world.';
        eventDetail.textContent = 'Selected event not found.';
        timelineList.innerHTML = '';
        const empty = document.createElement('li');
        empty.className = 'ocp-empty';
        empty.textContent = 'No timeline available.';
        timelineList.appendChild(empty);
      } else {
        const timeline = events
          .filter((event) => eventTaskId(event) === selectedTask.id)
          .slice(-20)
          .map((event, index) => ({
            index,
            timestamp: Number.isFinite(event.timestamp) ? event.timestamp : null,
            isoTime: Number.isFinite(event.timestamp) ? new Date(event.timestamp).toISOString() : 'n/a',
            localTime: formatTime(event.timestamp),
            event: eventTypeLabel(event),
            payload: event && typeof event.payload === 'object' ? event.payload : null,
            taskId: eventTaskId(event)
          }));

        if (!timeline.some((entry) => entry.index === panelState.selectedTimelineIndex)) {
          panelState.selectedTimelineIndex = timeline.length ? timeline[timeline.length - 1].index : null;
        }

        timelineList.innerHTML = '';
        if (!timeline.length) {
          const empty = document.createElement('li');
          empty.className = 'ocp-empty';
          empty.textContent = 'No events observed for this task yet.';
          timelineList.appendChild(empty);
        } else {
          timeline.forEach((entry) => {
            const li = document.createElement('li');
            li.className = 'ocp-event';
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `ocp-item ocp-event-row${panelState.selectedTimelineIndex === entry.index ? ' is-selected' : ''}`;
            button.dataset.timelineIndex = String(entry.index);
            button.textContent = `${entry.isoTime} | ${entry.event}`;
            li.appendChild(button);
            timelineList.appendChild(li);
          });

          const selectedEntry = timeline.find((entry) => entry.index === panelState.selectedTimelineIndex) || timeline[timeline.length - 1];
          eventDetail.textContent = stringify({
            time: selectedEntry.isoTime,
            localTime: selectedEntry.localTime,
            event: selectedEntry.event,
            taskId: selectedEntry.taskId,
            payload: selectedEntry.payload
          });
        }

        taskDetail.textContent = stringify({
          ...selectedTask,
          eventTimeline: timeline
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
      const selectedAgent = agents.find((agent) => agent.id === panelState.selectedAgentId);
      agentDetail.textContent = selectedAgent ? stringify(selectedAgent) : 'Selected agent not found in derived world.';
    }

    drawTaskSelectionOverlay(worldState, panelState.selectedTaskId);
  }

  const initialEvents = getRawEvents();
  renderPanel(initialEvents);
  subscribeEventStream((appendedEvents) => {
    if (!Array.isArray(appendedEvents) || appendedEvents.length === 0) {
      return;
    }

    const fullEvents = getRawEvents();
    renderPanel(fullEvents);
  });
}
