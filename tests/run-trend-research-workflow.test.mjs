// tests/run-trend-research-workflow.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { runTrendResearchWorkflow } from '../core/engine/runTrendResearchWorkflow.js';

// ─── Happy-path ───────────────────────────────────────────────────────────────

test('runTrendResearchWorkflow: succeeds with a valid keyword', async () => {
  const result = await runTrendResearchWorkflow({ keyword: 'fitness' });
  assert.strictEqual(result.success, true);
  assert.ok(result.result, 'result must be present');
  assert.ok(Array.isArray(result.result.ranked), 'result.ranked must be an array');
});

test('runTrendResearchWorkflow: ranked array contains string items', async () => {
  const result = await runTrendResearchWorkflow({ keyword: 'fitness' });
  assert.strictEqual(result.success, true);
  for (const item of result.result.ranked) {
    assert.strictEqual(typeof item, 'string');
  }
});

test('runTrendResearchWorkflow: final output contains the keyword', async () => {
  const keyword = 'sneakers';
  const result = await runTrendResearchWorkflow({ keyword });
  assert.strictEqual(result.success, true);
  assert.ok(
    result.result.ranked.some((item) => item.startsWith(keyword)),
    'at least one ranked item should start with the keyword'
  );
});

test('runTrendResearchWorkflow: execution is deterministic', async () => {
  const a = await runTrendResearchWorkflow({ keyword: 'coffee' });
  const b = await runTrendResearchWorkflow({ keyword: 'coffee' });
  assert.strictEqual(a.success, true);
  assert.strictEqual(b.success, true);
  assert.deepStrictEqual(a.result.ranked, b.result.ranked);
});

// ─── Failure path ─────────────────────────────────────────────────────────────

test('runTrendResearchWorkflow: fails at step 1 when keyword is missing', async () => {
  const result = await runTrendResearchWorkflow({});
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.failedStep, 1);
  assert.ok(result.error);
});

test('runTrendResearchWorkflow: fails at step 1 when keyword is empty string', async () => {
  const result = await runTrendResearchWorkflow({ keyword: '' });
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.failedStep, 1);
  assert.ok(result.error);
});

test('runTrendResearchWorkflow: fails at step 1 when input is null', async () => {
  const result = await runTrendResearchWorkflow(null);
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.failedStep, 1);
});

// ─── Output shape ─────────────────────────────────────────────────────────────

test('runTrendResearchWorkflow: success result has no failedStep field', async () => {
  const result = await runTrendResearchWorkflow({ keyword: 'yoga' });
  assert.strictEqual(result.success, true);
  assert.strictEqual('failedStep' in result, false);
});

test('runTrendResearchWorkflow: failure result has no result field', async () => {
  const result = await runTrendResearchWorkflow({ keyword: '' });
  assert.strictEqual(result.success, false);
  assert.strictEqual('result' in result, false);
});
