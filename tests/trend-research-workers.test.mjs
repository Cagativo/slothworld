// tests/trend-research-workers.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { runCollectSignalsWorker } from '../core/workers/collectSignalsWorker.js';
import { runSignalNormalizationWorker } from '../core/workers/signalNormalizationWorker.js';
import { runScoreTrendsWorker } from '../core/workers/scoreTrendsWorker.js';
import { runSelectCandidatesWorker } from '../core/workers/selectCandidatesWorker.js';
import { runProduceFinalOutputWorker } from '../core/workers/produceFinalOutputWorker.js';

// ─── CollectSignalsWorker ──────────────────────────────────────────────────────

test('CollectSignalsWorker: returns three signals for a valid keyword', async () => {
  const result = await runCollectSignalsWorker({ keyword: 'cats' });
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(result.result.signals, ['cats', 'cats_1', 'cats_2']);
});

test('CollectSignalsWorker: signals array always has length 3', async () => {
  const result = await runCollectSignalsWorker({ keyword: 'trending-now' });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.result.signals.length, 3);
});

test('CollectSignalsWorker: output is deterministic', async () => {
  const a = await runCollectSignalsWorker({ keyword: 'shoes' });
  const b = await runCollectSignalsWorker({ keyword: 'shoes' });
  assert.deepStrictEqual(a, b);
});

test('CollectSignalsWorker: returns rawSignals for normalization layer', async () => {
  const result = await runCollectSignalsWorker({ keyword: 'cats' });
  assert.strictEqual(result.success, true);
  assert.ok(Array.isArray(result.result.rawSignals));
  assert.ok(result.result.rawSignals.length > 0);
});

test('CollectSignalsWorker: fails when keyword is missing', async () => {
  const result = await runCollectSignalsWorker({});
  assert.strictEqual(result.success, false);
  assert.ok(result.error);
});

test('CollectSignalsWorker: fails when keyword is empty string', async () => {
  const result = await runCollectSignalsWorker({ keyword: '' });
  assert.strictEqual(result.success, false);
});

test('CollectSignalsWorker: trims whitespace from keyword', async () => {
  const result = await runCollectSignalsWorker({ keyword: '  hats  ' });
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(result.result.signals, ['hats', 'hats_1', 'hats_2']);
});

// ─── ScoreTrendsWorker ────────────────────────────────────────────────────────

// ─── SignalNormalizationWorker ────────────────────────────────────────────────

test('SignalNormalizationWorker: normalizes metrics to 0-1 ranges', () => {
  const result = runSignalNormalizationWorker({
    keyword: 'cats',
    rawSignals: [
      {
        source: 'google_trends',
        sourceItemId: 'g1',
        keyword: 'cats',
        text: 'cats',
        observedAt: 1_699_999_000_000,
        metrics: { popularity: 90, engagement: 40, velocity: 80 }
      },
      {
        source: 'reddit',
        sourceItemId: 'r1',
        keyword: 'cats',
        text: 'cats_1',
        observedAt: 1_699_900_000_000,
        metrics: { popularity: 10, engagement: 5, velocity: 20 }
      }
    ]
  });

  assert.strictEqual(result.success, true);
  assert.ok(result.result.normalizedSignals.length > 0);

  for (const signal of result.result.normalizedSignals) {
    const metrics = signal.normalizedMetrics;
    assert.ok(metrics.popularity >= 0 && metrics.popularity <= 1);
    assert.ok(metrics.engagement >= 0 && metrics.engagement <= 1);
    assert.ok(metrics.velocity >= 0 && metrics.velocity <= 1);
    assert.ok(metrics.weightedPopularity >= 0 && metrics.weightedPopularity <= 1);
    assert.ok(metrics.weightedEngagement >= 0 && metrics.weightedEngagement <= 1);
    assert.ok(metrics.weightedVelocity >= 0 && metrics.weightedVelocity <= 1);
    assert.ok(metrics.timeAlignment >= 0 && metrics.timeAlignment <= 1);
  }
});

test('SignalNormalizationWorker: applies source reliability weights (google > reddit)', () => {
  const result = runSignalNormalizationWorker({
    keyword: 'cats',
    rawSignals: [
      {
        source: 'google_trends',
        sourceItemId: 'g1',
        keyword: 'cats',
        text: 'cats',
        observedAt: 1_699_999_000_000,
        metrics: { popularity: 50, engagement: 50, velocity: 50 }
      },
      {
        source: 'reddit',
        sourceItemId: 'r1',
        keyword: 'cats',
        text: 'cats_1',
        observedAt: 1_699_999_000_000,
        metrics: { popularity: 50, engagement: 50, velocity: 50 }
      }
    ]
  });

  assert.strictEqual(result.success, true);

  const google = result.result.normalizedSignals.find((entry) => entry.source === 'google_trends');
  const reddit = result.result.normalizedSignals.find((entry) => entry.source === 'reddit');

  assert.ok(google);
  assert.ok(reddit);
  assert.ok(google.normalizedMetrics.reliabilityWeight > reddit.normalizedMetrics.reliabilityWeight);
});

test('SignalNormalizationWorker: aligns time-window buckets into comparable format', () => {
  const result = runSignalNormalizationWorker({
    keyword: 'cats',
    rawSignals: [
      {
        source: 'google_trends',
        sourceItemId: 'g1',
        keyword: 'cats',
        text: 'cats',
        observedAt: 1_699_999_000_000,
        metrics: { popularity: 5, engagement: 5, velocity: 5 }
      },
      {
        source: 'reddit',
        sourceItemId: 'r1',
        keyword: 'cats',
        text: 'cats_1',
        observedAt: 1_699_000_000_000,
        metrics: { popularity: 4, engagement: 4, velocity: 4 }
      }
    ]
  });

  assert.strictEqual(result.success, true);
  for (const signal of result.result.normalizedSignals) {
    const timeWindow = signal.normalizedMetrics.timeWindow;
    assert.ok([0, 1].includes(timeWindow.h1));
    assert.ok([0, 1].includes(timeWindow.h24));
    assert.ok([0, 1].includes(timeWindow.d7));
  }
});

test('ScoreTrendsWorker: returns a scored entry for each signal', () => {
  const normalizedSignals = [
    {
      item: 'cats',
      source: 'google_trends',
      normalizedMetrics: {
        normalized_growth: 0.9,
        normalized_volume: 0.9,
        normalized_engagement: 0.7,
        normalized_novelty: 1,
        normalized_commercial_intent: 0.8,
        normalized_sentiment: 0.6,
        source_reliability_weight: 1
      }
    },
    {
      item: 'cats_1',
      source: 'reddit',
      normalizedMetrics: {
        normalized_growth: 0.3,
        normalized_volume: 0.3,
        normalized_engagement: 0.2,
        normalized_novelty: 0.5,
        normalized_commercial_intent: 0.2,
        normalized_sentiment: 0.5,
        source_reliability_weight: 0.7
      }
    },
    {
      item: 'cats_2',
      source: 'reddit',
      normalizedMetrics: {
        normalized_growth: 0.2,
        normalized_volume: 0.2,
        normalized_engagement: 0.2,
        normalized_novelty: 0.2,
        normalized_commercial_intent: 0.2,
        normalized_sentiment: 0.5,
        source_reliability_weight: 0.7
      }
    }
  ];

  const result = runScoreTrendsWorker({ normalizedSignals });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.result.scored.length, 3);
  assert.strictEqual(result.result.ranked.length, 3);
  assert.deepStrictEqual(result.result.ranked, result.result.scored);
});

test('ScoreTrendsWorker: each scored entry has item and numeric score', () => {
  const normalizedSignals = [
    {
      item: 'alpha',
      source: 'google_trends',
      normalizedMetrics: {
        normalized_growth: 1,
        normalized_volume: 1,
        normalized_engagement: 1,
        normalized_novelty: 1,
        normalized_commercial_intent: 1,
        normalized_sentiment: 1,
        source_reliability_weight: 1
      }
    }
  ];

  const result = runScoreTrendsWorker({ normalizedSignals });
  assert.strictEqual(result.success, true);
  for (const entry of result.result.scored) {
    assert.strictEqual(typeof entry.item, 'string');
    assert.strictEqual(typeof entry.score, 'number');
    assert.ok(Number.isFinite(entry.score));
    assert.ok(entry.score >= 0 && entry.score <= 1);
    assert.ok(entry.explanation && typeof entry.explanation === 'object');
    assert.ok(entry.explanation.contributions && typeof entry.explanation.contributions === 'object');
  }
});

test('ScoreTrendsWorker: scores are deterministic', () => {
  const normalizedSignals = [
    {
      item: 'cats',
      source: 'google_trends',
      normalizedMetrics: {
        normalized_growth: 0.7,
        normalized_volume: 0.7,
        normalized_engagement: 0.7,
        normalized_novelty: 0.7,
        normalized_commercial_intent: 0.7,
        normalized_sentiment: 0.7,
        source_reliability_weight: 1
      }
    }
  ];

  const a = runScoreTrendsWorker({ normalizedSignals });
  const b = runScoreTrendsWorker({ normalizedSignals });
  assert.deepStrictEqual(a, b);
});

test('ScoreTrendsWorker: ranks trends by score descending', () => {
  const normalizedSignals = [
    {
      item: 'low',
      source: 'reddit',
      normalizedMetrics: {
        normalized_growth: 0.1,
        normalized_volume: 0.1,
        normalized_engagement: 0.1,
        normalized_novelty: 0.1,
        normalized_commercial_intent: 0.1,
        normalized_sentiment: 0.5,
        source_reliability_weight: 0.7
      }
    },
    {
      item: 'high',
      source: 'google_trends',
      normalizedMetrics: {
        normalized_growth: 1,
        normalized_volume: 1,
        normalized_engagement: 1,
        normalized_novelty: 1,
        normalized_commercial_intent: 1,
        normalized_sentiment: 1,
        source_reliability_weight: 1
      }
    }
  ];

  const result = runScoreTrendsWorker({ normalizedSignals });
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(result.result.ranked.map((entry) => entry.item), ['high', 'low']);
});

test('ScoreTrendsWorker: source reliability baseline prefers google over reddit when factors tie', () => {
  const sharedMetrics = {
    normalized_growth: 0.8,
    normalized_volume: 0.8,
    normalized_engagement: 0.8,
    normalized_novelty: 0.8,
    normalized_commercial_intent: 0.8,
    normalized_sentiment: 0.5
  };

  const result = runScoreTrendsWorker({
    normalizedSignals: [
      { item: 'g', source: 'google_trends', normalizedMetrics: { ...sharedMetrics } },
      { item: 'r', source: 'reddit', normalizedMetrics: { ...sharedMetrics } }
    ]
  });

  assert.strictEqual(result.success, true);
  const google = result.result.ranked.find((entry) => entry.item === 'g');
  const reddit = result.result.ranked.find((entry) => entry.item === 'r');
  assert.ok(google.score > reddit.score);
});

test('ScoreTrendsWorker: returns success with empty scored array when normalizedSignals is empty', () => {
  const result = runScoreTrendsWorker({ normalizedSignals: [] });
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(result.result.scored, []);
});

test('ScoreTrendsWorker: returns success with empty scored array when normalizedSignals is missing', () => {
  const result = runScoreTrendsWorker({});
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(result.result.scored, []);
});

test('ScoreTrendsWorker: fails when raw signals input is provided', () => {
  const result = runScoreTrendsWorker({ signals: ['cats'] });
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.error, 'normalized_signals_required');
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

test('SelectCandidatesWorker: candidates preserve { item, score } objects ordered by score descending', () => {
  const scored = [
    { item: 'low', score: 10 },
    { item: 'high', score: 90 },
    { item: 'mid', score: 50 }
  ];
  const result = runSelectCandidatesWorker({ scored });
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(result.result.candidates, [
    { item: 'high', score: 90 },
    { item: 'mid', score: 50 },
    { item: 'low', score: 10 }
  ]);
});

test('SelectCandidatesWorker: passes score through to candidates', () => {
  const scored = [{ item: 'x', score: 42 }];
  const result = runSelectCandidatesWorker({ scored });
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(result.result.candidates, [{ item: 'x', score: 42 }]);
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

test('ProduceFinalOutputWorker: returns items sorted by score descending', () => {
  const candidates = [
    { item: 'apple', score: 10 },
    { item: 'zebra', score: 80 },
    { item: 'mango', score: 50 }
  ];
  const result = runProduceFinalOutputWorker({ candidates });
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(result.result.ranked, ['zebra', 'mango', 'apple']);
});

test('ProduceFinalOutputWorker: output is deterministic', () => {
  const candidates = [
    { item: 'cats_1', score: 51 },
    { item: 'cats', score: 37 },
    { item: 'cats_2', score: 22 }
  ];
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

test('Full pipeline: CollectSignals → ScoreTrends → SelectCandidates → ProduceFinalOutput is deterministic', async () => {
  const keyword = 'sneakers';

  const step1 = await runCollectSignalsWorker({ keyword });
  assert.strictEqual(step1.success, true);

  const normalizeStep = runSignalNormalizationWorker({
    keyword,
    signals: step1.result.signals,
    rawSignals: step1.result.rawSignals
  });
  assert.strictEqual(normalizeStep.success, true);

  const step2 = runScoreTrendsWorker({ normalizedSignals: normalizeStep.result.normalizedSignals });
  assert.strictEqual(step2.success, true);

  const step3 = runSelectCandidatesWorker({ scored: step2.result.scored });
  assert.strictEqual(step3.success, true);

  const step4 = runProduceFinalOutputWorker({ candidates: step3.result.candidates });
  assert.strictEqual(step4.success, true);

  // Ranked output is an array of strings
  assert.ok(Array.isArray(step4.result.ranked));
  assert.ok(step4.result.ranked.every((item) => typeof item === 'string'));

  // Running again yields the same result
  const step1b = await runCollectSignalsWorker({ keyword });
  const normalizeStepB = runSignalNormalizationWorker({
    keyword,
    signals: step1b.result.signals,
    rawSignals: step1b.result.rawSignals
  });
  const step2b = runScoreTrendsWorker({ normalizedSignals: normalizeStepB.result.normalizedSignals });
  const step3b = runSelectCandidatesWorker({ scored: step2b.result.scored });
  const step4b = runProduceFinalOutputWorker({ candidates: step3b.result.candidates });

  assert.deepStrictEqual(step4.result.ranked, step4b.result.ranked);
});
