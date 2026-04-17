import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  LIFECYCLE_EVENTS,
  SYSTEM_EVENTS,
  isLifecycleEvent,
  isSystemEvent
} from '../core/world/eventTaxonomy.js';

test('all lifecycle events are recognized as lifecycle', () => {
  LIFECYCLE_EVENTS.forEach((type) => {
    assert.equal(isLifecycleEvent(type), true, `${type} should be lifecycle`);
  });
});

test('no lifecycle event is classified as system event', () => {
  LIFECYCLE_EVENTS.forEach((type) => {
    assert.equal(isSystemEvent(type), false, `${type} should not be system`);
  });
});

test('all system events are recognized as system', () => {
  SYSTEM_EVENTS.forEach((type) => {
    assert.equal(isSystemEvent(type), true, `${type} should be system`);
  });
});

test('unknown events warn in non-strict mode', () => {
  const unknownType = `TASK_UNKNOWN_WARN_${Date.now()}`;
  const originalWarn = console.warn;
  const warnings = [];

  console.warn = (...args) => {
    warnings.push(args);
  };

  try {
    assert.equal(isLifecycleEvent(unknownType), false);
  } finally {
    console.warn = originalWarn;
  }

  assert.ok(warnings.length >= 1, 'expected warning for unknown event type');
  const text = warnings.map((entry) => entry.join(' ')).join(' | ');
  assert.match(text, /Unknown event type/);
  assert.match(text, new RegExp(unknownType));
});

test('unknown events throw in strict mode', () => {
  const script = [
    "import { isLifecycleEvent } from './core/world/eventTaxonomy.js';",
    "isLifecycleEvent('TASK_UNKNOWN_STRICT_MODE');"
  ].join('\n');

  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SLOTHWORLD_STRICT_EVENT_TAXONOMY: '1'
    },
    encoding: 'utf8'
  });

  assert.notEqual(result.status, 0, 'strict mode should fail process for unknown event types');
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  assert.match(output, /Unknown event type/);
});
