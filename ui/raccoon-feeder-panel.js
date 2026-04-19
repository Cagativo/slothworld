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

  function getGraphSnapshot() {
    if (window.controlAPI && typeof window.controlAPI.getGraph === 'function') {
      return window.controlAPI.getGraph();
    }
    return { nodes: [], edges: [], metadata: {} };
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
    const graph = getGraphSnapshot();
    const incidents = collectIncidents(graph)
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
}
