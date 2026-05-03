// core/workers/scoreTrendsWorker.js
/**
 * ScoreTrendsWorker
 *
 * Receives normalized trend signals and computes comparable, explainable
 * multi-factor scores for TrendResearch ranking.
 *
 * @param {{ normalizedSignals: Array<{ item: string, normalizedMetrics: {
 *   normalized_growth?: number,
 *   normalized_volume?: number,
 *   normalized_engagement?: number,
 *   normalized_novelty?: number,
 *   normalized_commercial_intent?: number,
 *   normalized_sentiment?: number,
 *   source_reliability_weight?: number,
 *   weightedPopularity?: number,
 *   weightedEngagement?: number,
 *   weightedVelocity?: number,
 *   popularity?: number,
 *   engagement?: number,
 *   velocity?: number,
 *   timeAlignment?: number,
 *   reliabilityWeight?: number
 * } }> }} input
 * @returns {{ success: boolean, result?: { ranked: Array<{ item: string, score: number, source?: string, explanation: object }>, scored: Array<{ item: string, score: number, source?: string, explanation: object }> }, error?: string }}
 */
export function runScoreTrendsWorker(input) {
  const SOURCE_BASELINE_RELIABILITY = {
    google_trends: 1,
    reddit: 0.7
  };

  const FACTOR_WEIGHTS = {
    normalized_growth: 0.24,
    normalized_volume: 0.22,
    normalized_engagement: 0.2,
    normalized_novelty: 0.16,
    normalized_commercial_intent: 0.14,
    normalized_sentiment: 0.04
  };

  const normalizedSignals = Array.isArray(input && input.normalizedSignals)
    ? input.normalizedSignals
    : [];

  if (input && Object.prototype.hasOwnProperty.call(input, 'signals') && normalizedSignals.length === 0) {
    return {
      success: false,
      error: 'normalized_signals_required'
    };
  }

  const toFinite01 = (value, fallback = 0) => {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return fallback;
    }
    if (number < 0) {
      return 0;
    }
    if (number > 1) {
      return 1;
    }
    return number;
  };

  const deriveFactorInputs = (signal, metrics) => {
    const normalized_volume = toFinite01(
      metrics.normalized_volume,
      toFinite01(metrics.weightedPopularity, toFinite01(metrics.popularity))
    );

    const normalized_engagement = toFinite01(
      metrics.normalized_engagement,
      toFinite01(metrics.weightedEngagement, toFinite01(metrics.engagement))
    );

    const normalized_growth = toFinite01(
      metrics.normalized_growth,
      toFinite01(metrics.weightedVelocity, toFinite01(metrics.velocity))
    );

    const normalized_novelty = toFinite01(
      metrics.normalized_novelty,
      toFinite01(metrics.timeAlignment)
    );

    const derivedCommercialIntent = (normalized_volume * 0.6) + (normalized_engagement * 0.4);
    const normalized_commercial_intent = toFinite01(
      metrics.normalized_commercial_intent,
      derivedCommercialIntent
    );

    // Optional, low-weight modifier. Neutral default keeps it non-dominant.
    const normalized_sentiment = toFinite01(metrics.normalized_sentiment, 0.5);

    const source = String(signal && signal.source ? signal.source : '').toLowerCase();
    const sourceBaseline = toFinite01(
      SOURCE_BASELINE_RELIABILITY[source],
      SOURCE_BASELINE_RELIABILITY.reddit
    );
    const source_reliability_weight = toFinite01(
      metrics.source_reliability_weight,
      toFinite01(metrics.reliabilityWeight, sourceBaseline)
    );

    return {
      normalized_growth,
      normalized_volume,
      normalized_engagement,
      normalized_novelty,
      normalized_commercial_intent,
      normalized_sentiment,
      source_reliability_weight
    };
  };

  const ranked = normalizedSignals.map((signal) => {
    const metrics = signal && signal.normalizedMetrics && typeof signal.normalizedMetrics === 'object'
      ? signal.normalizedMetrics
      : {};

    const factorInputs = deriveFactorInputs(signal, metrics);

    const contributions = {
      normalized_growth: factorInputs.normalized_growth * FACTOR_WEIGHTS.normalized_growth,
      normalized_volume: factorInputs.normalized_volume * FACTOR_WEIGHTS.normalized_volume,
      normalized_engagement: factorInputs.normalized_engagement * FACTOR_WEIGHTS.normalized_engagement,
      normalized_novelty: factorInputs.normalized_novelty * FACTOR_WEIGHTS.normalized_novelty,
      normalized_commercial_intent:
        factorInputs.normalized_commercial_intent * FACTOR_WEIGHTS.normalized_commercial_intent,
      normalized_sentiment: factorInputs.normalized_sentiment * FACTOR_WEIGHTS.normalized_sentiment
    };

    const baseScore = Object.values(contributions).reduce((sum, value) => sum + value, 0);
    const reliabilityScaledScore = baseScore * factorInputs.source_reliability_weight;
    const score = toFinite01(reliabilityScaledScore);

    const roundedScore = Math.round(score * 10000) / 10000;

    return {
      item: String(signal && signal.item ? signal.item : ''),
      source: signal && signal.source ? signal.source : undefined,
      score: roundedScore,
      explanation: {
        inputs: factorInputs,
        weights: FACTOR_WEIGHTS,
        contributions: {
          normalized_growth: Math.round(contributions.normalized_growth * 100000) / 100000,
          normalized_volume: Math.round(contributions.normalized_volume * 100000) / 100000,
          normalized_engagement: Math.round(contributions.normalized_engagement * 100000) / 100000,
          normalized_novelty: Math.round(contributions.normalized_novelty * 100000) / 100000,
          normalized_commercial_intent:
            Math.round(contributions.normalized_commercial_intent * 100000) / 100000,
          normalized_sentiment: Math.round(contributions.normalized_sentiment * 100000) / 100000,
          source_reliability_weight: factorInputs.source_reliability_weight
        },
        preReliabilityScore: Math.round(baseScore * 100000) / 100000,
        finalScore: roundedScore
      }
    };
  }).filter((entry) => entry.item)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return String(a.item).localeCompare(String(b.item));
    });

  return {
    success: true,
    result: {
      ranked,
      scored: ranked
    }
  };
}
