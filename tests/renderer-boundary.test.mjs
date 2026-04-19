import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Renderer Boundary Contract Tests
 *
 * Verifies that all files under rendering/ are stateless projection layers:
 *
 *   1. Do NOT branch on canonical event type semantics
 *      (no TASK_CREATED / TASK_ACKED / … string comparisons)
 *
 *   2. Do NOT import selector modules, event taxonomy, or world indexers
 *      (no direct event processing — only accepts pre-computed renderView)
 *
 *   3. Do NOT access raw world index structures
 *      (.events, .eventsByTaskId, .eventsByWorkerId)
 *
 *   4. Do NOT return state from the render entry point
 *      (render() is a pure side-effect call — stateless per-call contract)
 *
 *   5. Do NOT accumulate lifecycle-derived state across frames
 *      (no module-level data structures keyed by taskId or built from events)
 */

const ROOT   = fileURLToPath(new URL('..', import.meta.url));
const RENDER_DIR = join(ROOT, 'rendering');

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

const RENDER_FILES = collectJs(RENDER_DIR);

function label(filePath) {
  return relative(ROOT, filePath);
}

function lines(filePath) {
  return readFileSync(filePath, 'utf8').split('\n');
}

function src(filePath) {
  return readFileSync(filePath, 'utf8');
}

function isComment(line) {
  return /^\s*\*|^\s*\/\//.test(line);
}

// ─── Violation definitions ────────────────────────────────────────────────────

const CANONICAL_EVENT_TYPES = [
  'TASK_CREATED', 'TASK_ENQUEUED', 'TASK_CLAIMED',
  'TASK_EXECUTE_STARTED', 'TASK_EXECUTE_FINISHED', 'TASK_ACKED',
  'TASK_NOTIFICATION_SENT', 'TASK_NOTIFICATION_SKIPPED', 'TASK_NOTIFICATION_FAILED'
];

const VIOLATIONS = [
  {
    name: 'canonical event type string literal',
    // Any quoted occurrence of a TASK_* canonical event name.
    re: new RegExp(`['"\`](${CANONICAL_EVENT_TYPES.join('|')})['"\`]`),
    except: isComment
  },
  {
    name: 'import from ui/selectors',
    re: /import\s.*from\s+['"`][^'"`]*\/ui\/selectors\//,
    except: isComment
  },
  {
    name: 'import from selectors (relative)',
    re: /import\s.*from\s+['"`][^'"`]*selectors[/\\][^'"`]*['"`]/,
    except: isComment
  },
  {
    name: 'import of eventTaxonomy',
    re: /import\s.*from\s+['"`][^'"`]*eventTaxonomy[^'"`]*['"`]/,
    except: isComment
  },
  {
    name: 'import of deriveWorldState',
    re: /import\s.*\bderiveWorldState\b/,
    except: isComment
  },
  {
    name: 'import of getRawEvents',
    re: /import\s.*\bgetRawEvents\b/,
    except: isComment
  },
  {
    name: 'direct .eventsByTaskId access',
    re: /\.\s*eventsByTaskId\b/,
    except: isComment
  },
  {
    name: 'direct .eventsByWorkerId access',
    re: /\.\s*eventsByWorkerId\b/,
    except: isComment
  },
  {
    name: 'direct world .events array access',
    // Match .events[ or .events. but not .representativeEvents or similar composed names.
    re: /(?<!\w)\.events\s*[\[.]/,
    except: isComment
  }
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function findViolations(filePath, violation) {
  const hits = [];
  const fileLines = lines(filePath);
  for (let i = 0; i < fileLines.length; i++) {
    const line = fileLines[i];
    if (violation.re.test(line) && !violation.except(line)) {
      hits.push({ lineNumber: i + 1, text: line.trim() });
    }
  }
  return hits;
}

function reportHits(filePath, hits) {
  return hits.map((h) => `  ${label(filePath)}:${h.lineNumber}: ${h.text}`).join('\n');
}

// ─── Sanity: file list is non-empty ──────────────────────────────────────────

test('Renderer boundary: rendering/ directory contains JS files (infra sanity)', () => {
  assert.ok(RENDER_FILES.length > 0,
    'Expected JS files in rendering/ — check RENDER_DIR path');
});

// ─── 1. No canonical event type string literals ───────────────────────────────

test('Renderer boundary: no rendering file compares against canonical event type strings', () => {
  const violation = VIOLATIONS.find((v) => v.name === 'canonical event type string literal');
  const allHits = [];

  for (const f of RENDER_FILES) {
    const hits = findViolations(f, violation);
    if (hits.length) allHits.push(reportHits(f, hits));
  }

  assert.equal(allHits.length, 0,
    `Rendering files must not branch on event type names:\n${allHits.join('\n')}`);
});

// ─── 2. No selector or event-processing imports ───────────────────────────────

test('Renderer boundary: no rendering file imports from ui/selectors/', () => {
  for (const violation of VIOLATIONS.filter((v) =>
    v.name === 'import from ui/selectors' || v.name === 'import from selectors (relative)'
  )) {
    const allHits = [];
    for (const f of RENDER_FILES) {
      const hits = findViolations(f, violation);
      if (hits.length) allHits.push(reportHits(f, hits));
    }
    assert.equal(allHits.length, 0,
      `Violation "${violation.name}" — rendering must not import selectors directly:\n${allHits.join('\n')}`);
  }
});

test('Renderer boundary: no rendering file imports eventTaxonomy', () => {
  const violation = VIOLATIONS.find((v) => v.name === 'import of eventTaxonomy');
  const allHits = [];
  for (const f of RENDER_FILES) {
    const hits = findViolations(f, violation);
    if (hits.length) allHits.push(reportHits(f, hits));
  }
  assert.equal(allHits.length, 0,
    `Rendering files must not import eventTaxonomy:\n${allHits.join('\n')}`);
});

test('Renderer boundary: no rendering file imports deriveWorldState or getRawEvents', () => {
  for (const violation of VIOLATIONS.filter((v) =>
    v.name === 'import of deriveWorldState' || v.name === 'import of getRawEvents'
  )) {
    const allHits = [];
    for (const f of RENDER_FILES) {
      const hits = findViolations(f, violation);
      if (hits.length) allHits.push(reportHits(f, hits));
    }
    assert.equal(allHits.length, 0,
      `Violation "${violation.name}" in rendering files:\n${allHits.join('\n')}`);
  }
});

// ─── 3. No raw world index access ─────────────────────────────────────────────

test('Renderer boundary: no rendering file accesses .eventsByTaskId directly', () => {
  const violation = VIOLATIONS.find((v) => v.name === 'direct .eventsByTaskId access');
  const allHits = [];
  for (const f of RENDER_FILES) {
    const hits = findViolations(f, violation);
    if (hits.length) allHits.push(reportHits(f, hits));
  }
  assert.equal(allHits.length, 0,
    `Rendering must not access .eventsByTaskId — use selector outputs only:\n${allHits.join('\n')}`);
});

test('Renderer boundary: no rendering file accesses .eventsByWorkerId directly', () => {
  const violation = VIOLATIONS.find((v) => v.name === 'direct .eventsByWorkerId access');
  const allHits = [];
  for (const f of RENDER_FILES) {
    const hits = findViolations(f, violation);
    if (hits.length) allHits.push(reportHits(f, hits));
  }
  assert.equal(allHits.length, 0,
    `Rendering must not access .eventsByWorkerId — use selector outputs only:\n${allHits.join('\n')}`);
});

test('Renderer boundary: no rendering file indexes into a .events array directly', () => {
  const violation = VIOLATIONS.find((v) => v.name === 'direct world .events array access');
  const allHits = [];
  for (const f of RENDER_FILES) {
    const hits = findViolations(f, violation);
    if (hits.length) allHits.push(reportHits(f, hits));
  }
  assert.equal(allHits.length, 0,
    `Rendering must not traverse raw .events arrays — use selector outputs only:\n${allHits.join('\n')}`);
});

// ─── 4. render() is a void function (stateless per-call contract) ─────────────

test('Renderer boundary: render() in canvas-renderer.js does not return a value', () => {
  const canvasRenderer = RENDER_FILES.find((f) => f.endsWith('canvas-renderer.js'));
  assert.ok(canvasRenderer, 'canvas-renderer.js must exist in rendering/');

  const source = src(canvasRenderer);
  // Extract the body of the exported `render` function.
  // Strategy: find `export function render(` and scan until the matching closing brace.
  const exportStart = source.indexOf('export function render(');
  assert.ok(exportStart !== -1, 'canvas-renderer.js must export a `render` function');

  // Find the opening brace of the function body.
  let depth = 0;
  let bodyStart = -1;
  let bodyEnd = -1;
  for (let i = exportStart; i < source.length; i++) {
    if (source[i] === '{') {
      if (depth === 0) bodyStart = i;
      depth++;
    } else if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        bodyEnd = i;
        break;
      }
    }
  }

  assert.ok(bodyStart !== -1 && bodyEnd !== -1, 'Could not locate render() function body');

  const body = source.slice(bodyStart, bodyEnd + 1);

  // A value-returning render() would have `return <expr>;` (not bare `return;`).
  const returnWithValue = /\breturn\s+(?!;)[^\n;]+/;
  assert.ok(!returnWithValue.test(body),
    'render() must not return a value — it is a stateless projection, not a data-producing function');
});

// ─── 5. No lifecycle-derived accumulation state ───────────────────────────────

test('Renderer boundary: rendering files do not declare module-level Maps keyed by taskId', () => {
  // Pattern: `new Map()` assigned to a module-level `const/let/var` in rendering files,
  // where the variable name suggests task or event keying.
  const taskKeyedMapRe = /^(?:const|let|var)\s+\w*(?:task|event|lifecycle)\w*\s*=\s*new Map\(\)/im;

  for (const f of RENDER_FILES) {
    const source = src(f);
    // Only look at module-level declarations (not inside function bodies).
    // Heuristic: lines that are not indented with more than one level.
    const moduleLines = source.split('\n').filter(
      (line) => /^(?:const|let|var)\s+/.test(line)
    );
    for (const line of moduleLines) {
      const isTaskKeyedMap = taskKeyedMapRe.test(line);
      assert.ok(!isTaskKeyedMap,
        `${label(f)}: module-level Map named after task/event/lifecycle detected — ` +
        `rendering must not accumulate lifecycle-derived state:\n  ${line.trim()}`);
    }
  }
});

test('Renderer boundary: rendering files do not derive state from event payloads', () => {
  // Payload fields that belong to lifecycle/status derivation — accessing these
  // in rendering means the renderer is inferring state rather than consuming it.
  const lifecyclePayloadRe = /\bpayload\s*\.\s*(?:status|taskId|workerId|error|agentId)\b/;

  for (const f of RENDER_FILES) {
    const fileLines = lines(f);
    const hits = [];
    for (let i = 0; i < fileLines.length; i++) {
      const line = fileLines[i];
      if (lifecyclePayloadRe.test(line) && !isComment(line)) {
        hits.push({ lineNumber: i + 1, text: line.trim() });
      }
    }
    assert.equal(hits.length, 0,
      `${label(f)}: rendering files must not read lifecycle fields from event payloads —` +
      ` those must be resolved by selectors before rendering:\n${reportHits(f, hits)}`);
  }
});

// ─── Regression: detectors are non-trivial ────────────────────────────────────

test('Renderer boundary: event type literal detector fires on synthetic source', () => {
  const violation = VIOLATIONS.find((v) => v.name === 'canonical event type string literal');
  const fakeLines = [
    '// TASK_CREATED is a lifecycle event',
    "if (event.type === 'TASK_CREATED') { draw(); }",
    'const type = status;'
  ];
  const hits = fakeLines
    .map((line, i) => ({ line, i }))
    .filter(({ line }) => violation.re.test(line) && !violation.except(line))
    .map(({ i }) => i + 1);

  assert.deepStrictEqual(hits, [2],
    'Detector must flag the executable line and ignore the comment');
});

test('Renderer boundary: selector import detector fires on synthetic source', () => {
  const violation = VIOLATIONS.find((v) => v.name === 'import from selectors (relative)');
  const fakeLines = [
    "import { getTaskStatus } from '../ui/selectors/taskSelectors.js';",
    "import { render } from './canvas-renderer.js';"
  ];
  const hits = fakeLines
    .map((line, i) => ({ line, i }))
    .filter(({ line }) => violation.re.test(line) && !violation.except(line))
    .map(({ i }) => i + 1);

  assert.deepStrictEqual(hits, [1],
    'Detector must flag a selector import and not flag a rendering import');
});
