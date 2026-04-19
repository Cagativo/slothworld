import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIFECYCLE_EVENTS,
  isLifecycleEvent
} from '../core/world/eventTaxonomy.js';

/**
 * Event Taxonomy Strictness Tests
 *
 * Verifies that the canonical lifecycle event set is exactly the six
 * defined events, and that any unknown or malformed type is never
 * classified as a lifecycle event.
 */

const CANONICAL_LIFECYCLE_EVENTS = [
  'TASK_CREATED',
  'TASK_ENQUEUED',
  'TASK_CLAIMED',
  'TASK_EXECUTE_STARTED',
  'TASK_EXECUTE_FINISHED',
  'TASK_ACKED'
];

// ─── Canonical set completeness ───────────────────────────────────────────────

test('Taxonomy: LIFECYCLE_EVENTS contains exactly the six canonical event types', () => {
  assert.equal(
    LIFECYCLE_EVENTS.length,
    CANONICAL_LIFECYCLE_EVENTS.length,
    `Expected ${CANONICAL_LIFECYCLE_EVENTS.length} lifecycle events, got ${LIFECYCLE_EVENTS.length}`
  );

  for (const type of CANONICAL_LIFECYCLE_EVENTS) {
    assert.ok(
      LIFECYCLE_EVENTS.includes(type),
      `Canonical event ${type} must be present in LIFECYCLE_EVENTS`
    );
  }
});

test('Taxonomy: LIFECYCLE_EVENTS contains no extra entries beyond the canonical six', () => {
  const canonical = new Set(CANONICAL_LIFECYCLE_EVENTS);
  for (const type of LIFECYCLE_EVENTS) {
    assert.ok(
      canonical.has(type),
      `Non-canonical event type "${type}" must not be present in LIFECYCLE_EVENTS`
    );
  }
});

test('Taxonomy: LIFECYCLE_EVENTS is frozen and cannot be extended', () => {
  assert.ok(Object.isFrozen(LIFECYCLE_EVENTS), 'LIFECYCLE_EVENTS must be frozen');
  assert.throws(
    () => { LIFECYCLE_EVENTS.push('TASK_INJECTED'); },
    'Pushing to a frozen array must throw in strict mode'
  );
  assert.equal(
    LIFECYCLE_EVENTS.length,
    CANONICAL_LIFECYCLE_EVENTS.length,
    'LIFECYCLE_EVENTS length must not change after push attempt'
  );
});

// ─── Unknown types rejected ───────────────────────────────────────────────────

test('Taxonomy: unknown event type is not classified as a lifecycle event', () => {
  assert.equal(isLifecycleEvent('TASK_HACKED'), false);
});

test('Taxonomy: fabricated lifecycle-looking type is not classified as a lifecycle event', () => {
  const lookalikes = [
    'TASK_EXECUTED',        // plausible but non-canonical
    'TASK_COMPLETE',
    'TASK_FAILED',
    'TASK_REJECTED',
    'TASK_ENQUEUED_AGAIN',
    'TASK_CLAIMED_BY_WORKER',
    'TASK_EXECUTE_SKIPPED_IDEMPOTENT', // engine-internal, not lifecycle
    'TASK_REQUEUED',
    'TASK_ACK_SIDE_EFFECT_FAILED'
  ];

  for (const type of lookalikes) {
    assert.equal(
      isLifecycleEvent(type),
      false,
      `"${type}" must not be classified as a lifecycle event`
    );
  }
});

test('Taxonomy: lowercase variants of canonical events are not lifecycle events', () => {
  for (const type of CANONICAL_LIFECYCLE_EVENTS) {
    assert.equal(
      isLifecycleEvent(type.toLowerCase()),
      false,
      `Lowercase "${type.toLowerCase()}" must not be a lifecycle event`
    );
  }
});

test('Taxonomy: empty string is not a lifecycle event', () => {
  assert.equal(isLifecycleEvent(''), false);
});

test('Taxonomy: null and undefined are not lifecycle events', () => {
  assert.equal(isLifecycleEvent(null), false);
  assert.equal(isLifecycleEvent(undefined), false);
});

test('Taxonomy: numeric and object inputs are not lifecycle events', () => {
  assert.equal(isLifecycleEvent(42), false);
  assert.equal(isLifecycleEvent({}), false);
  assert.equal(isLifecycleEvent([]), false);
});

test('Taxonomy: whitespace-padded canonical names are not lifecycle events', () => {
  for (const type of CANONICAL_LIFECYCLE_EVENTS) {
    assert.equal(isLifecycleEvent(` ${type}`), false, `Leading-space variant of "${type}" must not match`);
    assert.equal(isLifecycleEvent(`${type} `), false, `Trailing-space variant of "${type}" must not match`);
  }
});

// ─── Canonical events each pass ───────────────────────────────────────────────

test('Taxonomy: each canonical lifecycle event is recognised by isLifecycleEvent', () => {
  for (const type of CANONICAL_LIFECYCLE_EVENTS) {
    assert.equal(
      isLifecycleEvent(type),
      true,
      `Canonical event "${type}" must be recognised as a lifecycle event`
    );
  }
});
