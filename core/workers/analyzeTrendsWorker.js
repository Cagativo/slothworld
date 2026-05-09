import { ollamaProvider } from '../../integrations/llm/providers/ollamaProvider.js';
import { assertWorkerExecutionContext } from '../engine/enforcementRuntime.js';

const MAX_CANDIDATES = 3;
const MAX_TREND_FACTS = 5;
const MAX_TEXT_LENGTH = 160;
const FALLBACK_RECOMMENDATION = 'Review ranked trend evidence before action.';

const SYSTEM_PROMPT = [
  'You are a local trend research analyst.',
  'Analyze only the provided scored signals and evidence.',
  'Do not invent sources, do not create follow-up tasks, and do not mention task lifecycle.',
  'Return compact JSON only.'
].join(' ');

function fail(error) {
  const message = error instanceof Error ? error.message : String(error || 'trend_analysis_failed');

  return {
    success: false,
    result: {
      provider: 'ollama',
      code: error && typeof error === 'object' && error.code ? error.code : 'trend_analysis_failed',
      status: error && typeof error === 'object' && Object.prototype.hasOwnProperty.call(error, 'status')
        ? error.status
        : null,
      detail: error && typeof error === 'object' && Object.prototype.hasOwnProperty.call(error, 'detail')
        ? error.detail
        : null,
      message
    },
    error: message
  };
}

function compactText(value, maxLength = MAX_TEXT_LENGTH) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}...`;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function numericOrNull(value) {
  return Number.isFinite(value) ? Number(value) : null;
}

function sourceKey(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function topCandidates(candidates, scoredSignals) {
  if (Array.isArray(candidates)) {
    return candidates
      .filter((entry) => compactText(entry?.item))
      .slice(0, MAX_CANDIDATES);
  }

  const source = normalizeArray(scoredSignals)
    .slice()
    .sort((a, b) => (Number(b?.score) || 0) - (Number(a?.score) || 0));

  return source.slice(0, MAX_CANDIDATES);
}

function findMatchingRawSignal(item, source, rawSignals) {
  const normalizedItem = compactText(item).toLowerCase();
  const normalizedSource = sourceKey(source);
  return normalizeArray(rawSignals).find((signal) => {
    const text = compactText(signal?.text).toLowerCase();
    const sourceMatches = !normalizedSource || signal?.source === normalizedSource;
    return sourceMatches && text && normalizedItem && text.includes(normalizedItem);
  }) || normalizeArray(rawSignals).find((signal) => signal?.source === normalizedSource) || null;
}

function findMatchingNormalizedSignal(item, source, normalizedSignals) {
  const normalizedItem = compactText(item).toLowerCase();
  const normalizedSource = sourceKey(source);
  return normalizeArray(normalizedSignals).find((signal) => {
    const signalItem = compactText(signal?.item).toLowerCase();
    const sourceMatches = !normalizedSource || signal?.source === normalizedSource;
    return sourceMatches && signalItem === normalizedItem;
  }) || null;
}

function compactTrendFacts({ candidates, scoredSignals, rawSignals, normalizedSignals } = {}) {
  return topCandidates(candidates, scoredSignals)
    .slice(0, MAX_TREND_FACTS)
    .map((candidate) => {
      const item = compactText(candidate?.item);
      if (!item) return null;

      const source = sourceKey(candidate?.source);
      const raw = findMatchingRawSignal(item, source, rawSignals);
      const normalized = findMatchingNormalizedSignal(item, source, normalizedSignals);
      const metrics = raw?.metrics && typeof raw.metrics === 'object' ? raw.metrics : {};
      const normalizedMetrics = normalized?.normalizedMetrics && typeof normalized.normalizedMetrics === 'object'
        ? normalized.normalizedMetrics
        : {};
      const explanation = candidate?.explanation && typeof candidate.explanation === 'object'
        ? candidate.explanation
        : {};

      return {
        item,
        source,
        score: numericOrNull(candidate?.score),
        evidence: compactText(raw?.text || item),
        metrics: {
          popularity: numericOrNull(metrics.popularity),
          engagement: numericOrNull(metrics.engagement),
          velocity: numericOrNull(metrics.velocity),
          reliability: numericOrNull(normalizedMetrics.reliabilityWeight),
          growth: numericOrNull(explanation?.inputs?.normalized_growth),
          volume: numericOrNull(explanation?.inputs?.normalized_volume),
          commercialIntent: numericOrNull(explanation?.inputs?.normalized_commercial_intent)
        }
      };
    })
    .filter(Boolean);
}

function sourceCounts(rawSignals) {
  const counts = {};
  for (const signal of normalizeArray(rawSignals)) {
    const source = sourceKey(signal?.source) || 'unknown';
    counts[source] = (counts[source] || 0) + 1;
  }
  return counts;
}

export function buildTrendAnalysisPrompt({
  keyword,
  candidates,
  scoredSignals,
  rawSignals,
  normalizedSignals,
  context
} = {}) {
  const trendFacts = compactTrendFacts({
    candidates,
    scoredSignals,
    rawSignals,
    normalizedSignals
  });
  const payload = {
    keyword: compactText(keyword, 120),
    context: context && typeof context === 'object' ? context : {},
    sourceCounts: sourceCounts(rawSignals),
    trendFacts,
    outputContract: {
      summary: 'short grounded synthesis',
      recommendation: 'one practical recommendation',
      opportunities: ['opportunity'],
      risks: ['risk'],
      audienceSignals: ['audience signal'],
      contentAngles: ['content angle'],
      confidence: 'low | medium | high'
    }
  };

  return [
    'Analyze these collected and scored trend signals.',
    'Use only trendFacts as evidence. Return JSON only, with keys matching outputContract.',
    JSON.stringify(payload)
  ].join('\n\n');
}

function extractJsonText(text) {
  const source = typeof text === 'string' ? text.trim() : '';
  if (!source) return '';

  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) return fenced[1].trim();

  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return source.slice(start, end + 1).trim();
  }

  return source;
}

function stringArray(value) {
  return normalizeArray(value)
    .map((entry) => compactText(entry, 180))
    .filter(Boolean);
}

function normalizeConfidence(value) {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'low' || normalized === 'medium' || normalized === 'high') {
      return normalized;
    }
  }

  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(1, number));
}

function fallbackAnalysis({ summary, providerResult = null, rawText = null, model = null }) {
  return {
    summary: compactText(summary, 500),
    recommendation: FALLBACK_RECOMMENDATION,
    opportunities: [],
    risks: [],
    audienceSignals: [],
    contentAngles: [],
    confidence: 'low',
    provider: providerResult?.provider || 'ollama',
    model: providerResult?.metadata?.model || model || null,
    ...(rawText ? { rawText } : {})
  };
}

export function buildEmptyTrendAnalysis(model = null) {
  return {
    summary: 'No strong trend candidates were found.',
    recommendation: 'Collect more signals before acting.',
    opportunities: [],
    risks: [],
    audienceSignals: [],
    contentAngles: [],
    confidence: 'low',
    provider: 'deterministic',
    model
  };
}

function normalizeAnalysis(parsed, providerResult, rawText) {
  const source = parsed && typeof parsed === 'object' ? parsed : {};
  if (!parsed) {
    return fallbackAnalysis({
      summary: rawText || 'Ollama returned prose instead of structured JSON.',
      providerResult,
      rawText
    });
  }

  return {
    summary: compactText(source.summary, 500) || compactText(rawText, 500),
    recommendation: compactText(source.recommendation, 500) || FALLBACK_RECOMMENDATION,
    opportunities: stringArray(source.opportunities),
    risks: stringArray(source.risks),
    audienceSignals: stringArray(source.audienceSignals),
    contentAngles: stringArray(source.contentAngles),
    confidence: normalizeConfidence(source.confidence),
    provider: 'ollama',
    model: providerResult?.metadata?.model || null,
    ...(parsed ? {} : { rawText })
  };
}

export async function runAnalyzeTrendsWorker({
  keyword,
  candidates,
  scoredSignals,
  rawSignals,
  normalizedSignals,
  context,
  model,
  temperature
} = {}) {
  assertWorkerExecutionContext();

  const facts = compactTrendFacts({
    candidates,
    scoredSignals,
    rawSignals,
    normalizedSignals
  });

  if (facts.length === 0) {
    return {
      success: true,
      result: buildEmptyTrendAnalysis(typeof model === 'string' && model.trim() ? model.trim() : null)
    };
  }

  try {
    const prompt = buildTrendAnalysisPrompt({
      keyword,
      candidates,
      scoredSignals,
      rawSignals,
      normalizedSignals,
      context
    });

    const providerResult = await ollamaProvider.generateText({
      prompt,
      system: SYSTEM_PROMPT,
      model,
      temperature
    });

    const rawText = typeof providerResult.text === 'string' ? providerResult.text.trim() : '';
    let parsed = null;
    try {
      parsed = JSON.parse(extractJsonText(rawText));
    } catch {
      parsed = null;
    }

    return {
      success: true,
      result: normalizeAnalysis(parsed, providerResult, rawText)
    };
  } catch (error) {
    return fail(error);
  }
}
