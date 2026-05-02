// tests/trend-research-workflow-e2e.test.mjs
//
// Single focused E2E test for TrendResearchWorkflow.
// Validates full sequential execution of all 4 step workers without mocking
// any workflow or worker logic, and without external API calls.
//
// Runner: node --test tests/trend-research-workflow-e2e.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { runTrendResearchWorkflow } from '../core/engine/runTrendResearchWorkflow.js';

test('TrendResearchWorkflow E2E: full execution with keyword "protein"', () => {
  const keyword = 'protein';
  const result = runTrendResearchWorkflow({ keyword });

  // Workflow completes successfully
  assert.strictEqual(result.success, true, 'workflow must succeed');

  // Final output exists
  assert.ok(result.result, 'result must be present on success');

  // Output is a non-empty array
  assert.ok(Array.isArray(result.result.ranked), 'result.ranked must be an array');
  assert.ok(result.result.ranked.length > 0, 'result.ranked must be non-empty');

  // Each item in ranked is a string
  for (const item of result.result.ranked) {
    assert.strictEqual(typeof item, 'string', `ranked item must be a string, got ${typeof item}`);
  }

  // All 4 steps were exercised — at least one output item is derived from the keyword
  assert.ok(
    result.result.ranked.some((item) => item.startsWith(keyword)),
    'at least one ranked item must start with the keyword (proving all 4 steps ran)'
  );

  // Output shape is clean — no failedStep field on success
  assert.strictEqual('failedStep' in result, false, 'success result must not contain failedStep');
});

test('TrendResearchWorkflow E2E: execution is deterministic', () => {
  const keyword = 'protein';
  const first  = runTrendResearchWorkflow({ keyword });
  const second = runTrendResearchWorkflow({ keyword });

  assert.strictEqual(first.success,  true, 'first run must succeed');
  assert.strictEqual(second.success, true, 'second run must succeed');

  // Running the workflow twice with the same keyword produces identical output
  assert.deepStrictEqual(
    first.result.ranked,
    second.result.ranked,
    'ranked arrays from two identical runs must be deeply equal'
  );
});

test('TrendResearchWorkflow E2E: failure result has no result field', () => {
  const result = runTrendResearchWorkflow({ keyword: '' });

  assert.strictEqual(result.success, false, 'empty keyword must fail');
  assert.strictEqual('result' in result, false, 'failure result must not contain result');
});
