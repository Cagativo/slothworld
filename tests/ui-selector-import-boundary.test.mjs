import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ui-selector-import-boundary.test.mjs
 *
 * CI contract: UI panel files must NOT import selector modules.
 *
 * The only permitted data source for UI modules is VisualWorldGraph
 * ( { nodes, edges, metadata } ) obtained through controlAPI.getGraph().
 *
 * Forbidden imports from UI panel files:
 *   - ui/selectors/taskSelectors.js
 *   - ui/selectors/metricsSelectors.js
 *   - ui/selectors/anomalySelectors.js
 *   - ui/selectors/agentSelectors.js
 *   - ui/selectors/eventTaxonomyInvariant.js
 *   - Any other file matching ui/selectors/* (future-proof)
 *
 * Permitted imports from UI panel files:
 *   - Other UI modules (control-api.js, command-parser.js, etc.)
 *   - Rendering modules (rendering/*)
 *   - config modules (ui/config/*)
 *
 * Method: static import-statement analysis on every JS file in ui/ that is
 * NOT itself inside ui/selectors/.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const UI_DIR = join(ROOT, 'ui');
const SELECTORS_DIR = join(UI_DIR, 'selectors');

// ─── File helpers ─────────────────────────────────────────────────────────────

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

/** All JS files under ui/ that are NOT inside ui/selectors/. */
const UI_PANEL_FILES = collectJs(UI_DIR).filter(
  (f) => !f.startsWith(SELECTORS_DIR + '/')
);

/** All selector file basenames (e.g. "taskSelectors.js"). */
const SELECTOR_BASENAMES = readdirSync(SELECTORS_DIR).filter((f) => f.endsWith('.js'));

function label(filePath) {
  return relative(ROOT, filePath);
}

function src(filePath) {
  return readFileSync(filePath, 'utf8');
}

// ─── Violation detection ──────────────────────────────────────────────────────

/**
 * Return every import statement line in `source` that references a selector
 * module.  An import references a selector when its module specifier:
 *   a) contains the literal path segment "selectors/" (catches any future file),
 *   b) ends with one of the known selector filenames.
 */
function findSelectorImports(source) {
  const lines = source.split('\n');
  const hits = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip blank lines and pure comment lines.
    if (/^\s*\/\/|^\s*\*/.test(line)) { continue; }

    // Only examine import statements.
    if (!/^\s*import\b/.test(line)) { continue; }

    // Extract the module specifier (single- or double-quoted).
    const specifierMatch = /from\s+['"]([^'"]+)['"]/i.exec(line);
    if (!specifierMatch) { continue; }
    const specifier = specifierMatch[1];

    const isSelectorImport =
      specifier.includes('selectors/') ||
      SELECTOR_BASENAMES.some((name) => specifier.endsWith(name));

    if (isSelectorImport) {
      hits.push({ lineNumber: i + 1, text: line.trim() });
    }
  }

  return hits;
}

// ─── Sanity ───────────────────────────────────────────────────────────────────

test('ui-selector-import-boundary: panel file list is non-empty (infra sanity)', () => {
  assert.ok(UI_PANEL_FILES.length > 0,
    'Expected at least one non-selector JS file under ui/ — check the path');
});

test('ui-selector-import-boundary: selector file list is non-empty (infra sanity)', () => {
  assert.ok(SELECTOR_BASENAMES.length >= 4,
    'Expected at least 4 selector files in ui/selectors/ — check the path');
  for (const name of ['taskSelectors.js', 'metricsSelectors.js', 'anomalySelectors.js', 'agentSelectors.js']) {
    assert.ok(SELECTOR_BASENAMES.includes(name),
      `Expected ${name} to exist in ui/selectors/`);
  }
});

// ─── Per-file tests ───────────────────────────────────────────────────────────

for (const filePath of UI_PANEL_FILES) {
  const rel = label(filePath);

  test(`ui-selector-import-boundary: ${rel} must not import any selector module`, () => {
    const hits = findSelectorImports(src(filePath));
    assert.deepStrictEqual(hits, [],
      `${rel} imports selector module(s) — UI must only consume VisualWorldGraph, not selector outputs:\n` +
      hits.map((h) => `  line ${h.lineNumber}: ${h.text}`).join('\n'));
  });
}

// ─── Explicit named-selector tests (always present regardless of file layout) ─

const NAMED_SELECTORS = [
  { label: 'taskSelectors',           re: /['"][^'"]*taskSelectors[^'"]*['"]/ },
  { label: 'metricsSelectors',        re: /['"][^'"]*metricsSelectors[^'"]*['"]/ },
  { label: 'anomalySelectors',        re: /['"][^'"]*anomalySelectors[^'"]*['"]/ },
  { label: 'agentSelectors',          re: /['"][^'"]*agentSelectors[^'"]*['"]/ },
  { label: 'eventTaxonomyInvariant',  re: /['"][^'"]*eventTaxonomyInvariant[^'"]*['"]/ },
];

for (const { label: selectorLabel, re } of NAMED_SELECTORS) {
  test(`ui-selector-import-boundary: no UI panel file imports ${selectorLabel}`, () => {
    const violations = [];
    for (const filePath of UI_PANEL_FILES) {
      const lines = src(filePath).split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*import\b/.test(line) && re.test(line) && !/^\s*\/\//.test(line)) {
          violations.push(`  ${label(filePath)} line ${i + 1}: ${line.trim()}`);
        }
      }
    }
    assert.deepStrictEqual(violations, [],
      `The following UI files import ${selectorLabel} — forbidden:\n${violations.join('\n')}`);
  });
}
