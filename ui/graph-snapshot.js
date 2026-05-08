export function getGraphSnapshot() {
  if (window.controlAPI && typeof window.controlAPI.getGraph === 'function') {
    return window.controlAPI.getGraph();
  }

  return { nodes: [], edges: [], metadata: {} };
}
