// tests/run-trend-research-workflow.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { runTrendResearchWorkflow } from '../core/engine/runTrendResearchWorkflow.js';

// ─── Happy-path ───────────────────────────────────────────────────────────────

test('runTrendResearchWorkflow: succeeds with a valid keyword', () => {
  const result = runTrendResearchWorkflow({ keyword: 'fitness' });
  assert.strictEqual(result.success, true);
  assert.ok(result.result, 'result must be present');
  assert.ok(Array.isArray(result.result.ranked), 'result.ranked must be an array');
});

test('runTrendResearchWorkflow: ranked array contains string items', () => {
  const result = runTrendResearchWorkflow({ keyword: 'fitness' });
  assert.strictEqual(result.success, true);
  for (const item of result.result.ranked) {
    assert.strictEqual(typeof item, 'string');
  }
});

test('runTrendResearchWorkflow: final output contains the keyword', () => {
  const keyword = 'sneakers';
  const result = runTrendResearchWorkflow({ keyword });
  assert.strictEqual(result.success, true);
  assert.ok(
    result.result.ranked.some((item) => item.startsWith(keyword)),
    'at least one ranked item should start with the keyword'
  );
});

test('runTrendResearchWorkflow: execution is deterministic', () => {
  const a = runTrendResearchWorkflow({ keyword: 'coffee' });
  const b = runTrendResearchWorkflow({ keyword: 'coffee' });
  assert.strictEqual(a.success, true);
  assert.strictEqual(b.success, true);
  assert.deepStrictEqual(a.result.ranked, b.result.ranked);
});

// ─── Failure path ─────────────────────────────────────────────────────────────

test('runTrendResearchWorkflow: fails at step 1 when keyword is missing', () => {
  const result = runTrendResearchWorkflow({});
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.failedStep, 1);
  assert.ok(result.error);
});

test('runTrendResearchWorkflow: fails at step 1 when keyword is empty string', () => {
  const result = runTrendResearchWorkflow({ keyword: '' });
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.failedStep, 1);
  assert.ok(result.error);
});

test('runTrendResearchWorkflow: fails at step 1 when input is null', () => {
  const result = runTrendResearchWorkflow(null);
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.failedStep, 1);
});

// ─── Output shape ─────────────────────────────────────────────────────────────

test('runTrendResearchWorkflow: success result has no failedStep field', () => {
  const result = runTrendResearchWorkflow({ keyword: 'yoga' });
  assert.strictEqual(result.success, true);
  assert.strictEqual('failedStep' in result, false);
});

test('runTrendResearchWorkflow: failure result has no result field', () => {
  const result = runTrendResearchWorkflow({ keyword: '' });
  assert.strictEqual(result.success, false);
  assert.strictEqual('result' in result, false);
});
