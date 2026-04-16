/**
 * 🚨 ARCHITECTURE LOCK
 *
 * Read-only anomaly view derived from:
 * event stream -> deriveWorldState -> selectors
 *
 * DO NOT:
 * - Mutate tasks/agents/events
 * - Introduce lifecycle authority
 * - Trigger execution side effects
 */

import { subscribeEventStream } from '../core/world/eventStore.js';
import { getIncidentClusters } from './selectors/anomalySelectors.js';
import { getTaskTimeline } from './selectors/taskSelectors.js';

const STALLED_ACK_MS = 15000;

function stringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (_error) {
    return String(value);
  }
}

function severityRank(severity) {
  if (severity === 'high') {
    return 3;
  }
  if (severity === 'medium') {
    return 2;
  }
  return 1;
}

export function initRaccoonFeederPanel() {
  const panel = document.createElement('aside');
  panel.id = 'raccoon-feeder-panel';
  panel.innerHTML = `
    <div class="rfp-header">
      <h2>Raccoon Feeder</h2>
      <p>Read-only anomaly aggregation</p>
    </div>
    <section class="rfp-section">
      <h3>Incident Clusters</h3>
      <ul class="rfp-list" data-list="incidents"></ul>
      <pre class="rfp-detail" data-detail="incident">Select an incident to inspect details.</pre>
    </section>
  `;

  const panelStack = document.getElementById('control-panels-stack');
  if (panelStack) {
    panelStack.appendChild(panel);
  } else {
    document.body.appendChild(panel);
  }

  const incidentsList = panel.querySelector('[data-list="incidents"]');
  const incidentDetail = panel.querySelector('[data-detail="incident"]');
  let selectedIncidentId = null;

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

  panel.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const incidentId = target.dataset.incidentId;
    if (!incidentId) {
      return;
    }

    selectedIncidentId = incidentId;
    renderPanel();
  });

  function renderPanel() {
    const indexedWorld = getIndexedWorldSnapshot();
    const incidents = getIncidentClusters(indexedWorld, { thresholdMs: STALLED_ACK_MS, now: Date.now() })
      .sort((a, b) => {
        const diff = severityRank(b.severity) - severityRank(a.severity);
        if (diff !== 0) {
          return diff;
        }
        return String(a.taskId || '').localeCompare(String(b.taskId || ''));
      });

    if (!incidents.some((item) => item.id === selectedIncidentId)) {
      selectedIncidentId = incidents.length ? incidents[0].id : null;
    }

    incidentsList.innerHTML = '';
    if (!incidents.length) {
      const empty = document.createElement('li');
      empty.className = 'rfp-empty';
      empty.textContent = 'No anomalies detected in current event view.';
      incidentsList.appendChild(empty);
      incidentDetail.textContent = 'No incident selected.';
      return;
    }

    incidents.forEach((incident) => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `rfp-item${incident.id === selectedIncidentId ? ' is-selected' : ''}`;
      button.dataset.incidentId = incident.id;
      button.textContent = `${incident.severity.toUpperCase()} | ${incident.category} | ${incident.taskId || 'n/a'}`;
      li.appendChild(button);
      incidentsList.appendChild(li);
    });

    const selected = incidents.find((item) => item.id === selectedIncidentId) || incidents[0];
    const selectedTimeline = selected && selected.taskId
      ? getTaskTimeline(indexedWorld, selected.taskId).slice(-8)
      : [];
    incidentDetail.textContent = stringify({
      ...selected,
      timeline: selectedTimeline
    });
  }

  renderPanel();
  subscribeEventStream(() => {
    renderPanel();
  });
}
