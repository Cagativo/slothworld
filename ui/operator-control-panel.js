import { getRawEvents, subscribeEventStream } from '../core/world/eventStore.js';
import { deriveWorldState } from '../core/world/deriveWorldState.js';

const panelState = {
  selectedTaskId: null,
  selectedAgentId: null
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
      </div>
    </section>

    <section class="ocp-section" data-section="agents">
      <h3>Agents (Derived)</h3>
      <ul class="ocp-list" data-list="agents"></ul>
      <pre class="ocp-detail" data-detail="agent">Click an agent to inspect derived assignment.</pre>
    </section>

    <section class="ocp-section" data-section="events">
      <h3>Raw Event Stream</h3>
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
    button.textContent = builder(task);
    li.appendChild(button);
    listElement.appendChild(li);
  });
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

  panel.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.dataset.taskId) {
      panelState.selectedTaskId = target.dataset.taskId;
      renderPanel(getRawEvents());
      return;
    }

    if (target.dataset.agentId) {
      panelState.selectedAgentId = target.dataset.agentId;
      renderPanel(getRawEvents());
    }
  });

  function renderPanel(eventStreamSnapshot) {
    const events = Array.isArray(eventStreamSnapshot) ? eventStreamSnapshot : getRawEvents();
    const worldState = deriveWorldState(events);
    const tasks = Array.isArray(worldState.tasks) ? worldState.tasks : [];
    const agents = Array.isArray(worldState.agents) ? worldState.agents : [];
    const buckets = classifyTasks(tasks);

    renderTaskList(queuedList, buckets.queued, panelState.selectedTaskId, (task) => `${task.title} | ${task.status}`);
    renderTaskList(activeList, buckets.active, panelState.selectedTaskId, (task) => `${task.title} | ${task.status}`);
    renderTaskList(doneList, buckets.done, panelState.selectedTaskId, (task) => `${task.id} | ${task.status}`);
    renderTaskList(failedList, buckets.failed, panelState.selectedTaskId, (task) => `${task.id} | ${task.error || 'failed'}`);

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
        const selectedTask = selectedTaskId ? tasks.find((task) => task.id === selectedTaskId) : null;
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
        li.appendChild(button);
        agentsList.appendChild(li);
      });
    }

    const recentEvents = events.slice(-30).reverse();
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
        li.textContent = `${formatTime(event.timestamp)} | ${eventType} ${taskId}`.trim();
        eventsList.appendChild(li);
      });
    }

    if (panelState.selectedTaskId) {
      const selectedTask = tasks.find((task) => task.id === panelState.selectedTaskId);
      if (!selectedTask) {
        taskDetail.textContent = 'Selected task not found in derived world.';
        timelineList.innerHTML = '';
        const empty = document.createElement('li');
        empty.className = 'ocp-empty';
        empty.textContent = 'No timeline available.';
        timelineList.appendChild(empty);
      } else {
        const timeline = events
          .filter((event) => eventTaskId(event) === selectedTask.id)
          .slice(-20)
          .map((event) => ({
            time: formatTime(event.timestamp),
            event: eventTypeLabel(event),
            payload: event && typeof event.payload === 'object' ? event.payload : null
          }));

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
            const payloadSuffix = entry.payload ? ` ${stringify(entry.payload)}` : '';
            li.textContent = `${entry.time} | ${entry.event}${payloadSuffix}`;
            timelineList.appendChild(li);
          });
        }

        taskDetail.textContent = stringify({
          ...selectedTask,
          eventTimeline: timeline
        });
      }
    } else {
      timelineList.innerHTML = '';
      const empty = document.createElement('li');
      empty.className = 'ocp-empty';
      empty.textContent = 'Select a task to inspect timeline.';
      timelineList.appendChild(empty);
    }

    if (panelState.selectedAgentId) {
      const selectedAgent = agents.find((agent) => agent.id === panelState.selectedAgentId);
      agentDetail.textContent = selectedAgent ? stringify(selectedAgent) : 'Selected agent not found in derived world.';
    }
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
