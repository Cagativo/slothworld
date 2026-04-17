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
  let selectedClusterType = null;

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

    const clusterType = target.dataset.clusterType;
    if (!clusterType) {
      return;
    }

    selectedClusterType = clusterType;
    renderPanel();
  });

  function renderPanel() {
    const indexedWorld = getIndexedWorldSnapshot();
    const incidents = getIncidentClusters(indexedWorld, {
      thresholdMs: STALLED_ACK_MS,
      now: Date.now(),
      includeSystemEvents: true
    })
      .sort((a, b) => {
        const diff = severityRank(b.severity) - severityRank(a.severity);
        if (diff !== 0) {
          return diff;
        }
        return String(a.type || '').localeCompare(String(b.type || ''));
      });

    if (!incidents.some((item) => item.type === selectedClusterType)) {
      selectedClusterType = incidents.length ? incidents[0].type : null;
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
      button.className = `rfp-item${incident.type === selectedClusterType ? ' is-selected' : ''}`;
      button.dataset.clusterType = incident.type;
      const taskCount = Array.isArray(incident.taskIds) ? incident.taskIds.length : 0;
      button.textContent = `${incident.type} | ${incident.severity.toUpperCase()} | tasks:${taskCount}`;
      li.appendChild(button);
      incidentsList.appendChild(li);
    });

    const selected = incidents.find((item) => item.type === selectedClusterType) || incidents[0];
    const selectedTaskId = selected && Array.isArray(selected.taskIds) && selected.taskIds.length
      ? selected.taskIds[0]
      : null;
    const selectedTimeline = selectedTaskId
      ? getTaskTimeline(indexedWorld, selectedTaskId).slice(-8)
      : [];
    incidentDetail.textContent = stringify({
      ...selected,
      expandedRepresentativeEvents: selected && Array.isArray(selected.representativeEvents)
        ? selected.representativeEvents
        : [],
      timeline: selectedTimeline
    });
  }

  renderPanel();
  subscribeEventStream(() => {
    renderPanel();
  });
}
