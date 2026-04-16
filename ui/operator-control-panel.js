/**
 * 🚨 ARCHITECTURE LOCK
 *
 * UI module is read-only and selector-driven:
 * events -> deriveWorldState -> selectors -> rendering
 */

import { subscribeEventStream } from '../core/world/eventStore.js';
import {
  getAllTasks,
  getTaskTimeline,
  getRecentEvents,
  filterTasks,
  getTaskBuckets,
  getDeskIndexForTask,
  getDeskPosition
} from './selectors/taskSelectors.js';
import { getAllAgents } from './selectors/agentSelectors.js';

const panelState = {
  selectedTaskId: null,
  selectedAgentId: null,
  selectedTimelineIndex: null,
  activeTasksOnly: false,
  recentSeconds: 0,
  maxEventRows: 100
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

function renderTaskList(listElement, tasks, selectedTaskId) {
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
    button.className = `ocp-item ocp-task-${taskTone(task.status)}${selectedTaskId === task.id ? ' is-selected' : ''}`;
    button.dataset.taskId = task.id;
    const label = `${task.title} | ${task.status}${task.assignedAgentId ? ` | ${task.assignedAgentId}` : ''}`;
    button.textContent = `${taskIcon(task.status)} ${label}`;
    li.appendChild(button);
    listElement.appendChild(li);
  });
}

function agentPoint(agent, index, selectedTaskDesk) {
  const value = String(agent && agent.id ? agent.id : index);
  let seed = 0;
  for (let i = 0; i < value.length; i += 1) {
    seed = (seed * 31 + value.charCodeAt(i)) >>> 0;
  }

  if (selectedTaskDesk && agent && agent.currentTaskId) {
    return {
      x: selectedTaskDesk.x + Math.sin(seed) * 12,
      y: selectedTaskDesk.y + 28 + Math.cos(seed) * 6
    };
  }

  return {
    x: 120 + (index % 6) * 96,
    y: 540 - Math.floor(index / 6) * 56
  };
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
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '4';
    parent.appendChild(overlay);
  }

  overlay.width = canvas.width;
  overlay.height = canvas.height;
  overlay.style.left = `${canvas.offsetLeft}px`;
  overlay.style.top = `${canvas.offsetTop}px`;
  overlay.style.width = `${canvas.clientWidth}px`;
  overlay.style.height = `${canvas.clientHeight}px`;

  return overlay;
}

function drawTaskSelectionOverlay(tasks, agents, selectedTaskId) {
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

  const task = tasks.find((item) => item.id === selectedTaskId);
  if (!task) {
    return;
  }

  const desk = getDeskPosition(getDeskIndexForTask(task));
  const selectedAgentIndex = agents.findIndex((agent) => agent.currentTaskId === selectedTaskId || agent.id === task.assignedAgentId);
  const selectedAgent = selectedAgentIndex >= 0 ? agents[selectedAgentIndex] : null;
  const point = selectedAgent ? agentPoint(selectedAgent, selectedAgentIndex, desk) : null;

  octx.strokeStyle = 'rgba(56, 189, 248, 0.95)';
  octx.lineWidth = 2;
  octx.strokeRect(desk.x - 52, desk.y - 34, 104, 68);

  if (point) {
    octx.strokeStyle = 'rgba(34, 197, 94, 0.95)';
    octx.beginPath();
    octx.arc(point.x, point.y, 16, 0, Math.PI * 2);
    octx.stroke();

    octx.strokeStyle = 'rgba(251, 191, 36, 0.9)';
    octx.setLineDash([6, 4]);
    octx.beginPath();
    octx.moveTo(desk.x, desk.y);
    octx.lineTo(point.x, point.y);
    octx.stroke();
    octx.setLineDash([]);
  }
}

function getIndexedWorldSnapshot() {
  if (window.controlAPI && typeof window.controlAPI.getWorldState === 'function') {
    return window.controlAPI.getWorldState();
  }

  return {
    events: [],
    eventsByTaskId: new Map(),
    eventsByWorkerId: new Map()
  };
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
    const indexedWorld = getIndexedWorldSnapshot();
    const allTasks = getAllTasks(indexedWorld);
    const tasks = filterTasks(indexedWorld, {
      activeOnly: panelState.activeTasksOnly,
      recentSeconds: panelState.recentSeconds,
      now: Date.now()
    });
    const agents = getAllAgents(indexedWorld);
    const buckets = getTaskBuckets(indexedWorld, { tasks });

    renderTaskList(queuedList, buckets.queued, panelState.selectedTaskId);
    renderTaskList(activeList, buckets.active, panelState.selectedTaskId);
    renderTaskList(doneList, buckets.done, panelState.selectedTaskId);
    renderTaskList(failedList, buckets.failed, panelState.selectedTaskId);

    const recentEvents = getRecentEvents(indexedWorld, panelState.maxEventRows).reverse();
    eventsList.innerHTML = '';
    if (!recentEvents.length) {
      const empty = document.createElement('li');
      empty.className = 'ocp-empty';
      empty.textContent = 'none';
      eventsList.appendChild(empty);
    } else {
      recentEvents.forEach((entry) => {
        const li = document.createElement('li');
        li.className = 'ocp-event';
        li.textContent = `${formatIso(entry.timestamp)} | ${entry.type} ${entry.taskId || ''}`.trim();
        if (panelState.selectedTaskId && entry.taskId === panelState.selectedTaskId) {
          li.classList.add('is-selected');
        }
        eventsList.appendChild(li);
      });
    }

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
        button.className = `ocp-item${panelState.selectedAgentId === agent.id ? ' is-selected' : ''}`;
        if (panelState.selectedTaskId && agent.currentTaskId === panelState.selectedTaskId) {
          button.classList.add('ocp-agent-active');
        }
        button.dataset.agentId = agent.id;
        button.textContent = `${agent.id} | ${agent.state} | task ${agent.currentTaskId || 'none'}`;
        li.appendChild(button);
        agentsList.appendChild(li);
      });
    }

    if (panelState.selectedTaskId) {
      const selectedTask = allTasks.find((task) => task.id === panelState.selectedTaskId) || null;
      if (!selectedTask) {
        taskDetail.textContent = 'Selected task not found.';
        eventDetail.textContent = 'Selected event not found.';
        timelineList.innerHTML = '';
      } else {
        const timeline = getTaskTimeline(indexedWorld, selectedTask.id).slice(-20);
        const timelineRows = timeline.map((entry, index) => ({
          ...entry,
          index,
          isoTime: formatIso(entry.timestamp)
        }));

        if (!timelineRows.some((entry) => entry.index === panelState.selectedTimelineIndex)) {
          panelState.selectedTimelineIndex = timelineRows.length ? timelineRows[timelineRows.length - 1].index : null;
        }

        timelineList.innerHTML = '';
        if (!timelineRows.length) {
          const empty = document.createElement('li');
          empty.className = 'ocp-empty';
          empty.textContent = 'No events observed for this task yet.';
          timelineList.appendChild(empty);
        } else {
          timelineRows.forEach((entry) => {
            const li = document.createElement('li');
            li.className = 'ocp-event';
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `ocp-item ocp-event-row${panelState.selectedTimelineIndex === entry.index ? ' is-selected' : ''}`;
            button.dataset.timelineIndex = String(entry.index);
            button.textContent = `${entry.isoTime} | ${entry.type}`;
            li.appendChild(button);
            timelineList.appendChild(li);
          });

          const selectedEntry = timelineRows.find((entry) => entry.index === panelState.selectedTimelineIndex) || timelineRows[timelineRows.length - 1];
          eventDetail.textContent = stringify(selectedEntry);
        }

        taskDetail.textContent = stringify({
          ...selectedTask,
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
      const selectedAgent = agents.find((agent) => agent.id === panelState.selectedAgentId) || null;
      agentDetail.textContent = selectedAgent ? stringify(selectedAgent) : 'Selected agent not found.';
    } else {
      agentDetail.textContent = 'Click an agent to inspect derived assignment.';
    }

    drawTaskSelectionOverlay(allTasks, agents, panelState.selectedTaskId);
  }

  renderPanel();
  subscribeEventStream(() => {
    renderPanel();
  });
}
