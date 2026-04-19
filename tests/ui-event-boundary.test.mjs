import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * UI Layer Event-Parsing Boundary Tests
 *
 * Verifies that non-selector UI modules:
 *   - do NOT access raw events directly (world.events, indexedWorld.events)
 *   - do NOT inspect event.type (string comparisons on event types)
 *   - do NOT access indexedWorld.eventsByTaskId or indexedWorld.eventsByWorkerId directly
 *   - do NOT import deriveWorldState or getRawEvents
 *
 * All event interpretation must happen inside ui/selectors/.
 *
 * Method: static source analysis via regex on each non-selector JS file in ui/.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const UI_DIR = join(ROOT, 'ui');
const SELECTORS_DIR = join(UI_DIR, 'selectors');

// ─── File collection ──────────────────────────────────────────────────────────

/** Recursively collect .js files under a directory. */
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

/** All JS files in ui/ that are NOT inside ui/selectors/. */
const UI_PANEL_FILES = collectJs(UI_DIR).filter(
  (f) => !f.startsWith(SELECTORS_DIR + '/')
);

/** All JS files in ui/selectors/ — these are ALLOWED to parse events. */
const SELECTOR_FILES = collectJs(SELECTORS_DIR);

function label(filePath) {
  return relative(ROOT, filePath);
}

function src(filePath) {
  return readFileSync(filePath, 'utf8');
}

// ─── Violation patterns ───────────────────────────────────────────────────────
//
// Each pattern has:
//   re        — regex to detect the violation in source
//   name      — human-readable violation name
//   except    — optional function(line) returning true when the match is allowed
//               (e.g. a comment, a string literal stub construction)

const VIOLATIONS = [
  {
    name: 'direct event.type access',
    re: /\bevent\.type\b/,
    // A line that is purely a comment is not executable code.
    except: (line) => /^\s*\*|^\s*\/\//.test(line)
  },
  {
    name: 'direct indexedWorld.events access',
    // Accessing the raw flat events array on a world/indexedWorld object.
    re: /(?:indexedWorld|worldState|world)\s*(?:\?\.)?\s*\.events\b/,
    except: (line) => /^\s*\*|^\s*\/\//.test(line)
  },
  {
    name: 'direct indexedWorld.eventsByTaskId access',
    // Reading FROM the map — constructing a stub `{ eventsByTaskId: new Map() }` is allowed.
    re: /(?:indexedWorld|worldState|world)\s*(?:\?\.)?\s*\.eventsByTaskId\b/,
    except: (line) => /^\s*\*|^\s*\/\//.test(line)
  },
  {
    name: 'direct indexedWorld.eventsByWorkerId access',
    re: /(?:indexedWorld|worldState|world)\s*(?:\?\.)?\s*\.eventsByWorkerId\b/,
    except: (line) => /^\s*\*|^\s*\/\//.test(line)
  },
  {
    name: 'import of deriveWorldState',
    re: /import\s.*\bderiveWorldState\b/,
    except: () => false
  },
  {
    name: 'import of getRawEvents',
    re: /import\s.*\bgetRawEvents\b/,
    except: () => false
  }
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function findViolations(filePath, violation) {
  const lines = src(filePath).split('\n');
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (violation.re.test(line) && !violation.except(line)) {
      hits.push({ lineNumber: i + 1, text: line.trim() });
    }
  }
  return hits;
}

// ─── Sanity: panel file list is non-empty ─────────────────────────────────────

test('UI boundary: panel file list is non-empty (test infra sanity)', () => {
  assert.ok(UI_PANEL_FILES.length > 0,
    'Expected to find at least one non-selector JS file in ui/ — check the path');
});

test('UI boundary: selector file list is non-empty (test infra sanity)', () => {
  assert.ok(SELECTOR_FILES.length > 0,
    'Expected to find at least one selector JS file in ui/selectors/ — check the path');
});

// ─── Panel files must not contain violation patterns ─────────────────────────

for (const violation of VIOLATIONS) {
  test(`UI boundary: no panel file contains "${violation.name}"`, () => {
    const allHits = [];

    for (const filePath of UI_PANEL_FILES) {
      const hits = findViolations(filePath, violation);
      for (const hit of hits) {
        allHits.push(`  ${label(filePath)}:${hit.lineNumber}: ${hit.text}`);
      }
    }

    assert.equal(allHits.length, 0,
      `Violation "${violation.name}" detected in UI panel files:\n${allHits.join('\n')}`
    );
  });
}

// ─── Selector files ARE allowed to use these patterns ─────────────────────────
// Confirm the test would actually catch violations if they existed, by verifying
// the selectors (the only allowed location) do use these patterns.

test('UI boundary: selectors do use event.type (confirms regex is not trivially empty)', () => {
  const pattern = /\bevent\.type\b/;
  const anySelector = SELECTOR_FILES.some((f) => pattern.test(src(f)));
  assert.ok(anySelector,
    'At least one selector must reference event.type — otherwise the detection regex is not meaningful');
});

test('UI boundary: selectors do access eventsByTaskId (confirms regex is not trivially empty)', () => {
  const pattern = /\.eventsByTaskId\b/;
  const anySelector = SELECTOR_FILES.some((f) => pattern.test(src(f)));
  assert.ok(anySelector,
    'At least one selector must access .eventsByTaskId — otherwise the detection regex is not meaningful');
});

// ─── Regression: adding a violation to a panel file must be caught ────────────

test('UI boundary: violation detector catches event.type in synthetic source', () => {
  const violation = VIOLATIONS.find((v) => v.name === 'direct event.type access');

  // Simulate what findViolations would return for a file containing the pattern.
  const fakeLines = [
    'import { something } from "./selectors/taskSelectors.js";',
    'if (event.type === "TASK_CREATED") { doSomething(); }',
    '// event.type is allowed in comments',
    '  * event.type docs',
  ];
  const hits = [];
  for (let i = 0; i < fakeLines.length; i++) {
    const line = fakeLines[i];
    if (violation.re.test(line) && !violation.except(line)) {
      hits.push(i + 1);
    }
  }

  // Line 2 is a real violation; lines 3 and 4 are exempt (comments).
  assert.deepStrictEqual(hits, [2],
    'Detector must flag executable event.type access and ignore comment lines');
});

test('UI boundary: violation detector catches deriveWorldState import in synthetic source', () => {
  const violation = VIOLATIONS.find((v) => v.name === 'import of deriveWorldState');
  const fakeLines = [
    'import { deriveWorldState } from "../core/world/deriveWorldState.js";',
    'import { getTaskStatus } from "./selectors/taskSelectors.js";',
    '// deriveWorldState is used in core, not here'
  ];
  const hits = [];
  for (let i = 0; i < fakeLines.length; i++) {
    const line = fakeLines[i];
    if (violation.re.test(line) && !violation.except(line)) {
      hits.push(i + 1);
    }
  }
  assert.deepStrictEqual(hits, [1],
    'Detector must flag direct import of deriveWorldState');
});
