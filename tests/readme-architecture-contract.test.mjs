import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFilePath);
const readmePath = resolve(currentDir, '..', 'README.md');
const STANDALONE_V2_RE = /\bv2\b/i;

assert.equal(basename(readmePath), 'README.md', 'README contract must read README.md explicitly');
console.log('[readme-contract] resolved README path:', readmePath);
const readme = readFileSync(readmePath, 'utf8');

function requireText(text, message) {
  assert.equal(readme.includes(text), true, message || `Missing required README contract text: ${text}`);
}

function forbidPattern(pattern, message) {
  assert.equal(pattern.test(readme), false, message || `Forbidden README architecture drift detected: ${pattern}`);
}

test('README forbids versioned architecture language', () => {
  forbidPattern(/\bv1\b/i, 'README must not mention v1');
  forbidPattern(STANDALONE_V2_RE, 'README must not mention v2');
  forbidPattern(/versioned architecture|architecture evolution|evolution language/i, 'README must not drift into versioned architecture language');
});

test('v2 check matches standalone word only', () => {
  assert.equal(STANDALONE_V2_RE.test('v2'), true);
  assert.equal(STANDALONE_V2_RE.test('dev2'), false);
  assert.equal(STANDALONE_V2_RE.test('v20'), false);
  assert.equal(STANDALONE_V2_RE.test('env2'), false);
});

test('README declares selector semantics ownership explicitly', () => {
  requireText('## Selector Layer');
  requireText('Selector Layer is the ONLY semantic layer.');
  requireText('`taskSelectors` owns lifecycle derivation.');
  requireText('`metricsSelectors` owns metrics aggregation.');
  requireText('`anomalySelectors` owns anomaly clustering and observability interpretation.');
});

test('README defines deriveWorldState as indexer only and forbids semantic drift', () => {
  requireText('`deriveWorldState` is Indexer Only.');
  requireText('`deriveWorldState` returns `events`, `eventsByTaskId`, and `eventsByWorkerId`.');
  requireText('`deriveWorldState` MUST NOT derive lifecycle state, metrics, or anomalies.');
  requireText('`deriveWorldState` MUST NOT perform lifecycle derivation.');
});

test('README states UI is projection-only and forbids raw event semantics in UI', () => {
  requireText('Renderer is a pure projection layer (`events -> deriveWorldState(events) -> render(worldState)`).');
  requireText('UI and rendering MUST NOT interpret raw events.');
  requireText('- UI logic branching directly on `event.type`.');
  requireText('- UI logic branching directly on `payload.status`.');
});

test('README defines strict event taxonomy separation', () => {
  requireText('## Event Taxonomy');
  requireText('### Lifecycle Events');
  requireText('### System Events');
  requireText('System Events are non-lifecycle, observability only.');
  requireText('- System events MUST NOT affect lifecycle.');
});

test('README retains selector-driven and engine-authoritative boundaries', () => {
  requireText('TaskEngine is the lifecycle authority.');
  requireText('`TASK_ACKED` is the sole terminal source of truth.');
  forbidPattern(/UI .*owns lifecycle|renderer .*derives lifecycle|semantic meaning .*UI/i, 'README must not assign semantic ownership outside selectors');
});