// tests/trend-research-workers.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { runCollectSignalsWorker } from '../core/workers/collectSignalsWorker.js';
import { runScoreTrendsWorker } from '../core/workers/scoreTrendsWorker.js';
import { runSelectCandidatesWorker } from '../core/workers/selectCandidatesWorker.js';
import { runProduceFinalOutputWorker } from '../core/workers/produceFinalOutputWorker.js';

// ─── CollectSignalsWorker ──────────────────────────────────────────────────────

test('CollectSignalsWorker: returns three signals for a valid keyword', () => {
  const result = runCollectSignalsWorker({ keyword: 'cats' });
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(result.result.signals, ['cats', 'cats_1', 'cats_2']);
});

test('CollectSignalsWorker: signals array always has length 3', () => {
  const result = runCollectSignalsWorker({ keyword: 'trending-now' });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.result.signals.length, 3);
});

test('CollectSignalsWorker: output is deterministic', () => {
  const a = runCollectSignalsWorker({ keyword: 'shoes' });
  const b = runCollectSignalsWorker({ keyword: 'shoes' });
  assert.deepStrictEqual(a, b);
});

test('CollectSignalsWorker: fails when keyword is missing', () => {
  const result = runCollectSignalsWorker({});
  assert.strictEqual(result.success, false);
  assert.ok(result.error);
});

test('CollectSignalsWorker: fails when keyword is empty string', () => {
  const result = runCollectSignalsWorker({ keyword: '' });
  assert.strictEqual(result.success, false);
});

test('CollectSignalsWorker: trims whitespace from keyword', () => {
  const result = runCollectSignalsWorker({ keyword: '  hats  ' });
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(result.result.signals, ['hats', 'hats_1', 'hats_2']);
});

// ─── ScoreTrendsWorker ────────────────────────────────────────────────────────

test('ScoreTrendsWorker: returns a scored entry for each signal', () => {
  const signals = ['cats', 'cats_1', 'cats_2'];
  const result = runScoreTrendsWorker({ signals });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.result.scored.length, 3);
});

test('ScoreTrendsWorker: each scored entry has item and numeric score', () => {
  const signals = ['alpha', 'beta', 'gamma'];
  const result = runScoreTrendsWorker({ signals });
  assert.strictEqual(result.success, true);
  for (const entry of result.result.scored) {
    assert.strictEqual(typeof entry.item, 'string');
    assert.strictEqual(typeof entry.score, 'number');
    assert.ok(Number.isFinite(entry.score));
  }
});

test('ScoreTrendsWorker: scores are deterministic', () => {
  const signals = ['cats', 'cats_1', 'cats_2'];
  const a = runScoreTrendsWorker({ signals });
  const b = runScoreTrendsWorker({ signals });
  assert.deepStrictEqual(a, b);
});

test('ScoreTrendsWorker: returns success with empty scored array when signals is empty', () => {
  const result = runScoreTrendsWorker({ signals: [] });
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(result.result.scored, []);
});

test('ScoreTrendsWorker: returns success with empty scored array when signals is missing', () => {
  const result = runScoreTrendsWorker({});
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(result.result.scored, []);
});

// ─── SelectCandidatesWorker ───────────────────────────────────────────────────

test('SelectCandidatesWorker: returns at most 3 candidates', () => {
  const scored = [
    { item: 'a', score: 10 },
    { item: 'b', score: 50 },
    { item: 'c', score: 30 },
    { item: 'd', score: 80 },
    { item: 'e', score: 5 }
  ];
  const result = runSelectCandidatesWorker({ scored });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.result.candidates.length, 3);
});

test('SelectCandidatesWorker: candidates are ordered by score descending', () => {
  const scored = [
    { item: 'low', score: 10 },
    { item: 'high', score: 90 },
    { item: 'mid', score: 50 }
  ];
  const result = runSelectCandidatesWorker({ scored });
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(result.result.candidates, ['high', 'mid', 'low']);
});

test('SelectCandidatesWorker: returns string values only (scores discarded)', () => {
  const scored = [{ item: 'x', score: 42 }];
  const result = runSelectCandidatesWorker({ scored });
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(result.result.candidates, ['x']);
});

test('SelectCandidatesWorker: output is deterministic', () => {
  const scored = [
    { item: 'cats', score: 37 },
    { item: 'cats_1', score: 51 },
    { item: 'cats_2', score: 22 }
  ];
  const a = runSelectCandidatesWorker({ scored });
  const b = runSelectCandidatesWorker({ scored });
  assert.deepStrictEqual(a, b);
});

test('SelectCandidatesWorker: returns success with empty candidates when scored is empty', () => {
  const result = runSelectCandidatesWorker({ scored: [] });
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(result.result.candidates, []);
});

test('SelectCandidatesWorker: returns success with empty candidates when scored is missing', () => {
  const result = runSelectCandidatesWorker({});
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(result.result.candidates, []);
});

// ─── ProduceFinalOutputWorker ─────────────────────────────────────────────────

test('ProduceFinalOutputWorker: returns candidates sorted alphabetically', () => {
  const candidates = ['zebra', 'apple', 'mango'];
  const result = runProduceFinalOutputWorker({ candidates });
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(result.result.ranked, ['apple', 'mango', 'zebra']);
});

test('ProduceFinalOutputWorker: output is deterministic', () => {
  const candidates = ['cats_1', 'cats', 'cats_2'];
  const a = runProduceFinalOutputWorker({ candidates });
  const b = runProduceFinalOutputWorker({ candidates });
  assert.deepStrictEqual(a, b);
});

test('ProduceFinalOutputWorker: returns success with empty ranked when candidates is empty', () => {
  const result = runProduceFinalOutputWorker({ candidates: [] });
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(result.result.ranked, []);
});

test('ProduceFinalOutputWorker: returns success with empty ranked when candidates is missing', () => {
  const result = runProduceFinalOutputWorker({});
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(result.result.ranked, []);
});

// ─── Full pipeline (workers chained together) ─────────────────────────────────

test('Full pipeline: CollectSignals → ScoreTrends → SelectCandidates → ProduceFinalOutput is deterministic', () => {
  const keyword = 'sneakers';

  const step1 = runCollectSignalsWorker({ keyword });
  assert.strictEqual(step1.success, true);

  const step2 = runScoreTrendsWorker({ signals: step1.result.signals });
  assert.strictEqual(step2.success, true);

  const step3 = runSelectCandidatesWorker({ scored: step2.result.scored });
  assert.strictEqual(step3.success, true);

  const step4 = runProduceFinalOutputWorker({ candidates: step3.result.candidates });
  assert.strictEqual(step4.success, true);

  // Ranked output is an array of strings
  assert.ok(Array.isArray(step4.result.ranked));
  assert.ok(step4.result.ranked.every((item) => typeof item === 'string'));

  // Running again yields the same result
  const step1b = runCollectSignalsWorker({ keyword });
  const step2b = runScoreTrendsWorker({ signals: step1b.result.signals });
  const step3b = runSelectCandidatesWorker({ scored: step2b.result.scored });
  const step4b = runProduceFinalOutputWorker({ candidates: step3b.result.candidates });

  assert.deepStrictEqual(step4.result.ranked, step4b.result.ranked);
});
