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

import { getGraphSnapshot } from './graph-snapshot.js';


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

function collectIncidents(graph) {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const byType = new Map();
  for (const node of nodes) {
    const nodeIncidents = node && node.metadata && Array.isArray(node.metadata.incidents)
      ? node.metadata.incidents
      : [];
    for (const inc of nodeIncidents) {
      if (!inc || !inc.clusterType) { continue; }
      if (!byType.has(inc.clusterType)) {
        byType.set(inc.clusterType, { type: inc.clusterType, severity: inc.severity || 'low', taskIds: [] });
      }
      const cluster = byType.get(inc.clusterType);
      if (node.id && !cluster.taskIds.includes(node.id)) {
        cluster.taskIds.push(node.id);
      }
      if (severityRank(inc.severity) > severityRank(cluster.severity)) {
        cluster.severity = inc.severity;
      }
    }
  }
  return Array.from(byType.values());
}

function getLeftUiMode() {
  return document.body.dataset.leftUiMode === 'debug' ? 'debug' : 'normal';
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
      <div class="rfp-summary" data-detail="summary">No incidents.</div>
      <ul class="rfp-list" data-list="incidents"></ul>
      <pre class="rfp-detail ui-debug-only" data-detail="incident">Select an incident to inspect details.</pre>
    </section>
  `;

  const panelStack = document.getElementById('control-panels-stack');
  if (panelStack) {
    panelStack.appendChild(panel);
  } else {
    document.body.appendChild(panel);
  }

  const incidentsList = panel.querySelector('[data-list="incidents"]');
  const summaryDetail = panel.querySelector('[data-detail="summary"]');
  const incidentDetail = panel.querySelector('[data-detail="incident"]');
  let selectedClusterType = null;

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
    const mode = getLeftUiMode();
    panel.dataset.uiMode = mode;

    const graph = getGraphSnapshot();
    const incidents = collectIncidents(graph)
      .sort((a, b) => {
        const diff = severityRank(b.severity) - severityRank(a.severity);
        if (diff !== 0) {
          return diff;
        }
        return String(a.type || '').localeCompare(String(b.type || ''));
      });

    panel.style.display = mode === 'normal' && incidents.length === 0 ? 'none' : '';

    if (!incidents.some((item) => item.type === selectedClusterType)) {
      selectedClusterType = incidents.length ? incidents[0].type : null;
    }

    if (summaryDetail) {
      const counts = incidents.reduce((acc, incident) => {
        const severity = String(incident.severity || 'low').toLowerCase();
        if (severity === 'high') {
          acc.high += 1;
        } else if (severity === 'medium') {
          acc.medium += 1;
        } else {
          acc.low += 1;
        }
        return acc;
      }, { high: 0, medium: 0, low: 0 });

      summaryDetail.textContent = incidents.length
        ? `Clusters ${incidents.length} | High ${counts.high} | Medium ${counts.medium} | Low ${counts.low}`
        : 'No incidents.';
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
      ? getGraphSnapshot().edges.filter((e) => e.taskId === selectedTaskId).slice(-8).map((e) => ({
          from: e.from,
          to: e.to,
          fromAt: e.fromAt,
          toAt: e.toAt
        }))
      : [];
    incidentDetail.textContent = stringify({
      type: selected.type,
      severity: selected.severity,
      taskIds: selected.taskIds,
      timeline: selectedTimeline
    });
  }

  renderPanel();
  window.addEventListener('slothworld:graph', () => {
    renderPanel();
  });
  window.addEventListener('slothworld:ui-mode', () => {
    renderPanel();
  });
}
