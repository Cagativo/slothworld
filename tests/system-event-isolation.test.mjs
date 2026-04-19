import test from 'node:test';
import assert from 'node:assert/strict';
import { SYSTEM_EVENTS } from '../core/world/eventTaxonomy.js';
import {
  getTaskStatus,
  getLifecycleEvents,
  getTaskTransitionTimestamps,
  getTaskTimeline
} from '../ui/selectors/taskSelectors.js';
import { assertNoSystemEventInLifecycleDerivation } from '../ui/selectors/eventTaxonomyInvariant.js';

/**
 * System Event Isolation Tests
 *
 * Verifies that system events (TASK_NOTIFICATION_SENT, TASK_NOTIFICATION_SKIPPED,
 * TASK_NOTIFICATION_FAILED) are completely excluded from lifecycle derivation and
 * do not alter the derived task status in any way.
 */

const TASK_ID = 'test-system-isolation-task';
let ts = 1000;
const tick = () => (ts += 100);

function makeEvent(type, taskId = TASK_ID) {
  return { type, taskId, timestamp: tick(), payload: {} };
}

/** Build an indexedWorld with a fixed lifecycle sequence + optional extra events. */
function buildIndexedWorld(taskId, lifecycleTypes, extraEvents = []) {
  const lifecycleEvents = lifecycleTypes.map((type) => makeEvent(type, taskId));
  const allEvents = [...lifecycleEvents, ...extraEvents];
  return {
    events: allEvents,
    eventsByTaskId: new Map([[taskId, allEvents]]),
    eventsByWorkerId: new Map()
  };
}

// ─── System events excluded from getLifecycleEvents ──────────────────────────

test('System events: getLifecycleEvents filters out all three system event types', () => {
  const events = [
    makeEvent('TASK_CREATED'),
    makeEvent('TASK_NOTIFICATION_SENT'),
    makeEvent('TASK_ENQUEUED'),
    makeEvent('TASK_NOTIFICATION_SKIPPED'),
    makeEvent('TASK_CLAIMED'),
    makeEvent('TASK_NOTIFICATION_FAILED')
  ];

  const lifecycle = getLifecycleEvents(events);

  assert.equal(lifecycle.length, 3, 'Only lifecycle events must be returned');
  for (const event of lifecycle) {
    assert.ok(
      !SYSTEM_EVENTS.includes(event.type),
      `System event "${event.type}" must not appear in lifecycle events`
    );
  }
});

test('System events: getLifecycleEvents with only system events returns empty array', () => {
  const events = SYSTEM_EVENTS.map((type) => makeEvent(type));
  const lifecycle = getLifecycleEvents(events);
  assert.equal(lifecycle.length, 0, 'All-system event list must yield no lifecycle events');
});

// ─── Lifecycle status unaffected by system events ─────────────────────────────

test('System events: TASK_NOTIFICATION_SENT does not change derived task status', () => {
  const world = buildIndexedWorld(TASK_ID, ['TASK_CREATED', 'TASK_ENQUEUED'], [
    makeEvent('TASK_NOTIFICATION_SENT')
  ]);
  const status = getTaskStatus(world, TASK_ID);
  assert.equal(status, 'queued', 'TASK_NOTIFICATION_SENT must not alter derived status');
});

test('System events: TASK_NOTIFICATION_SKIPPED does not change derived task status', () => {
  const world = buildIndexedWorld(TASK_ID, ['TASK_CREATED', 'TASK_ENQUEUED', 'TASK_CLAIMED'], [
    makeEvent('TASK_NOTIFICATION_SKIPPED')
  ]);
  const status = getTaskStatus(world, TASK_ID);
  assert.equal(status, 'claimed', 'TASK_NOTIFICATION_SKIPPED must not alter derived status');
});

test('System events: TASK_NOTIFICATION_FAILED does not change derived task status', () => {
  const world = buildIndexedWorld(
    TASK_ID,
    ['TASK_CREATED', 'TASK_ENQUEUED', 'TASK_CLAIMED', 'TASK_EXECUTE_STARTED', 'TASK_EXECUTE_FINISHED'],
    [makeEvent('TASK_NOTIFICATION_FAILED')]
  );
  const status = getTaskStatus(world, TASK_ID);
  assert.equal(status, 'awaiting_ack', 'TASK_NOTIFICATION_FAILED must not alter derived status');
});

test('System events: all three system events together do not change derived task status', () => {
  const systemEvents = SYSTEM_EVENTS.map((type) => makeEvent(type));
  const world = buildIndexedWorld(
    TASK_ID,
    ['TASK_CREATED', 'TASK_ENQUEUED', 'TASK_CLAIMED'],
    systemEvents
  );
  const status = getTaskStatus(world, TASK_ID);
  assert.equal(status, 'claimed', 'Mixed system events must not alter derived status');
});

test('System events: status derived from lifecycle-only events matches status with system events mixed in', () => {
  const lifecycleTypes = ['TASK_CREATED', 'TASK_ENQUEUED', 'TASK_CLAIMED', 'TASK_EXECUTE_STARTED'];
  const taskIdClean = 'test-clean';
  const taskIdMixed = 'test-mixed';

  ts = 2000;
  const worldClean = buildIndexedWorld(taskIdClean, lifecycleTypes);
  ts = 2000; // reset so timestamps are comparable
  const worldMixed = buildIndexedWorld(taskIdMixed, lifecycleTypes, SYSTEM_EVENTS.map((type) => makeEvent(type, taskIdMixed)));

  const statusClean = getTaskStatus(worldClean, taskIdClean);
  const statusMixed = getTaskStatus(worldMixed, taskIdMixed);

  assert.equal(statusMixed, statusClean, 'Derived status must be identical with or without system events in event list');
});

// ─── assertNoSystemEventInLifecycleDerivation invariant ──────────────────────

test('System events: assertNoSystemEventInLifecycleDerivation throws when a system event is present', () => {
  for (const type of SYSTEM_EVENTS) {
    const events = [makeEvent('TASK_CREATED'), makeEvent(type)];
    assert.throws(
      () => assertNoSystemEventInLifecycleDerivation(events, 'test-context'),
      (err) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /SYSTEM_EVENT_USED_IN_LIFECYCLE_DERIVATION/);
        assert.match(err.message, new RegExp(type));
        return true;
      },
      `assertNoSystemEventInLifecycleDerivation must throw for system event "${type}"`
    );
  }
});

test('System events: assertNoSystemEventInLifecycleDerivation does not throw for pure lifecycle events', () => {
  const events = ['TASK_CREATED', 'TASK_ENQUEUED', 'TASK_CLAIMED'].map((type) => makeEvent(type));
  assert.doesNotThrow(
    () => assertNoSystemEventInLifecycleDerivation(events, 'test-context'),
    'assertNoSystemEventInLifecycleDerivation must not throw for lifecycle-only events'
  );
});

// ─── Specific scenario: CREATED → ENQUEUED → CLAIMED → EXECUTE_FINISHED → ACKED ──

const TASK_SCENARIO = 'test-scenario-no-execute-started';

test('Scenario: CREATED→ENQUEUED→CLAIMED→EXECUTE_FINISHED→ACKED derives status "completed"', () => {
  // EXECUTE_STARTED is intentionally absent; the engine may ACK after EXECUTE_FINISHED
  // regardless. The selector must derive status solely from the events present.
  const world = buildIndexedWorld(TASK_SCENARIO, [
    'TASK_CREATED',
    'TASK_ENQUEUED',
    'TASK_CLAIMED',
    'TASK_EXECUTE_FINISHED',
    'TASK_ACKED'
  ]);
  // Inject payload.status into the ACKED event so the derivation resolves to 'completed'.
  world.eventsByTaskId.get(TASK_SCENARIO).at(-1).payload = { status: 'acknowledged' };

  const status = getTaskStatus(world, TASK_SCENARIO);
  assert.equal(status, 'completed', 'TASK_ACKED after EXECUTE_FINISHED must derive status "completed"');
});

test('Scenario: system events mixed into CREATED→ENQUEUED→CLAIMED→EXECUTE_FINISHED→ACKED do not change status', () => {
  const systemEvents = SYSTEM_EVENTS.map((type) => makeEvent(type, TASK_SCENARIO));
  const world = buildIndexedWorld(
    TASK_SCENARIO,
    ['TASK_CREATED', 'TASK_ENQUEUED', 'TASK_CLAIMED', 'TASK_EXECUTE_FINISHED', 'TASK_ACKED'],
    systemEvents
  );
  world.eventsByTaskId.get(TASK_SCENARIO)
    .find((e) => e.type === 'TASK_ACKED').payload = { status: 'acknowledged' };

  const status = getTaskStatus(world, TASK_SCENARIO);
  assert.equal(status, 'completed', 'System events must not alter the final "completed" status in this scenario');
});

test('Scenario: getLifecycleEvents for CREATED→ENQUEUED→CLAIMED→EXECUTE_FINISHED→ACKED with system events returns only the five lifecycle events', () => {
  const systemEvents = SYSTEM_EVENTS.map((type) => makeEvent(type, TASK_SCENARIO));
  const lifecycleTypes = ['TASK_CREATED', 'TASK_ENQUEUED', 'TASK_CLAIMED', 'TASK_EXECUTE_FINISHED', 'TASK_ACKED'];
  const world = buildIndexedWorld(TASK_SCENARIO, lifecycleTypes, systemEvents);

  const rawEvents = world.eventsByTaskId.get(TASK_SCENARIO);
  const lifecycleEvents = getLifecycleEvents(rawEvents);

  assert.equal(lifecycleEvents.length, 5, 'Must return exactly 5 lifecycle events (system events excluded)');
  assert.deepStrictEqual(
    lifecycleEvents.map((e) => e.type),
    lifecycleTypes,
    'Lifecycle event order and types must match the original sequence'
  );
});

// ─── TASK_NOTIFICATION_SENT and TASK_NOTIFICATION_FAILED: no impact on status or transitions ───

const TASK_NOTIF = 'test-notif-isolation';
const FULL_LIFECYCLE = [
  'TASK_CREATED',
  'TASK_ENQUEUED',
  'TASK_CLAIMED',
  'TASK_EXECUTE_STARTED',
  'TASK_EXECUTE_FINISHED',
  'TASK_ACKED'
];

function buildBaseWorld(taskId, extraEvents = []) {
  const world = buildIndexedWorld(taskId, FULL_LIFECYCLE, extraEvents);
  // Inject a valid ack payload so status resolves to 'completed'.
  world.eventsByTaskId.get(taskId)
    .find((e) => e.type === 'TASK_ACKED').payload = { status: 'acknowledged' };
  return world;
}

test('Notification events: TASK_NOTIFICATION_SENT does not change task status', () => {
  const clean = buildBaseWorld(TASK_NOTIF);
  const mixed = buildBaseWorld(TASK_NOTIF, [makeEvent('TASK_NOTIFICATION_SENT', TASK_NOTIF)]);

  assert.equal(
    getTaskStatus(mixed, TASK_NOTIF),
    getTaskStatus(clean, TASK_NOTIF),
    'TASK_NOTIFICATION_SENT must not alter derived task status'
  );
});

test('Notification events: TASK_NOTIFICATION_FAILED does not change task status', () => {
  const clean = buildBaseWorld(TASK_NOTIF);
  const mixed = buildBaseWorld(TASK_NOTIF, [makeEvent('TASK_NOTIFICATION_FAILED', TASK_NOTIF)]);

  assert.equal(
    getTaskStatus(mixed, TASK_NOTIF),
    getTaskStatus(clean, TASK_NOTIF),
    'TASK_NOTIFICATION_FAILED must not alter derived task status'
  );
});

function nonNullKeys(obj) {
  return Object.keys(obj).filter((k) => obj[k] !== null).sort();
}

test('Notification events: TASK_NOTIFICATION_SENT does not appear in transition timestamps', () => {
  const clean = buildBaseWorld(TASK_NOTIF);
  const mixed = buildBaseWorld(TASK_NOTIF, [makeEvent('TASK_NOTIFICATION_SENT', TASK_NOTIF)]);

  // Timestamps differ between worlds (shared tick counter) but the set of
  // populated transition slots must be identical — system events must not
  // cause any extra slot to become non-null.
  assert.deepStrictEqual(
    nonNullKeys(getTaskTransitionTimestamps(mixed, TASK_NOTIF)),
    nonNullKeys(getTaskTransitionTimestamps(clean, TASK_NOTIF)),
    'TASK_NOTIFICATION_SENT must not populate additional transition slots'
  );
});

test('Notification events: TASK_NOTIFICATION_FAILED does not appear in transition timestamps', () => {
  const clean = buildBaseWorld(TASK_NOTIF);
  const mixed = buildBaseWorld(TASK_NOTIF, [makeEvent('TASK_NOTIFICATION_FAILED', TASK_NOTIF)]);

  assert.deepStrictEqual(
    nonNullKeys(getTaskTransitionTimestamps(mixed, TASK_NOTIF)),
    nonNullKeys(getTaskTransitionTimestamps(clean, TASK_NOTIF)),
    'TASK_NOTIFICATION_FAILED must not populate additional transition slots'
  );
});

test('Notification events: TASK_NOTIFICATION_SENT does not appear in task timeline entries', () => {
  const mixed = buildBaseWorld(TASK_NOTIF, [makeEvent('TASK_NOTIFICATION_SENT', TASK_NOTIF)]);

  const timeline = getTaskTimeline(mixed, TASK_NOTIF);
  const types = timeline.map((e) => e.type);

  assert.ok(
    !types.includes('TASK_NOTIFICATION_SENT'),
    'TASK_NOTIFICATION_SENT must not appear in the task timeline'
  );
  assert.equal(timeline.length, FULL_LIFECYCLE.length, 'Timeline must contain only the lifecycle events');
});

test('Notification events: TASK_NOTIFICATION_FAILED does not appear in task timeline entries', () => {
  const mixed = buildBaseWorld(TASK_NOTIF, [makeEvent('TASK_NOTIFICATION_FAILED', TASK_NOTIF)]);

  const timeline = getTaskTimeline(mixed, TASK_NOTIF);
  const types = timeline.map((e) => e.type);

  assert.ok(
    !types.includes('TASK_NOTIFICATION_FAILED'),
    'TASK_NOTIFICATION_FAILED must not appear in the task timeline'
  );
  assert.equal(timeline.length, FULL_LIFECYCLE.length, 'Timeline must contain only the lifecycle events');
});

test('Notification events: both TASK_NOTIFICATION_SENT and TASK_NOTIFICATION_FAILED together leave status and transition slots unchanged', () => {
  const clean = buildBaseWorld(TASK_NOTIF);
  const mixed = buildBaseWorld(TASK_NOTIF, [
    makeEvent('TASK_NOTIFICATION_SENT', TASK_NOTIF),
    makeEvent('TASK_NOTIFICATION_FAILED', TASK_NOTIF)
  ]);

  assert.equal(
    getTaskStatus(mixed, TASK_NOTIF),
    getTaskStatus(clean, TASK_NOTIF),
    'Status must be identical with or without both notification events'
  );
  assert.deepStrictEqual(
    nonNullKeys(getTaskTransitionTimestamps(mixed, TASK_NOTIF)),
    nonNullKeys(getTaskTransitionTimestamps(clean, TASK_NOTIF)),
    'Populated transition slots must be identical with or without both notification events'
  );
});
