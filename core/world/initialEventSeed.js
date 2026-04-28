const BOOT_TIMESTAMP = 1704067200000; // 2024-01-01T00:00:00.000Z (deterministic)

function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function createInitialEventSeed() {
  const desks = [
    { id: 'desk-0', deskIndex: 0, role: 'operator', x: 208, y: 182 },
    { id: 'desk-1', deskIndex: 1, role: 'operator', x: 348, y: 182 },
    { id: 'desk-2', deskIndex: 2, role: 'operator', x: 488, y: 182 }
  ];

  const agents = [
    { id: 'agent-julia-0', name: 'Julia', role: 'operator', deskId: 'desk-0' },
    { id: 'agent-julia-1', name: 'Julia', role: 'operator', deskId: 'desk-1' },
    { id: 'agent-julia-2', name: 'Julia', role: 'operator', deskId: 'desk-2' },
  ];

  const events = [];

  events.push({
    id: -1,
    type: 'SYSTEM_BOOT',
    timestamp: BOOT_TIMESTAMP,
    payload: {
      seedVersion: 1,
      source: 'initial_event_seed'
    }
  });

  for (let i = 0; i < desks.length; i += 1) {
    const desk = desks[i];
    events.push({
      id: -(2 + i),
      type: 'DESK_CREATED',
      timestamp: BOOT_TIMESTAMP + 10 + i,
      payload: {
        deskId: desk.id,
        deskIndex: desk.deskIndex,
        role: desk.role,
        position: {
          x: desk.x,
          y: desk.y
        }
      }
    });
  }

  for (let i = 0; i < agents.length; i += 1) {
    const agent = agents[i];
    events.push({
      id: -(2 + desks.length + i),
      type: 'AGENT_SPAWNED',
      timestamp: BOOT_TIMESTAMP + 100 + i,
      payload: {
        agentId: agent.id,
        name: agent.name,
        role: agent.role
      }
    });

    events.push({
      id: -(2 + desks.length + agents.length + i),
      type: 'AGENT_ASSIGNED_IDLE',
      timestamp: BOOT_TIMESTAMP + 200 + i,
      payload: {
        agentId: agent.id,
        deskId: agent.deskId,
        state: 'idle'
      }
    });
  }

  return deepClone(events);
}
