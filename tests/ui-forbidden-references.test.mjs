import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ui-forbidden-references.test.mjs
 *
 * Comprehensive static scan of the UI layer for forbidden references.
 *
 * Fail if any non-selector UI file contains:
 *
 *   1. event.*        — direct access to event-store item fields
 *                       (event.type, event.payload, event.taskId, event.timestamp,
 *                        event.workerId)
 *                       DOM event parameters (.target, .clientX, .key, etc.) are
 *                       explicitly allowed.
 *
 *   2. payload.*      — direct read of lifecycle-meaningful event payload fields
 *                       (payload.status, payload.taskId, payload.agentId,
 *                        payload.workerId, payload.error, payload.deskId,
 *                        payload.type, payload.deskId)
 *                       Writing a task-creation payload object
 *                       (taskPayload.payload = {…}) is allowed.
 *
 *   3. deriveWorldState — reference to the world-state indexer
 *
 *   4. selectors/*    — import of any selector module
 *                       (taskSelectors, metricsSelectors, anomalySelectors,
 *                        agentSelectors, eventTaxonomyInvariant, or any future
 *                        file under ui/selectors/)
 *
 *   5. raw event arrays / world-index structures
 *                       (.eventsByTaskId, .eventsByWorkerId, subscribeEventStream,
 *                        getIndexedWorldSnapshot, getRawEvents)
 *
 * Scope: every .js file under ui/ that is NOT inside ui/selectors/.
 *        The rendering/ layer has its own boundary tests (renderer-boundary.test.mjs).
 *
 * Method: per-line regex scan with explicit exemptions for comment lines and
 *         known-safe patterns (DOM event properties, payload construction).
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const UI_DIR = join(ROOT, 'ui');
const SELECTORS_DIR = join(UI_DIR, 'selectors');

// ─── File collection ──────────────────────────────────────────────────────────

function collectJs(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...collectJs(full));
    } else if (entry.endsWith('.js')) {
      results.push(full);
    }
  }
  return results;
}

const UI_PANEL_FILES = collectJs(UI_DIR).filter(
  (f) => !f.startsWith(SELECTORS_DIR + '/')
);

function label(f) { return relative(ROOT, f); }
function src(f)   { return readFileSync(f, 'utf8'); }

// ─── Exemption helpers ────────────────────────────────────────────────────────

/** Pure comment lines — block comment rows and line comments. */
function isCommentLine(line) {
  return /^\s*(?:\/\/|\*|\/\*)/.test(line);
}

/**
 * DOM-safe event property access.
 * addEventListener callbacks receive a DOM Event whose properties include:
 *   target, currentTarget, clientX, clientY, offsetX, offsetY, key, code,
 *   shiftKey, ctrlKey, altKey, metaKey, preventDefault, stopPropagation, etc.
 * None of these are lifecycle event fields — they are unambiguously safe.
 */
const DOM_EVENT_PROPS = new Set([
  'target', 'currentTarget', 'relatedTarget',
  'clientX', 'clientY', 'offsetX', 'offsetY', 'pageX', 'pageY',
  'key', 'code', 'keyCode', 'charCode', 'which',
  'shiftKey', 'ctrlKey', 'altKey', 'metaKey',
  'button', 'buttons', 'detail', 'deltaY', 'deltaX',
  'preventDefault', 'stopPropagation', 'stopImmediatePropagation',
  'bubbles', 'cancelable', 'composed', 'isTrusted', 'defaultPrevented',
  'pointerType', 'pointerId', 'width', 'height', 'pressure',
  'changedTouches', 'touches', 'data',
]);

/**
 * Return true when the matched `event.PROP` access is exclusively a DOM
 * property — i.e. PROP appears in DOM_EVENT_PROPS.
 */
function isDomEventAccess(line) {
  // Extract every `event.PROP` pattern in the line.
  const propRe = /\bevent\.(\w+)\b/g;
  let m;
  let hasForbiddenProp = false;
  while ((m = propRe.exec(line)) !== null) {
    if (!DOM_EVENT_PROPS.has(m[1])) {
      hasForbiddenProp = true;
    }
  }
  return !hasForbiddenProp;
}

/**
 * Return true when the `payload.*` access on this line is part of writing a
 * task-creation payload object (not reading from an event payload).
 * Pattern: `<identifier>.payload = ` (assignment, not property read).
 */
function isPayloadConstruction(line) {
  return /\w+\.payload\s*=\s*\{/.test(line) || /\w+\.payload\s*=\s*\w/.test(line);
}

// ─── Forbidden reference definitions ─────────────────────────────────────────
//
// Each rule has:
//   category  — group label (shown in test names)
//   name      — specific violation name
//   re        — regex that matches a forbidden line
//   exempt    — function(line) → true when the match is actually safe

const RULES = [
  // ── 1. event.* — event-store field access ──────────────────────────────────
  {
    category: 'event.*',
    name: 'event.type (lifecycle event type field)',
    re: /\bevent\.type\b/,
    exempt: (line) => isCommentLine(line) || isDomEventAccess(line)
  },
  {
    category: 'event.*',
    name: 'event.payload (lifecycle event payload field)',
    re: /\bevent\.payload\b/,
    exempt: (line) => isCommentLine(line) || isDomEventAccess(line)
  },
  {
    category: 'event.*',
    name: 'event.taskId (lifecycle event field)',
    re: /\bevent\.taskId\b/,
    exempt: (line) => isCommentLine(line) || isDomEventAccess(line)
  },
  {
    category: 'event.*',
    name: 'event.timestamp (lifecycle event field)',
    re: /\bevent\.timestamp\b/,
    exempt: (line) => isCommentLine(line) || isDomEventAccess(line)
  },
  {
    category: 'event.*',
    name: 'event.workerId (lifecycle event field)',
    re: /\bevent\.workerId\b/,
    exempt: (line) => isCommentLine(line) || isDomEventAccess(line)
  },

  // ── 2. payload.* — lifecycle payload field reads ───────────────────────────
  {
    category: 'payload.*',
    name: 'payload.status (lifecycle status from event payload)',
    re: /\bpayload\.status\b/,
    exempt: (line) => isCommentLine(line) || isPayloadConstruction(line)
  },
  {
    category: 'payload.*',
    name: 'payload.taskId (task ID from event payload)',
    re: /\bpayload\.taskId\b/,
    exempt: (line) => isCommentLine(line) || isPayloadConstruction(line)
  },
  {
    category: 'payload.*',
    name: 'payload.agentId (agent ID from event payload)',
    re: /\bpayload\.agentId\b/,
    exempt: (line) => isCommentLine(line) || isPayloadConstruction(line)
  },
  {
    category: 'payload.*',
    name: 'payload.workerId (worker ID from event payload)',
    re: /\bpayload\.workerId\b/,
    exempt: (line) => isCommentLine(line) || isPayloadConstruction(line)
  },
  {
    category: 'payload.*',
    name: 'payload.error (error field from event payload)',
    re: /\bpayload\.error\b/,
    exempt: (line) => isCommentLine(line) || isPayloadConstruction(line)
  },
  {
    category: 'payload.*',
    name: 'payload.deskId (desk ID from event payload)',
    re: /\bpayload\.deskId\b/,
    exempt: (line) => isCommentLine(line) || isPayloadConstruction(line)
  },

  // ── 3. deriveWorldState ────────────────────────────────────────────────────
  {
    category: 'deriveWorldState',
    name: 'deriveWorldState reference (import or call)',
    re: /\bderiveWorldState\b/,
    exempt: (line) => isCommentLine(line)
  },

  // ── 4. selectors/* imports ────────────────────────────────────────────────
  {
    category: 'selectors/*',
    name: 'import from selectors/ path',
    re: /\bfrom\s+['"][^'"]*selectors\//,
    exempt: (line) => isCommentLine(line)
  },
  {
    category: 'selectors/*',
    name: 'import of taskSelectors',
    re: /['"][^'"]*taskSelectors[^'"]*['"]/,
    exempt: (line) => isCommentLine(line) || !/^\s*import\b/.test(line)
  },
  {
    category: 'selectors/*',
    name: 'import of metricsSelectors',
    re: /['"][^'"]*metricsSelectors[^'"]*['"]/,
    exempt: (line) => isCommentLine(line) || !/^\s*import\b/.test(line)
  },
  {
    category: 'selectors/*',
    name: 'import of anomalySelectors',
    re: /['"][^'"]*anomalySelectors[^'"]*['"]/,
    exempt: (line) => isCommentLine(line) || !/^\s*import\b/.test(line)
  },
  {
    category: 'selectors/*',
    name: 'import of agentSelectors',
    re: /['"][^'"]*agentSelectors[^'"]*['"]/,
    exempt: (line) => isCommentLine(line) || !/^\s*import\b/.test(line)
  },

  // ── 5. raw event arrays / world-index structures ──────────────────────────
  {
    category: 'raw event arrays',
    name: '.eventsByTaskId access',
    re: /\.eventsByTaskId\b/,
    exempt: (line) => isCommentLine(line)
  },
  {
    category: 'raw event arrays',
    name: '.eventsByWorkerId access',
    re: /\.eventsByWorkerId\b/,
    exempt: (line) => isCommentLine(line)
  },
  {
    category: 'raw event arrays',
    name: 'subscribeEventStream reference',
    re: /\bsubscribeEventStream\b/,
    exempt: (line) => isCommentLine(line)
  },
  {
    category: 'raw event arrays',
    name: 'getIndexedWorldSnapshot reference',
    re: /\bgetIndexedWorldSnapshot\b/,
    exempt: (line) => isCommentLine(line)
  },
  {
    category: 'raw event arrays',
    name: 'getRawEvents reference',
    re: /\bgetRawEvents\b/,
    exempt: (line) => isCommentLine(line)
  },
];

// ─── Scan helper ──────────────────────────────────────────────────────────────

function scanFile(filePath, rule) {
  const lines = src(filePath).split('\n');
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (rule.re.test(line) && !rule.exempt(line)) {
      hits.push({ lineNumber: i + 1, text: line.trim() });
    }
  }
  return hits;
}

// ─── Infrastructure sanity ────────────────────────────────────────────────────

test('ui-forbidden-references: panel file list is non-empty (infra sanity)', () => {
  assert.ok(UI_PANEL_FILES.length > 0,
    'Expected at least one non-selector JS file under ui/ — check the path');
});

// ─── Per-rule tests ───────────────────────────────────────────────────────────

for (const rule of RULES) {
  test(`ui-forbidden-references [${rule.category}]: ${rule.name}`, () => {
    const allHits = [];
    for (const filePath of UI_PANEL_FILES) {
      for (const hit of scanFile(filePath, rule)) {
        allHits.push(`  ${label(filePath)}:${hit.lineNumber}: ${hit.text}`);
      }
    }
    assert.deepStrictEqual(allHits, [],
      `Forbidden reference "${rule.name}" found in UI panel files:\n${allHits.join('\n')}`);
  });
}

// ─── Exemption correctness — DOM event properties must not be flagged ─────────

test('ui-forbidden-references: event.target is not flagged (DOM event property)', () => {
  const rule = RULES.find((r) => r.name === 'event.type (lifecycle event type field)');
  const line = '    const target = event.target;';
  assert.ok(rule.exempt(line), 'event.target must be exempt from the event.type rule');
});

test('ui-forbidden-references: event.clientX is not flagged (DOM event property)', () => {
  const rule = RULES.find((r) => r.name === 'event.type (lifecycle event type field)');
  const line = '    const x = event.clientX;';
  assert.ok(rule.exempt(line), 'event.clientX must be exempt');
});

test('ui-forbidden-references: event.key is not flagged (DOM event property)', () => {
  const rule = RULES.find((r) => r.name === 'event.type (lifecycle event type field)');
  const line = "    if (event.key === 'Enter') { submit(); }";
  assert.ok(rule.exempt(line), 'event.key must be exempt');
});

// ─── Violation detection — forbidden patterns MUST be caught ─────────────────

test('ui-forbidden-references: event.type IS flagged (lifecycle event field)', () => {
  const rule = RULES.find((r) => r.name === 'event.type (lifecycle event type field)');
  const line = "    if (event.type === 'TASK_CREATED') { handle(); }";
  assert.ok(rule.re.test(line) && !rule.exempt(line),
    'event.type on a lifecycle event must be flagged');
});

test('ui-forbidden-references: payload.status IS flagged (lifecycle payload field)', () => {
  const rule = RULES.find((r) => r.name === 'payload.status (lifecycle status from event payload)');
  const line = "    const s = payload.status;";
  assert.ok(rule.re.test(line) && !rule.exempt(line),
    'payload.status must be flagged');
});

test('ui-forbidden-references: taskPayload.payload = {} is NOT flagged (payload construction)', () => {
  const rule = RULES.find((r) => r.name === 'payload.status (lifecycle status from event payload)');
  const line = '    taskPayload.payload = { text: msgInput.value };';
  assert.ok(!rule.re.test(line) || rule.exempt(line),
    'taskPayload.payload = {} must not be flagged — it is outbound payload construction');
});

test('ui-forbidden-references: deriveWorldState call IS flagged', () => {
  const rule = RULES.find((r) => r.name === 'deriveWorldState reference (import or call)');
  const line = '    const world = deriveWorldState(events);';
  assert.ok(rule.re.test(line) && !rule.exempt(line),
    'deriveWorldState call must be flagged');
});

test('ui-forbidden-references: deriveWorldState in comment is NOT flagged', () => {
  const rule = RULES.find((r) => r.name === 'deriveWorldState reference (import or call)');
  const line = '// deriveWorldState is used only in core';
  assert.ok(!rule.re.test(line) || rule.exempt(line),
    'deriveWorldState inside a comment must be exempt');
});

test('ui-forbidden-references: selector import IS flagged', () => {
  const rule = RULES.find((r) => r.name === 'import from selectors/ path');
  const line = "import { getAllTasks } from '../ui/selectors/taskSelectors.js';";
  assert.ok(rule.re.test(line) && !rule.exempt(line),
    'import from selectors/ path must be flagged');
});

test('ui-forbidden-references: .eventsByTaskId access IS flagged', () => {
  const rule = RULES.find((r) => r.name === '.eventsByTaskId access');
  const line = '    const events = indexedWorld.eventsByTaskId.get(taskId);';
  assert.ok(rule.re.test(line) && !rule.exempt(line),
    '.eventsByTaskId access must be flagged');
});

test('ui-forbidden-references: subscribeEventStream IS flagged', () => {
  const rule = RULES.find((r) => r.name === 'subscribeEventStream reference');
  const line = '    subscribeEventStream(handler);';
  assert.ok(rule.re.test(line) && !rule.exempt(line),
    'subscribeEventStream must be flagged');
});
