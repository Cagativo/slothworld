/**
 * worldZoneMapper.js
 *
 * Pure placement function: maps selector-derived entity descriptors to named
 * Slothworld zones defined in worldZones.js.
 *
 * PROJECTION BOUNDARY (enforced by tests):
 *  - Input MUST be a selector-derived entity descriptor — never raw events.
 *  - The descriptor carries only pre-computed fields: { type, status, taskType }.
 *  - This function MUST NOT read event payloads, event arrays, or world indexes.
 *  - Output is always { zoneId: string, position: { x: number, y: number } }.
 *  - The same input always produces the same output (pure / referentially transparent).
 *
 * Entity descriptor shapes:
 *  Task:   { type: 'task',   status: string, taskType: string | null }
 *  Worker: { type: 'worker', status: string, taskType: string | null }
 *
 *  status for tasks  — one of: created, queued, claimed, executing,
 *                               awaiting_ack, completed, failed, unknown
 *  status for workers — one of: idle, moving, sitting, working, delivering, error
 *  taskType          — TASK_TYPE_* constant from core/constants.js, or null
 */

import { WORLD_ZONES } from './worldZones.js';
import {
  TASK_TYPE_DISCORD,
  TASK_TYPE_SHOPIFY,
  TASK_TYPE_IMAGE_RENDER,
  TASK_TYPE_TREND_RESEARCH,
} from '../../core/constants.js';

// ---------------------------------------------------------------------------
// Task type → claimed-state zone
// One desk per work domain; unknown types fall back to engineCrystal.
// ---------------------------------------------------------------------------

const TASK_TYPE_ACTIVE_ZONE = Object.freeze({
  [TASK_TYPE_TREND_RESEARCH]: 'researchDesk',
  [TASK_TYPE_SHOPIFY]:        'shopifyDesk',
  [TASK_TYPE_IMAGE_RENDER]:   'renderDesk',
  [TASK_TYPE_DISCORD]:        'supportDesk',
});

// ---------------------------------------------------------------------------
// Internal resolvers — no event access, no payload inspection
// ---------------------------------------------------------------------------

function resolveTaskZoneId(status, taskType) {
  if (status === 'created' || status === 'queued' || status === 'unknown') {
    return 'intakeDesk';
  }

  if (status === 'claimed' || status === 'executing') {
    return TASK_TYPE_ACTIVE_ZONE[taskType] || 'engineCrystal';
  }

  if (status === 'awaiting_ack') {
    return 'approvalDesk';
  }

  if (status === 'failed') {
    return 'anomalyShelf';
  }

  if (status === 'completed' || status === 'acknowledged') {
    return 'archiveLibrary';
  }

  return 'intakeDesk';
}

function resolveWorkerZoneId(status, taskType) {
  if (status === 'working') {
    return TASK_TYPE_ACTIVE_ZONE[taskType] || 'engineCrystal';
  }

  if (status === 'delivering') {
    return 'approvalDesk';
  }

  if (status === 'error') {
    return 'anomalyShelf';
  }

  // idle, moving, sitting → central hub
  return 'engineCrystal';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Map a selector-derived entity descriptor to a named world zone and position.
 *
 * @param {{ type: string, status: string, taskType?: string | null }} entity
 * @returns {{ zoneId: string, position: { x: number, y: number } }}
 */
export function placeEntityInWorldZone(entity) {
  const type     = entity && typeof entity.type   === 'string' ? entity.type   : '';
  const status   = entity && typeof entity.status === 'string' ? entity.status : '';
  const taskType = entity && entity.taskType != null ? String(entity.taskType) : null;

  let zoneId;
  if (type === 'task') {
    zoneId = resolveTaskZoneId(status, taskType);
  } else if (type === 'worker') {
    zoneId = resolveWorkerZoneId(status, taskType);
  } else {
    zoneId = 'intakeDesk';
  }

  const zone = WORLD_ZONES[zoneId] || WORLD_ZONES.intakeDesk;

  return {
    zoneId:   zone.id,
    position: { x: zone.position.x, y: zone.position.y },
  };
}
