const SOURCE_RELIABILITY_WEIGHTS = {
  google_trends: 1,
  reddit: 0.7
};

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const SEVEN_DAYS_MS = 7 * ONE_DAY_MS;
const DEFAULT_TIME_REFERENCE_MS = 1_700_000_000_000;

function cleanupText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }

  if (number < 0) {
    return 0;
  }

  if (number > 1) {
    return 1;
  }

  return number;
}

function toNonNegativeNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return 0;
  }
  return number;
}

function normalizeField(values, currentValue) {
  const safeCurrent = toNonNegativeNumber(currentValue);
  if (!Array.isArray(values) || values.length === 0) {
    return safeCurrent > 0 ? 1 : 0;
  }

  const safeValues = values.map(toNonNegativeNumber);
  const min = Math.min(...safeValues);
  const max = Math.max(...safeValues);

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return safeCurrent > 0 ? 1 : 0;
  }

  if (max === min) {
    return safeCurrent > 0 ? 1 : 0;
  }

  return clamp01((safeCurrent - min) / (max - min));
}

function deriveTimeWindowBuckets(observedAt, nowMs) {
  const observedAtMs = Number(observedAt);
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : DEFAULT_TIME_REFERENCE_MS;
  const fallbackObservedAt = safeNowMs - ONE_HOUR_MS;
  const safeObservedAt = Number.isFinite(observedAtMs) && observedAtMs > 0
    ? observedAtMs
    : fallbackObservedAt;

  const ageMs = Math.max(0, safeNowMs - safeObservedAt);

  return {
    h1: ageMs <= ONE_HOUR_MS ? 1 : 0,
    h24: ageMs <= ONE_DAY_MS ? 1 : 0,
    d7: ageMs <= SEVEN_DAYS_MS ? 1 : 0
  };
}

function buildRawSignalFromString(item, keyword) {
  const text = cleanupText(item);
  if (!text) {
    return null;
  }

  return {
    source: 'reddit',
    sourceItemId: `fallback_${text.toLowerCase().replace(/[^a-z0-9_]+/g, '_')}`,
    keyword: cleanupText(keyword),
    text,
    url: 'https://www.reddit.com/',
    observedAt: DEFAULT_TIME_REFERENCE_MS - ONE_DAY_MS,
    metrics: {
      popularity: 1,
      engagement: 1,
      velocity: 1
    }
  };
}

function toRawSignals(input) {
  const rawSignals = Array.isArray(input && input.rawSignals) ? input.rawSignals : [];
  if (rawSignals.length > 0) {
    return rawSignals;
  }

  const signals = Array.isArray(input && input.signals) ? input.signals : [];
  const keyword = cleanupText(input && input.keyword);

  return signals
    .map((item) => buildRawSignalFromString(item, keyword))
    .filter(Boolean);
}

function isValidRawSignal(signal) {
  if (!signal || typeof signal !== 'object') {
    return false;
  }

  if (!signal.source || typeof signal.source !== 'string') {
    return false;
  }

  if (!signal.sourceItemId || typeof signal.sourceItemId !== 'string') {
    return false;
  }

  if (!signal.text || typeof signal.text !== 'string') {
    return false;
  }

  return signal.metrics && typeof signal.metrics === 'object';
}

export function runSignalNormalizationWorker(input) {
  const rawSignals = toRawSignals(input).filter(isValidRawSignal);

  if (rawSignals.length === 0) {
    return {
      success: true,
      result: {
        normalizedSignals: []
      }
    };
  }

  const popularityValues = rawSignals.map((signal) => signal.metrics.popularity);
  const engagementValues = rawSignals.map((signal) => signal.metrics.engagement);
  const velocityValues = rawSignals.map((signal) => signal.metrics.velocity);

  const nowMs = DEFAULT_TIME_REFERENCE_MS;

  const normalizedSignals = rawSignals.map((signal) => {
    const popularity = normalizeField(popularityValues, signal.metrics.popularity);
    const engagement = normalizeField(engagementValues, signal.metrics.engagement);
    const velocity = normalizeField(velocityValues, signal.metrics.velocity);

    const timeWindow = deriveTimeWindowBuckets(signal.observedAt, nowMs);
    const timeAlignment = clamp01(
      timeWindow.h1 * 0.5
      + timeWindow.h24 * 0.3
      + timeWindow.d7 * 0.2
    );

    const reliabilityWeight = clamp01(
      SOURCE_RELIABILITY_WEIGHTS[signal.source] || SOURCE_RELIABILITY_WEIGHTS.reddit
    );

    return {
      item: cleanupText(signal.text),
      source: signal.source,
      sourceItemId: cleanupText(signal.sourceItemId),
      keyword: cleanupText(signal.keyword),
      normalizedMetrics: {
        popularity,
        engagement,
        velocity,
        timeWindow,
        timeAlignment,
        reliabilityWeight,
        weightedPopularity: clamp01(popularity * reliabilityWeight),
        weightedEngagement: clamp01(engagement * reliabilityWeight),
        weightedVelocity: clamp01(velocity * reliabilityWeight)
      }
    };
  });

  return {
    success: true,
    result: {
      normalizedSignals
    }
  };
}
