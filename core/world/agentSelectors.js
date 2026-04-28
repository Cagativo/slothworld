/**
 * agentSelectors.js
 *
 * Derives agent snapshots from indexed world state.
 *
 * CONTRACT:
 *  - Input:  worldState from deriveWorldState() — { events, eventsByTaskId, eventsByWorkerId }
 *  - Output: Array of agent snapshots consumed by buildVisualWorldGraph()
 *
 * RULES:
 *  - Reads only from eventsByWorkerId (the pre-built index — no raw event scanning)
 *  - No lifecycle logic beyond reading the last known state per agent
 *  - No UI access, no rendering, no side effects
 */

const EVT_SPAWNED       = 'AGENT_SPAWNED';
const EVT_ASSIGNED_IDLE = 'AGENT_ASSIGNED_IDLE';

/**
 * @typedef {{ id: string, name: string|null, role: string, state: string, deskId: string|null, currentTaskId: string|null }} AgentSnapshot
 */

/**
 * Return one snapshot per agent found in eventsByWorkerId.
 * Only agents with a confirmed AGENT_SPAWNED event are included.
 *
 * @param {{ eventsByWorkerId: Map<string, Array> }} worldState
 * @returns {AgentSnapshot[]}
 */
export function getAllAgents(worldState) {
  const index = worldState && worldState.eventsByWorkerId;
  if (!(index instanceof Map)) return [];

  const snapshots = [];

  for (const [agentId, events] of index) {
    let name  = null;
    let role  = null;
    let state = 'idle';
    let deskId = null;

    for (const event of events) {
      const p = (event && event.payload) || {};

      if (event.type === EVT_SPAWNED) {
        if (p.name  != null) name  = p.name;
        if (p.role  != null) role  = p.role;
      }

      if (event.type === EVT_ASSIGNED_IDLE) {
        if (p.state  != null) state  = p.state;
        if (p.deskId != null) deskId = p.deskId;
      }
    }

    // Exclude entries that never produced a spawn event (e.g. task-indexed workers)
    if (role === null) continue;

    snapshots.push({ id: agentId, name, role, state, deskId, currentTaskId: null });
  }

  return snapshots;
}
