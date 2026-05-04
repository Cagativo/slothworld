/**
 * world-zone-mapper.test.mjs
 *
 * Tests for:
 *  - WORLD_ZONES config completeness and immutability
 *  - placeEntityInWorldZone determinism
 *  - Projection boundary: mapper never inspects raw event payloads or world indexes
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { WORLD_ZONES, WORLD_ZONE_IDS } from '../ui/config/worldZones.js';
import { placeEntityInWorldZone } from '../ui/config/worldZoneMapper.js';
import {
  TASK_TYPE_DISCORD,
  TASK_TYPE_SHOPIFY,
  TASK_TYPE_IMAGE_RENDER,
  TASK_TYPE_TREND_RESEARCH,
} from '../core/constants.js';

// ---------------------------------------------------------------------------
// WORLD_ZONES config
// ---------------------------------------------------------------------------

test('WORLD_ZONES: all 9 required named zones are present', () => {
  const required = [
    'intakeDesk', 'engineCrystal', 'researchDesk', 'shopifyDesk',
    'renderDesk', 'supportDesk', 'approvalDesk', 'anomalyShelf', 'archiveLibrary',
  ];
  for (const id of required) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(WORLD_ZONES, id),
      `WORLD_ZONES must contain zone '${id}'`
    );
  }
});

test('WORLD_ZONES: WORLD_ZONE_IDS enumerates all zone ids', () => {
  assert.deepStrictEqual(
    [...WORLD_ZONE_IDS].sort(),
    Object.keys(WORLD_ZONES).sort()
  );
});

test('WORLD_ZONES: every zone has a string id matching its key', () => {
  for (const [key, zone] of Object.entries(WORLD_ZONES)) {
    assert.strictEqual(typeof zone.id, 'string', `zone '${key}' must have string id`);
    assert.strictEqual(zone.id, key, `zone id must match its key ('${key}')`);
  }
});

test('WORLD_ZONES: every zone has finite numeric position coordinates', () => {
  for (const [key, zone] of Object.entries(WORLD_ZONES)) {
    assert.ok(
      Number.isFinite(zone.position.x) && Number.isFinite(zone.position.y),
      `zone '${key}' must have finite x and y position`
    );
  }
});

test('WORLD_ZONES: every zone has positive numeric size', () => {
  for (const [key, zone] of Object.entries(WORLD_ZONES)) {
    assert.ok(
      Number.isFinite(zone.size.width)  && zone.size.width  > 0 &&
      Number.isFinite(zone.size.height) && zone.size.height > 0,
      `zone '${key}' must have positive width and height`
    );
  }
});

test('WORLD_ZONES: config object is frozen (immutable)', () => {
  assert.ok(Object.isFrozen(WORLD_ZONES), 'WORLD_ZONES must be frozen');
  for (const [key, zone] of Object.entries(WORLD_ZONES)) {
    assert.ok(Object.isFrozen(zone),          `zone '${key}' must be frozen`);
    assert.ok(Object.isFrozen(zone.position), `zone '${key}'.position must be frozen`);
    assert.ok(Object.isFrozen(zone.size),     `zone '${key}'.size must be frozen`);
  }
});

test('WORLD_ZONES: mutation of config throws in strict mode', () => {
  assert.throws(
    () => { WORLD_ZONES.intakeDesk = {}; },
    TypeError,
    'assigning to a frozen property must throw TypeError'
  );
});

// ---------------------------------------------------------------------------
// placeEntityInWorldZone — output contract
// ---------------------------------------------------------------------------

test('placeEntityInWorldZone: returns an object with zoneId string and position {x,y}', () => {
  const result = placeEntityInWorldZone({ type: 'task', status: 'created', taskType: null });
  assert.strictEqual(typeof result.zoneId, 'string');
  assert.ok(Number.isFinite(result.position.x), 'position.x must be finite');
  assert.ok(Number.isFinite(result.position.y), 'position.y must be finite');
});

test('placeEntityInWorldZone: zoneId always maps to a known WORLD_ZONES entry', () => {
  const cases = [
    { type: 'task',   status: 'created',       taskType: null },
    { type: 'task',   status: 'queued',         taskType: TASK_TYPE_SHOPIFY },
    { type: 'task',   status: 'claimed',        taskType: TASK_TYPE_TREND_RESEARCH },
    { type: 'task',   status: 'executing',      taskType: TASK_TYPE_IMAGE_RENDER },
    { type: 'task',   status: 'awaiting_ack',   taskType: null },
    { type: 'task',   status: 'completed',      taskType: null },
    { type: 'task',   status: 'failed',         taskType: null },
    { type: 'worker', status: 'idle',           taskType: null },
    { type: 'worker', status: 'working',        taskType: TASK_TYPE_DISCORD },
    { type: 'worker', status: 'delivering',     taskType: null },
    { type: 'worker', status: 'error',          taskType: null },
  ];
  for (const entity of cases) {
    const { zoneId } = placeEntityInWorldZone(entity);
    assert.ok(
      Object.prototype.hasOwnProperty.call(WORLD_ZONES, zoneId),
      `zoneId '${zoneId}' for ${JSON.stringify(entity)} must exist in WORLD_ZONES`
    );
  }
});

test('placeEntityInWorldZone: position matches the declared zone coordinates', () => {
  for (const [, zone] of Object.entries(WORLD_ZONES)) {
    // Fabricate an entity that should land in this zone and verify position matches.
    // We test all task statuses and all task types to cover every branch.
    const taskStatusToZone = {
      created:     'intakeDesk',
      queued:      'intakeDesk',
      unknown:     'intakeDesk',
      awaiting_ack: 'approvalDesk',
      completed:   'archiveLibrary',
      acknowledged: 'archiveLibrary',
      failed:      'anomalyShelf',
    };
    for (const [status, expectedZoneId] of Object.entries(taskStatusToZone)) {
      if (expectedZoneId !== zone.id) continue;
      const { position } = placeEntityInWorldZone({ type: 'task', status, taskType: null });
      assert.strictEqual(position.x, zone.position.x, `x for status '${status}' must equal zone x`);
      assert.strictEqual(position.y, zone.position.y, `y for status '${status}' must equal zone y`);
    }
  }
});

// ---------------------------------------------------------------------------
// placeEntityInWorldZone — determinism
// ---------------------------------------------------------------------------

test('placeEntityInWorldZone: same input always produces identical output (determinism)', () => {
  const cases = [
    { type: 'task',   status: 'created',       taskType: null },
    { type: 'task',   status: 'queued',        taskType: null },
    { type: 'task',   status: 'claimed',       taskType: TASK_TYPE_TREND_RESEARCH },
    { type: 'task',   status: 'executing',     taskType: TASK_TYPE_SHOPIFY },
    { type: 'task',   status: 'awaiting_ack',  taskType: null },
    { type: 'task',   status: 'acknowledged',  taskType: null },
    { type: 'task',   status: 'done',          taskType: null },
    { type: 'task',   status: 'completed',     taskType: null },
    { type: 'task',   status: 'failed',        taskType: null },
    { type: 'worker', status: 'idle',          taskType: null },
    { type: 'worker', status: 'working',       taskType: TASK_TYPE_IMAGE_RENDER },
    { type: 'worker', status: 'delivering',    taskType: null },
  ];
  for (const entity of cases) {
    const first  = placeEntityInWorldZone(entity);
    const second = placeEntityInWorldZone(entity);
    assert.deepStrictEqual(first, second,
      `placeEntityInWorldZone must return identical output for input ${JSON.stringify(entity)}`);
  }
});

test('placeEntityInWorldZone: output does not share object references with WORLD_ZONES', () => {
  const result = placeEntityInWorldZone({ type: 'task', status: 'created', taskType: null });
  const zone   = WORLD_ZONES.intakeDesk;
  assert.notStrictEqual(result.position, zone.position,
    'returned position must be a new object, not the frozen zone reference');
});

// ---------------------------------------------------------------------------
// placeEntityInWorldZone — task type routing
// ---------------------------------------------------------------------------

const TASK_TYPE_ZONE_PAIRS = [
  [TASK_TYPE_TREND_RESEARCH, 'researchDesk'],
  [TASK_TYPE_SHOPIFY,        'shopifyDesk'],
  [TASK_TYPE_IMAGE_RENDER,   'renderDesk'],
  [TASK_TYPE_DISCORD,        'supportDesk'],
];

test('placeEntityInWorldZone: claimed tasks route to the correct type-specific desk', () => {
  for (const [taskType, expectedZoneId] of TASK_TYPE_ZONE_PAIRS) {
    const { zoneId } = placeEntityInWorldZone({ type: 'task', status: 'claimed', taskType });
    assert.strictEqual(zoneId, expectedZoneId,
      `claimed task of type '${taskType}' must route to '${expectedZoneId}'`);
  }
});

test('placeEntityInWorldZone: executing tasks route to same desk as claimed tasks', () => {
  for (const [taskType, expectedZoneId] of TASK_TYPE_ZONE_PAIRS) {
    const { zoneId } = placeEntityInWorldZone({ type: 'task', status: 'executing', taskType });
    assert.strictEqual(zoneId, expectedZoneId,
      `executing task of type '${taskType}' must route to '${expectedZoneId}'`);
  }
});

test('placeEntityInWorldZone: claimed task with unknown type falls back to engineCrystal', () => {
  const { zoneId } = placeEntityInWorldZone({ type: 'task', status: 'claimed', taskType: 'UNKNOWN_TYPE' });
  assert.strictEqual(zoneId, 'engineCrystal');
});

test('placeEntityInWorldZone: claimed task with null taskType falls back to engineCrystal', () => {
  const { zoneId } = placeEntityInWorldZone({ type: 'task', status: 'claimed', taskType: null });
  assert.strictEqual(zoneId, 'engineCrystal');
});

// ---------------------------------------------------------------------------
// placeEntityInWorldZone — exhaustive task lifecycle routing
// Covers every status currently emitted by the engine/app.
// ---------------------------------------------------------------------------

const ALL_TASK_STATUS_ROUTES = [
  // Intake / pre-execution
  { status: 'created',      expectedZoneId: 'intakeDesk'    },
  { status: 'queued',       expectedZoneId: 'intakeDesk'    },
  // Active execution (type-neutral; type-specific routing is covered separately)
  { status: 'claimed',      expectedZoneId: 'engineCrystal' },
  { status: 'executing',    expectedZoneId: 'engineCrystal' },
  // Awaiting acknowledgment
  { status: 'awaiting_ack', expectedZoneId: 'approvalDesk'  },
  // Terminal: archive
  { status: 'acknowledged', expectedZoneId: 'archiveLibrary' },
  { status: 'done',         expectedZoneId: 'archiveLibrary' },
  { status: 'completed',    expectedZoneId: 'archiveLibrary' },
  // Terminal: anomaly
  { status: 'failed',       expectedZoneId: 'anomalyShelf'  },
];

test('placeEntityInWorldZone: all engine task statuses route to the correct zone (null taskType)', () => {
  for (const { status, expectedZoneId } of ALL_TASK_STATUS_ROUTES) {
    const { zoneId } = placeEntityInWorldZone({ type: 'task', status, taskType: null });
    assert.strictEqual(zoneId, expectedZoneId,
      `task status '${status}' must route to '${expectedZoneId}', got '${zoneId}'`);
  }
});

test('placeEntityInWorldZone: task status "done" → archiveLibrary', () => {
  const { zoneId } = placeEntityInWorldZone({ type: 'task', status: 'done', taskType: null });
  assert.strictEqual(zoneId, 'archiveLibrary');
});

test('placeEntityInWorldZone: terminal archive statuses (acknowledged, done, completed) all map to archiveLibrary', () => {
  for (const status of ['acknowledged', 'done', 'completed']) {
    const { zoneId } = placeEntityInWorldZone({ type: 'task', status, taskType: null });
    assert.strictEqual(zoneId, 'archiveLibrary',
      `status '${status}' must map to archiveLibrary`);
  }
});

// ---------------------------------------------------------------------------
// placeEntityInWorldZone — worker routing
// ---------------------------------------------------------------------------

test('placeEntityInWorldZone: idle worker → engineCrystal', () => {
  const { zoneId } = placeEntityInWorldZone({ type: 'worker', status: 'idle', taskType: null });
  assert.strictEqual(zoneId, 'engineCrystal');
});

test('placeEntityInWorldZone: moving worker → engineCrystal', () => {
  const { zoneId } = placeEntityInWorldZone({ type: 'worker', status: 'moving', taskType: null });
  assert.strictEqual(zoneId, 'engineCrystal');
});

test('placeEntityInWorldZone: sitting worker → engineCrystal', () => {
  const { zoneId } = placeEntityInWorldZone({ type: 'worker', status: 'sitting', taskType: null });
  assert.strictEqual(zoneId, 'engineCrystal');
});

test('placeEntityInWorldZone: delivering worker → approvalDesk', () => {
  const { zoneId } = placeEntityInWorldZone({ type: 'worker', status: 'delivering', taskType: null });
  assert.strictEqual(zoneId, 'approvalDesk');
});

test('placeEntityInWorldZone: error worker → anomalyShelf', () => {
  const { zoneId } = placeEntityInWorldZone({ type: 'worker', status: 'error', taskType: null });
  assert.strictEqual(zoneId, 'anomalyShelf');
});

test('placeEntityInWorldZone: working worker routes to task-type desk', () => {
  for (const [taskType, expectedZoneId] of TASK_TYPE_ZONE_PAIRS) {
    const { zoneId } = placeEntityInWorldZone({ type: 'worker', status: 'working', taskType });
    assert.strictEqual(zoneId, expectedZoneId,
      `working worker of type '${taskType}' must route to '${expectedZoneId}'`);
  }
});

// ---------------------------------------------------------------------------
// placeEntityInWorldZone — boundary: no raw event payload access
// ---------------------------------------------------------------------------

test('placeEntityInWorldZone: does not read .payload fields from the entity descriptor', () => {
  // The descriptor must not need a payload field to resolve the zone.
  // We pass an entity with an explicit payload-like field and verify it is ignored.
  const withPayload = {
    type: 'task',
    status: 'created',
    taskType: null,
    payload: { status: 'completed', taskId: 'x', workerId: 'y', error: 'z' },
  };
  const { zoneId } = placeEntityInWorldZone(withPayload);
  // Must resolve based on the descriptor's `status`, not the nested payload.
  assert.strictEqual(zoneId, 'intakeDesk',
    'mapper must use entity.status, not entity.payload.status');
});

test('placeEntityInWorldZone: does not read .events or .eventsByTaskId fields', () => {
  // Pass a descriptor carrying spurious world-index fields; they must be ignored.
  const withWorldIndex = {
    type:    'task',
    status:  'awaiting_ack',
    taskType: null,
    events:            [{ type: 'TASK_CREATED' }],
    eventsByTaskId:    new Map([['t1', []]]),
    eventsByWorkerId:  new Map(),
  };
  const { zoneId } = placeEntityInWorldZone(withWorldIndex);
  assert.strictEqual(zoneId, 'approvalDesk',
    'mapper must use descriptor fields only, ignoring world index structures');
});

test('placeEntityInWorldZone: gracefully handles null or missing entity', () => {
  // Must return a valid default rather than throwing.
  const fromNull = placeEntityInWorldZone(null);
  assert.strictEqual(typeof fromNull.zoneId, 'string');
  assert.ok(Number.isFinite(fromNull.position.x));
  assert.ok(Number.isFinite(fromNull.position.y));

  const fromEmpty = placeEntityInWorldZone({});
  assert.strictEqual(typeof fromEmpty.zoneId, 'string');
  assert.ok(Number.isFinite(fromEmpty.position.x));
  assert.ok(Number.isFinite(fromEmpty.position.y));
});

// ---------------------------------------------------------------------------
// Projection boundary: worldZoneMapper source must not reference forbidden APIs
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT       = fileURLToPath(new URL('..', import.meta.url));
const MAPPER_SRC = readFileSync(join(ROOT, 'ui/config/worldZoneMapper.js'), 'utf8');
const ZONES_SRC  = readFileSync(join(ROOT, 'ui/config/worldZones.js'), 'utf8');

function isComment(line) {
  return /^\s*(\*|\/\/)/.test(line);
}

test('worldZoneMapper.js: does not import from ui/selectors/', () => {
  const hits = MAPPER_SRC.split('\n')
    .filter((line) => /import\s.*from\s+['"`][^'"`]*selectors[/\\][^'"`]*['"`]/.test(line) && !isComment(line));
  assert.deepStrictEqual(hits, [],
    'worldZoneMapper.js must not import from selectors — accepts pre-computed descriptors only');
});

test('worldZoneMapper.js: does not import deriveWorldState or getRawEvents', () => {
  const hits = MAPPER_SRC.split('\n')
    .filter((line) => /import.*\b(deriveWorldState|getRawEvents)\b/.test(line) && !isComment(line));
  assert.deepStrictEqual(hits, [],
    'worldZoneMapper.js must not import world-indexing helpers');
});

test('worldZoneMapper.js: does not access .eventsByTaskId or .eventsByWorkerId', () => {
  const hits = MAPPER_SRC.split('\n')
    .filter((line) => /\.\s*(eventsByTaskId|eventsByWorkerId)\b/.test(line) && !isComment(line));
  assert.deepStrictEqual(hits, [],
    'worldZoneMapper.js must not access raw world index structures');
});

test('worldZoneMapper.js: does not branch on canonical event type string literals', () => {
  const CANONICAL = [
    'TASK_CREATED', 'TASK_ENQUEUED', 'TASK_CLAIMED',
    'TASK_EXECUTE_STARTED', 'TASK_EXECUTE_FINISHED', 'TASK_ACKED',
  ];
  const re = new RegExp(`['"\`](${CANONICAL.join('|')})['"\`]`);
  const hits = MAPPER_SRC.split('\n')
    .filter((line) => re.test(line) && !isComment(line));
  assert.deepStrictEqual(hits, [],
    'worldZoneMapper.js must not compare against canonical event type strings');
});

test('worldZones.js: does not import from rendering/ or selectors/', () => {
  const hits = ZONES_SRC.split('\n')
    .filter((line) => /import\s.*from\s+['"`][^'"`]*(rendering\/|selectors\/)[^'"`]*['"`]/.test(line) && !isComment(line));
  assert.deepStrictEqual(hits, [],
    'worldZones.js must not import from rendering/ or selectors/ — pure config only');
});
