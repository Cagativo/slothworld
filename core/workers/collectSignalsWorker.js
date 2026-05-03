// core/workers/collectSignalsWorker.js
import { runSignalNormalizationWorker } from './signalNormalizationWorker.js';

const TREND_SOURCES = {
  GOOGLE_TRENDS: 'google_trends',
  REDDIT: 'reddit'
};

const LIVE_MODE_ENV = 'TREND_SIGNALS_LIVE_MODE';
const DEFAULT_ADAPTER_TIMEOUT_MS = 3_000;
const MAX_SIGNALS_PER_ADAPTER = 6;
const MIN_RELEVANCE_THRESHOLD = 0.3;

const KEYWORD_SYNONYMS = {
  cat: ['cats', 'kitten', 'kittens', 'feline', 'pet', 'pets'],
  cats: ['cat', 'kitten', 'kittens', 'feline', 'pet', 'pets'],
  dog: ['dogs', 'puppy', 'puppies', 'canine', 'pet', 'pets'],
  dogs: ['dog', 'puppy', 'puppies', 'canine', 'pet', 'pets'],
  sneaker: ['sneakers', 'shoe', 'shoes', 'footwear', 'trainer', 'trainers'],
  sneakers: ['sneaker', 'shoe', 'shoes', 'footwear', 'trainer', 'trainers'],
  shoe: ['shoes', 'sneaker', 'sneakers', 'footwear'],
  shoes: ['shoe', 'sneaker', 'sneakers', 'footwear'],
  coffee: ['espresso', 'latte', 'cappuccino', 'cafe'],
  fitness: ['workout', 'exercise', 'training', 'wellness'],
  protein: ['nutrition', 'supplement', 'supplements']
};

function getAdapterConfigStatus(adapterId) {
  // Google Trends RSS and public Reddit search do not require secrets in this implementation.
  if (adapterId === TREND_SOURCES.GOOGLE_TRENDS || adapterId === TREND_SOURCES.REDDIT) {
    return {
      usesRealApi: true,
      skipped: false,
      missingConfig: []
    };
  }

  return {
    usesRealApi: false,
    skipped: true,
    missingConfig: ['unsupported_adapter']
  };
}

function logAdapterStart(adapterId, configStatus) {
  console.log('[TREND_ADAPTER_START]', {
    adapter: adapterId,
    mode: configStatus && configStatus.skipped ? 'skipped_missing_config' : 'real_api',
    missingConfig: configStatus && Array.isArray(configStatus.missingConfig)
      ? configStatus.missingConfig
      : []
  });
}

function logFallbackTriggered(reason, details = {}) {
  console.warn('[TREND_FALLBACK_TRIGGERED]', {
    reason,
    ...details
  });
}

function normalizeKeyword(input) {
  return input && typeof input.keyword === 'string' ? input.keyword.trim() : '';
}

function normalizeForMatch(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toTokens(value) {
  const normalized = normalizeForMatch(value);
  if (!normalized) {
    return [];
  }

  return normalized.split(' ').filter(Boolean);
}

function levenshteinDistance(a, b) {
  const left = String(a || '');
  const right = String(b || '');

  if (!left) {
    return right.length;
  }

  if (!right) {
    return left.length;
  }

  const matrix = Array.from({ length: left.length + 1 }, () => new Array(right.length + 1).fill(0));

  for (let i = 0; i <= left.length; i += 1) {
    matrix[i][0] = i;
  }

  for (let j = 0; j <= right.length; j += 1) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[left.length][right.length];
}

function hasTokenFuzzyMatch(keywordTokens, signalTokens) {
  const FUZZY_SIMILARITY_THRESHOLD = 0.78;

  for (const keywordToken of keywordTokens) {
    for (const signalToken of signalTokens) {
      const maxLength = Math.max(keywordToken.length, signalToken.length);
      if (maxLength === 0) {
        continue;
      }

      const distance = levenshteinDistance(keywordToken, signalToken);
      const similarity = 1 - (distance / maxLength);
      if (similarity >= FUZZY_SIMILARITY_THRESHOLD) {
        return true;
      }
    }
  }

  return false;
}

function getMaxTokenSimilarity(keywordTokens, signalTokens) {
  let maxSimilarity = 0;

  for (const keywordToken of keywordTokens) {
    for (const signalToken of signalTokens) {
      const maxLength = Math.max(keywordToken.length, signalToken.length);
      if (maxLength === 0) {
        continue;
      }

      const distance = levenshteinDistance(keywordToken, signalToken);
      const similarity = 1 - (distance / maxLength);
      if (similarity > maxSimilarity) {
        maxSimilarity = similarity;
      }
    }
  }

  return maxSimilarity;
}

function hasPartialTokenMatch(keywordTokens, signalTokens) {
  for (const keywordToken of keywordTokens) {
    for (const signalToken of signalTokens) {
      if (keywordToken.includes(signalToken) || signalToken.includes(keywordToken)) {
        return true;
      }
    }
  }

  return false;
}

function expandTokensWithSynonyms(tokens) {
  const expanded = new Set(tokens);
  for (const token of tokens) {
    const synonyms = KEYWORD_SYNONYMS[token] || [];
    for (const synonym of synonyms) {
      const normalizedSynonym = normalizeForMatch(synonym);
      if (normalizedSynonym) {
        expanded.add(normalizedSynonym);
      }
    }
  }
  return expanded;
}

function getSignalRelevanceScore(signalText, keyword) {
  const normalizedKeyword = normalizeForMatch(keyword);
  const normalizedSignalText = normalizeForMatch(signalText);

  if (!normalizedKeyword || !normalizedSignalText) {
    return 0;
  }

  const keywordTokens = toTokens(normalizedKeyword);
  const signalTokens = toTokens(normalizedSignalText);
  if (keywordTokens.length === 0 || signalTokens.length === 0) {
    return 0;
  }

  const signalTokenSet = new Set(signalTokens);
  const expandedKeywordTokens = expandTokensWithSynonyms(keywordTokens);

  // Preserve strict match behavior: direct substring is highest-confidence relevance.
  if (
    normalizedSignalText.includes(normalizedKeyword)
    || normalizedKeyword.includes(normalizedSignalText)
  ) {
    return 1;
  }

  let score = 0;

  // Exact token overlap, including expanded synonym tokens.
  let overlapCount = 0;
  for (const token of expandedKeywordTokens) {
    if (signalTokenSet.has(token)) {
      overlapCount += 1;
    }
  }
  if (overlapCount > 0) {
    const overlapRatio = overlapCount / Math.max(1, expandedKeywordTokens.size);
    score = Math.max(score, 0.65 + (0.3 * overlapRatio));
  }

  // Partial token relationship catches close phrase variants.
  if (hasPartialTokenMatch(Array.from(expandedKeywordTokens), signalTokens)) {
    score = Math.max(score, 0.55);
  }

  // Basic fuzzy token similarity.
  const maxTokenSimilarity = getMaxTokenSimilarity(Array.from(expandedKeywordTokens), signalTokens);
  if (maxTokenSimilarity >= 0.78) {
    score = Math.max(score, 0.52 + (0.35 * maxTokenSimilarity));
  }

  // Close semantics via weak fuzzy relationship should still survive if above threshold.
  if (score === 0 && hasTokenFuzzyMatch(Array.from(expandedKeywordTokens), signalTokens)) {
    score = 0.45;
  }

  if (score > 1) {
    return 1;
  }

  if (score < 0) {
    return 0;
  }

  return Number(score.toFixed(3));
}

function logRelevanceScores(keyword, relevanceEvaluations) {
  const sample = relevanceEvaluations.slice(0, 10).map((entry) => ({
    item: entry.item,
    sourceItemId: entry.sourceItemId,
    relevanceScore: entry.relevanceScore,
    kept: entry.kept
  }));

  console.log('[TREND_RELEVANCE_SCORES]', {
    keyword,
    threshold: MIN_RELEVANCE_THRESHOLD,
    sample
  });
}

function applyKeywordRelevanceFilter(keyword, signals, rawSignals) {
  const normalizedResult = runSignalNormalizationWorker({
    keyword,
    signals,
    rawSignals
  });

  const normalizedSignals = normalizedResult
    && normalizedResult.success
    && normalizedResult.result
    && Array.isArray(normalizedResult.result.normalizedSignals)
    ? normalizedResult.result.normalizedSignals
    : [];

  const relevantSourceItemIds = new Set();
  let droppedIrrelevant = 0;
  const relevanceEvaluations = [];

  for (const normalizedSignal of normalizedSignals) {
    const signalText = normalizedSignal && normalizedSignal.item ? normalizedSignal.item : '';
    const relevanceScore = getSignalRelevanceScore(signalText, keyword);
    const keepSignal = relevanceScore >= MIN_RELEVANCE_THRESHOLD;

    relevanceEvaluations.push({
      item: signalText,
      sourceItemId: normalizedSignal && normalizedSignal.sourceItemId
        ? String(normalizedSignal.sourceItemId)
        : null,
      relevanceScore,
      kept: keepSignal
    });

    if (keepSignal) {
      if (normalizedSignal && normalizedSignal.sourceItemId) {
        relevantSourceItemIds.add(String(normalizedSignal.sourceItemId));
      }
    } else {
      droppedIrrelevant += 1;
    }
  }

  let filteredRawSignals;
  if (relevantSourceItemIds.size > 0) {
    filteredRawSignals = rawSignals.filter((signal) => relevantSourceItemIds.has(String(signal.sourceItemId || '')));
  } else {
    filteredRawSignals = [];
  }

  const filteredSignals = toSignalsArray(filteredRawSignals, keyword);
  logRelevanceScores(keyword, relevanceEvaluations);

  console.log('[TREND_RELEVANCE_FILTER]', {
    keyword,
    threshold: MIN_RELEVANCE_THRESHOLD,
    totalBefore: normalizedSignals.length,
    droppedIrrelevant,
    kept: Math.max(0, normalizedSignals.length - droppedIrrelevant)
  });

  return {
    filteredSignals,
    filteredRawSignals,
    droppedIrrelevant
  };
}

function logAdapterCounts(adapterCounts) {
  console.log('[TREND_DEBUG_ADAPTER_COUNTS]', {
    googleTrends: Number(adapterCounts[TREND_SOURCES.GOOGLE_TRENDS] || 0),
    reddit: Number(adapterCounts[TREND_SOURCES.REDDIT] || 0)
  });
}

function logNormalizedSample(keyword, signals, rawSignals) {
  try {
    const normalized = runSignalNormalizationWorker({
      keyword,
      signals,
      rawSignals
    });

    const sample = normalized
      && normalized.success
      && normalized.result
      && Array.isArray(normalized.result.normalizedSignals)
      ? normalized.result.normalizedSignals.slice(0, 2)
      : [];

    console.log('[TREND_DEBUG_NORMALIZED_SAMPLE]', { sample });
  } catch (error) {
    console.warn('[TREND_DEBUG_NORMALIZED_SAMPLE_FAILED]', {
      reason: error && error.message ? error.message : String(error || 'unknown_error')
    });
  }
}

function getDeterministicFallbackSignals(keyword) {
  return [keyword, `${keyword}_1`, `${keyword}_2`];
}

function getDeterministicFallbackRawSignals(keyword) {
  return getDeterministicFallbackSignals(keyword).map((item, index) => {
    const source = index === 0 ? TREND_SOURCES.GOOGLE_TRENDS : TREND_SOURCES.REDDIT;

    return createTrendSignal({
      source,
      sourceItemId: `${source}_${item.toLowerCase()}`,
      keyword,
      text: item,
      url: source === TREND_SOURCES.GOOGLE_TRENDS
        ? 'https://trends.google.com/'
        : 'https://www.reddit.com/',
      // Deterministic synthetic timeline: 1h, 24h and 7d buckets.
      observedAt: [
        1_700_000_000_000,
        1_699_920_000_000,
        1_699_481_600_000
      ][index] || 1_700_000_000_000,
      metrics: {
        popularity: 3 - index,
        engagement: Math.max(1, 2 - index),
        velocity: Math.max(1, 3 - index)
      }
    });
  });
}

function isLiveModeEnabled() {
  return String(process.env[LIVE_MODE_ENV] || '').toLowerCase() === 'true';
}

function getAdapterTimeoutMs() {
  const raw = Number(process.env.TREND_SIGNALS_TIMEOUT_MS || DEFAULT_ADAPTER_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_ADAPTER_TIMEOUT_MS;
  }
  return Math.floor(raw);
}

function withTimeout(promise, timeoutMs, label) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label}_timeout:${timeoutMs}`)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timeoutId);
  });
}

function cleanupText(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function coerceNonNegativeNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return 0;
  }
  return number;
}

function coerceTimestampMs(value, fallback = Date.now()) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }

  // Reddit created_utc is in seconds.
  if (number < 1e12) {
    return Math.floor(number * 1000);
  }

  return Math.floor(number);
}

function createTrendSignal({ source, sourceItemId, keyword, text, url, observedAt, metrics }) {
  return {
    source,
    sourceItemId,
    keyword,
    text,
    url,
    observedAt,
    metrics: {
      popularity: coerceNonNegativeNumber(metrics && metrics.popularity),
      engagement: coerceNonNegativeNumber(metrics && metrics.engagement),
      velocity: coerceNonNegativeNumber(metrics && metrics.velocity)
    }
  };
}

function validateTrendSignal(signal) {
  if (!signal || typeof signal !== 'object') {
    return false;
  }

  if (!Object.values(TREND_SOURCES).includes(signal.source)) {
    return false;
  }

  if (typeof signal.sourceItemId !== 'string' || !signal.sourceItemId.trim()) {
    return false;
  }

  if (typeof signal.keyword !== 'string' || !signal.keyword.trim()) {
    return false;
  }

  if (typeof signal.text !== 'string' || !signal.text.trim()) {
    return false;
  }

  if (typeof signal.url !== 'string' || !signal.url.trim()) {
    return false;
  }

  if (!Number.isFinite(signal.observedAt) || signal.observedAt <= 0) {
    return false;
  }

  const metrics = signal.metrics;
  if (!metrics || typeof metrics !== 'object') {
    return false;
  }

  if (!Number.isFinite(metrics.popularity) || metrics.popularity < 0) {
    return false;
  }

  if (!Number.isFinite(metrics.engagement) || metrics.engagement < 0) {
    return false;
  }

  if (!Number.isFinite(metrics.velocity) || metrics.velocity < 0) {
    return false;
  }

  return true;
}

function logInvalidSignal(signal, reason) {
  console.warn('[TREND_SIGNAL_DROPPED_INVALID]', {
    reason,
    source: signal && signal.source ? signal.source : 'unknown',
    sourceItemId: signal && signal.sourceItemId ? signal.sourceItemId : null
  });
}

function toSignalsArray(validTrendSignals, keyword) {
  const deduped = [];
  const seen = new Set();

  for (const trendSignal of validTrendSignals) {
    const normalizedText = cleanupText(trendSignal.text).toLowerCase();
    if (!normalizedText || seen.has(normalizedText)) {
      continue;
    }
    seen.add(normalizedText);
    deduped.push(cleanupText(trendSignal.text));
  }

  if (deduped.length > 0) {
    return deduped;
  }

  return getDeterministicFallbackSignals(keyword);
}

async function fetchGoogleTrendsSignals(keyword, timeoutMs) {
  try {
    const configStatus = getAdapterConfigStatus(TREND_SOURCES.GOOGLE_TRENDS);
    logAdapterStart(TREND_SOURCES.GOOGLE_TRENDS, configStatus);

    if (configStatus.skipped) {
      console.warn('[TREND_ADAPTER_SKIPPED_CONFIG_MISSING]', {
        adapter: TREND_SOURCES.GOOGLE_TRENDS,
        missingConfig: configStatus.missingConfig
      });
      return [];
    }

    const rssUrl = 'https://trends.google.com/trending/rss?geo=US';
    const response = await withTimeout(
      fetch(rssUrl, {
        headers: {
          'User-Agent': 'slothworld-trend-worker/1.0'
        }
      }),
      timeoutMs,
      'google_trends_fetch'
    );

    if (!response.ok) {
      throw new Error(`google_trends_http_${response.status}`);
    }

    const xml = await withTimeout(response.text(), timeoutMs, 'google_trends_read');
    const allMatches = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
    console.log('[TREND_ADAPTER_RAW_ITEMS]', {
      adapter: TREND_SOURCES.GOOGLE_TRENDS,
      rawItemCount: allMatches.length
    });

    const matches = allMatches.slice(0, MAX_SIGNALS_PER_ADAPTER);

    return matches.map((match, index) => {
      const item = match[1] || '';
      const titleMatch = item.match(/<title>([\s\S]*?)<\/title>/i);
      const linkMatch = item.match(/<link>([\s\S]*?)<\/link>/i);
      const pubDateMatch = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);

      const title = cleanupText(titleMatch ? titleMatch[1] : keyword);
      const link = cleanupText(linkMatch ? linkMatch[1] : 'https://trends.google.com/');
      const observedAt = coerceTimestampMs(Date.parse(pubDateMatch ? pubDateMatch[1] : ''), Date.now());

      return createTrendSignal({
        source: TREND_SOURCES.GOOGLE_TRENDS,
        sourceItemId: `google_trends_${index}_${title.toLowerCase()}`,
        keyword,
        text: title,
        url: link,
        observedAt,
        metrics: {
          popularity: MAX_SIGNALS_PER_ADAPTER - index,
          engagement: 0,
          velocity: 1
        }
      });
    });
  } catch (error) {
    console.error('[TREND_ADAPTER_ERROR]', {
      adapter: TREND_SOURCES.GOOGLE_TRENDS,
      error: error && error.message ? error.message : String(error || 'unknown_error')
    });
    throw error;
  }
}

async function fetchRedditSignals(keyword, timeoutMs) {
  try {
    const configStatus = getAdapterConfigStatus(TREND_SOURCES.REDDIT);
    logAdapterStart(TREND_SOURCES.REDDIT, configStatus);

    if (configStatus.skipped) {
      console.warn('[TREND_ADAPTER_SKIPPED_CONFIG_MISSING]', {
        adapter: TREND_SOURCES.REDDIT,
        missingConfig: configStatus.missingConfig
      });
      return [];
    }

    const redditUrl = new URL('https://www.reddit.com/search.json');
    redditUrl.searchParams.set('q', keyword);
    redditUrl.searchParams.set('sort', 'top');
    redditUrl.searchParams.set('t', 'day');
    redditUrl.searchParams.set('limit', String(MAX_SIGNALS_PER_ADAPTER));
    redditUrl.searchParams.set('restrict_sr', 'false');

    const response = await withTimeout(
      fetch(redditUrl.toString(), {
        headers: {
          'User-Agent': 'slothworld-trend-worker/1.0'
        }
      }),
      timeoutMs,
      'reddit_fetch'
    );

    if (!response.ok) {
      throw new Error(`reddit_http_${response.status}`);
    }

    const payload = await withTimeout(response.json(), timeoutMs, 'reddit_read');
    const children = payload && payload.data && Array.isArray(payload.data.children)
      ? payload.data.children
      : [];

    console.log('[TREND_ADAPTER_RAW_ITEMS]', {
      adapter: TREND_SOURCES.REDDIT,
      rawItemCount: children.length
    });

    return children.slice(0, MAX_SIGNALS_PER_ADAPTER).map((entry, index) => {
      const data = entry && entry.data && typeof entry.data === 'object' ? entry.data : {};
      const title = cleanupText(data.title || keyword);
      const permalink = typeof data.permalink === 'string' ? data.permalink : '';
      const url = permalink ? `https://www.reddit.com${permalink}` : 'https://www.reddit.com/';

      return createTrendSignal({
        source: TREND_SOURCES.REDDIT,
        sourceItemId: String(data.id || `reddit_${index}`),
        keyword,
        text: title,
        url,
        observedAt: coerceTimestampMs(data.created_utc, Date.now()),
        metrics: {
          popularity: coerceNonNegativeNumber(data.score),
          engagement: coerceNonNegativeNumber(data.num_comments),
          velocity: 1
        }
      });
    });
  } catch (error) {
    console.error('[TREND_ADAPTER_ERROR]', {
      adapter: TREND_SOURCES.REDDIT,
      error: error && error.message ? error.message : String(error || 'unknown_error')
    });
    throw error;
  }
}

async function collectLiveTrendSignals(keyword) {
  const timeoutMs = getAdapterTimeoutMs();
  const adapters = [
    { id: TREND_SOURCES.GOOGLE_TRENDS, run: fetchGoogleTrendsSignals },
    { id: TREND_SOURCES.REDDIT, run: fetchRedditSignals }
  ];
  const adapterCounts = {
    [TREND_SOURCES.GOOGLE_TRENDS]: 0,
    [TREND_SOURCES.REDDIT]: 0
  };

  const settled = await Promise.allSettled(
    adapters.map((adapter) => adapter.run(keyword, timeoutMs))
  );

  const trendSignals = [];
  for (let index = 0; index < settled.length; index += 1) {
    const result = settled[index];
    const adapterId = adapters[index].id;

    if (result.status !== 'fulfilled') {
      console.warn('[TREND_ADAPTER_FAILED]', {
        adapter: adapterId,
        error: result.reason && result.reason.message ? result.reason.message : String(result.reason || 'unknown_error')
      });
      continue;
    }

    const adapterSignals = Array.isArray(result.value) ? result.value : [];
    for (const signal of adapterSignals) {
      if (!validateTrendSignal(signal)) {
        logInvalidSignal(signal, 'schema_validation_failed');
        continue;
      }
      trendSignals.push(signal);
      adapterCounts[adapterId] = Number(adapterCounts[adapterId] || 0) + 1;
    }
  }

  logAdapterCounts(adapterCounts);

  return trendSignals;
}

/**
 * CollectSignalsWorker
 *
 * Default behavior is deterministic signal generation. Live external adapters
 * are opt-in via TREND_SIGNALS_LIVE_MODE=true.
 *
 * @param {{ keyword: string }} input
 * @returns {Promise<{ success: boolean, result?: { signals: string[] }, error?: string }>}
 */
export async function runCollectSignalsWorker(input) {
  const keyword = normalizeKeyword(input);

  if (!keyword) {
    return { success: false, error: 'missing_keyword' };
  }

  if (!isLiveModeEnabled()) {
    const fallbackSignals = getDeterministicFallbackSignals(keyword);
    const rawSignals = getDeterministicFallbackRawSignals(keyword);
    const relevanceFiltered = applyKeywordRelevanceFilter(keyword, fallbackSignals, rawSignals);
    logFallbackTriggered('config_missing', {
      detail: 'live_mode_disabled_or_missing_config',
      liveModeEnv: LIVE_MODE_ENV
    });
    logNormalizedSample(keyword, relevanceFiltered.filteredSignals, relevanceFiltered.filteredRawSignals);

    return {
      success: true,
      result: {
        signals: relevanceFiltered.filteredSignals,
        rawSignals: relevanceFiltered.filteredRawSignals
      }
    };
  }

  try {
    const trendSignals = await collectLiveTrendSignals(keyword);
    const signals = toSignalsArray(trendSignals, keyword);
    const relevanceFiltered = applyKeywordRelevanceFilter(keyword, signals, trendSignals);

    if (trendSignals.length === 0) {
      logFallbackTriggered('no_data', {
        detail: 'all_adapters_returned_empty_or_invalid'
      });
    }

    logNormalizedSample(keyword, relevanceFiltered.filteredSignals, relevanceFiltered.filteredRawSignals);

    return {
      success: true,
      result: {
        signals: relevanceFiltered.filteredSignals,
        rawSignals: relevanceFiltered.filteredRawSignals
      }
    };
  } catch (error) {
    logFallbackTriggered('error', {
      reason: error && error.message ? error.message : String(error || 'unknown_error')
    });

    console.warn('[TREND_COLLECT_SIGNALS_FALLBACK]', {
      reason: error && error.message ? error.message : String(error || 'unknown_error')
    });

    const fallbackSignals = getDeterministicFallbackSignals(keyword);
    const rawSignals = getDeterministicFallbackRawSignals(keyword);
    const relevanceFiltered = applyKeywordRelevanceFilter(keyword, fallbackSignals, rawSignals);
    logNormalizedSample(keyword, relevanceFiltered.filteredSignals, relevanceFiltered.filteredRawSignals);

    return {
      success: true,
      result: {
        signals: relevanceFiltered.filteredSignals,
        rawSignals: relevanceFiltered.filteredRawSignals
      }
    };
  }
}
