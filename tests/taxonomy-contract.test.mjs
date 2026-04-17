/**
 * Taxonomy Contract
 *
 * Architecture gate: enforces strict classification of lifecycle vs system events
 * and fail-fast behavior for unknown event types in strict mode.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  LIFECYCLE_EVENTS,
  SYSTEM_EVENTS,
  isLifecycleEvent,
  isSystemEvent
} from '../core/world/eventTaxonomy.js';

// ─── A. Lifecycle classification ─────────────────────────────────────────────

test('LIFECYCLE_EVENTS contains exactly the six canonical lifecycle types', () => {
  const expected = [
    'TASK_CREATED',
    'TASK_ENQUEUED',
    'TASK_CLAIMED',
    'TASK_EXECUTE_STARTED',
    'TASK_EXECUTE_FINISHED',
    'TASK_ACKED'
  ];
  assert.deepEqual([...LIFECYCLE_EVENTS].sort(), expected.sort());
});

test('isLifecycleEvent returns true for each canonical lifecycle type', () => {
  for (const type of LIFECYCLE_EVENTS) {
    assert.equal(isLifecycleEvent(type), true, `${type} must be lifecycle`);
  }
});

test('isLifecycleEvent returns false for system event types', () => {
  for (const type of SYSTEM_EVENTS) {
    assert.equal(isLifecycleEvent(type), false, `${type} must not be lifecycle`);
  }
});

test('isLifecycleEvent returns false for non-string inputs', () => {
  assert.equal(isLifecycleEvent(null), false);
  assert.equal(isLifecycleEvent(undefined), false);
  assert.equal(isLifecycleEvent(42), false);
  assert.equal(isLifecycleEvent({}), false);
});

// ─── B. System classification ─────────────────────────────────────────────────

test('SYSTEM_EVENTS contains exactly the three canonical notification types', () => {
  const expected = [
    'TASK_NOTIFICATION_SENT',
    'TASK_NOTIFICATION_SKIPPED',
    'TASK_NOTIFICATION_FAILED'
  ];
  assert.deepEqual([...SYSTEM_EVENTS].sort(), expected.sort());
});

test('isSystemEvent returns true for each canonical system type', () => {
  for (const type of SYSTEM_EVENTS) {
    assert.equal(isSystemEvent(type), true, `${type} must be system`);
  }
});

test('isSystemEvent returns false for lifecycle event types', () => {
  for (const type of LIFECYCLE_EVENTS) {
    assert.equal(isSystemEvent(type), false, `${type} must not be system`);
  }
});

test('isSystemEvent returns false for non-string inputs', () => {
  assert.equal(isSystemEvent(null), false);
  assert.equal(isSystemEvent(undefined), false);
  assert.equal(isSystemEvent(42), false);
});

// ─── C. Exclusivity rule ──────────────────────────────────────────────────────

test('no event type is both lifecycle and system', () => {
  for (const type of LIFECYCLE_EVENTS) {
    assert.equal(
      isLifecycleEvent(type) && isSystemEvent(type),
      false,
      `${type} must not be both lifecycle and system`
    );
  }
  for (const type of SYSTEM_EVENTS) {
    assert.equal(
      isLifecycleEvent(type) && isSystemEvent(type),
      false,
      `${type} must not be both lifecycle and system`
    );
  }
});

test('LIFECYCLE_EVENTS and SYSTEM_EVENTS have no overlap', () => {
  const lifecycleSet = new Set(LIFECYCLE_EVENTS);
  for (const type of SYSTEM_EVENTS) {
    assert.equal(lifecycleSet.has(type), false, `${type} must not be in both sets`);
  }
});

// ─── D. Strict mode behavior ──────────────────────────────────────────────────

test('unknown event type throws when SLOTHWORLD_STRICT_EVENT_TAXONOMY=1', () => {
  const script = [
    "import { isLifecycleEvent } from './core/world/eventTaxonomy.js';",
    "isLifecycleEvent('TASK_UNKNOWN_STRICT_TAXONOMY_CONTRACT');"
  ].join('\n');

  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: process.cwd(),
    env: { ...process.env, SLOTHWORLD_STRICT_EVENT_TAXONOMY: '1' },
    encoding: 'utf8'
  });

  assert.notEqual(result.status, 0, 'process must exit non-zero for unknown type in strict mode');
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /Unknown event type/);
});

test('unknown event type warns but does not throw without strict mode', () => {
  const unknownType = `TASK_SOFT_UNKNOWN_${Date.now()}`;
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    assert.doesNotThrow(() => isLifecycleEvent(unknownType));
  } finally {
    console.warn = originalWarn;
  }
  assert.ok(warnings.some((w) => w.includes('Unknown event type')));
});
