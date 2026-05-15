import { ollamaProvider } from '../../integrations/llm/providers/ollamaProvider.js';
import { assertWorkerExecutionContext } from '../engine/enforcementRuntime.js';

const MAX_CANDIDATES = 3;
const MAX_TREND_FACTS = 5;
const MAX_TEXT_LENGTH = 120;
const DEFAULT_TREND_ANALYSIS_TIMEOUT_MS = 15000;
const FALLBACK_RECOMMENDATION = 'Review ranked trend evidence before action.';
const TIMEOUT_SUMMARY = 'Trend analysis was skipped because the local model did not respond in time.';
const UNAVAILABLE_RECOMMENDATION = 'Use ranked trend evidence for now, or retry with a smaller/faster local model.';

const TREND_ANALYSIS_OPTIONS = Object.freeze({
  num_predict: 120,
  temperature: 0.2,
  top_p: 0.8,
  num_ctx: 1024
});

const SYSTEM_PROMPT = [
  'Return only tiny JSON.',
  'Use only provided trend facts.',
  'No prose outside JSON.'
].join(' ');

function compactText(value, maxLength = MAX_TEXT_LENGTH) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}...`;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function roundedNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(number * 1000) / 1000;
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

function relevanceLabel(score) {
  const number = Number(score);
  if (!Number.isFinite(number)) return 'unknown';
  if (number >= 0.75) return 'high';
  if (number >= 0.35) return 'medium';
  return 'low';
}

function shortReason(candidate) {
  const explanation = candidate?.explanation && typeof candidate.explanation === 'object'
    ? candidate.explanation
    : {};
  const inputs = explanation.inputs && typeof explanation.inputs === 'object' ? explanation.inputs : {};
  const parts = [];
  const growth = roundedNumber(inputs.normalized_growth);
  const volume = roundedNumber(inputs.normalized_volume);
  const engagement = roundedNumber(inputs.normalized_engagement);
  const intent = roundedNumber(inputs.normalized_commercial_intent);

  if (growth !== null) parts.push(`growth ${growth}`);
  if (volume !== null) parts.push(`volume ${volume}`);
  if (engagement !== null) parts.push(`engagement ${engagement}`);
  if (intent !== null) parts.push(`intent ${intent}`);
  if (parts.length === 0) parts.push(`score ${roundedNumber(candidate?.score) ?? 'unknown'}`);
  return compactText(parts.slice(0, 2).join(', '), MAX_TEXT_LENGTH);
}

function compactTrendFacts({ candidates, scoredSignals } = {}) {
  return topCandidates(candidates, scoredSignals)
    .slice(0, MAX_TREND_FACTS)
    .map((candidate) => {
      const item = compactText(candidate?.item, MAX_TEXT_LENGTH);
      if (!item) return null;

      const source = sourceKey(candidate?.source);
      return {
        topic: item,
        source,
        score: roundedNumber(candidate?.score),
        relevance: relevanceLabel(candidate?.score),
        reason: shortReason(candidate)
      };
    })
    .filter(Boolean);
}

function trendAnalysisTimeoutMs() {
  const value = Number(process.env.SLOTHWORLD_TREND_ANALYSIS_TIMEOUT_MS);
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_TREND_ANALYSIS_TIMEOUT_MS;
  }
  return Math.max(1, Math.floor(value));
}

export function buildTrendAnalysisPrompt({
  keyword,
  candidates,
  scoredSignals
} = {}) {
  const trendFacts = compactTrendFacts({
    candidates,
    scoredSignals
  });
  const payload = {
    keyword: compactText(keyword, 120),
    facts: trendFacts
  };

  return [
    'Analyze trends in <=80 words.',
    'Return strict JSON: {"summary":"...","recommendation":"...","confidence":"low|medium|high"}',
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

function unavailableAnalysis({ reason, model = null }) {
  return {
    summary: TIMEOUT_SUMMARY,
    recommendation: UNAVAILABLE_RECOMMENDATION,
    opportunities: [],
    risks: [],
    audienceSignals: [],
    contentAngles: [],
    confidence: 'low',
    provider: 'ollama',
    model,
    unavailable: true,
    reason: reason || 'ollama_unavailable'
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

async function withTimeout(fn, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fn(controller.signal);
  } catch (error) {
    if (timedOut) {
      error.code = 'ollama_timeout';
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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
    scoredSignals
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
      scoredSignals
    });

    const timeoutMs = trendAnalysisTimeoutMs();
    const providerResult = await withTimeout((signal) => ollamaProvider.generateText({
      prompt,
      system: SYSTEM_PROMPT,
      model,
      options: TREND_ANALYSIS_OPTIONS,
      signal
    }), timeoutMs);

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
    return {
      success: true,
      result: unavailableAnalysis({
        reason: error && typeof error === 'object' && error.code ? error.code : 'ollama_unavailable',
        model: typeof model === 'string' && model.trim() ? model.trim() : null
      })
    };
  }
}
