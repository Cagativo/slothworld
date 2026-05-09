import { ollamaProvider } from '../../integrations/llm/providers/ollamaProvider.js';
import { assertWorkerExecutionContext } from '../engine/enforcementRuntime.js';

const MAX_SCORED_SIGNALS = 8;
const MAX_RAW_SIGNALS = 8;
const MAX_NORMALIZED_SIGNALS = 8;
const MAX_TEXT_LENGTH = 220;

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

function boundedScoredSignals(scoredSignals) {
  return normalizeArray(scoredSignals)
    .slice(0, MAX_SCORED_SIGNALS)
    .map((signal) => ({
      item: compactText(signal?.item),
      source: typeof signal?.source === 'string' ? signal.source : null,
      score: Number.isFinite(signal?.score) ? Number(signal.score) : null,
      explanation: signal?.explanation && typeof signal.explanation === 'object'
        ? {
            inputs: signal.explanation.inputs || null,
            contributions: signal.explanation.contributions || null,
            finalScore: Number.isFinite(signal.explanation.finalScore)
              ? Number(signal.explanation.finalScore)
              : null
          }
        : null
    }))
    .filter((signal) => signal.item);
}

function boundedRawSignals(rawSignals) {
  return normalizeArray(rawSignals)
    .slice(0, MAX_RAW_SIGNALS)
    .map((signal) => ({
      source: typeof signal?.source === 'string' ? signal.source : null,
      sourceItemId: typeof signal?.sourceItemId === 'string' ? signal.sourceItemId : null,
      text: compactText(signal?.text),
      url: typeof signal?.url === 'string' ? signal.url : null,
      metrics: signal?.metrics && typeof signal.metrics === 'object'
        ? {
            popularity: Number.isFinite(signal.metrics.popularity) ? Number(signal.metrics.popularity) : null,
            engagement: Number.isFinite(signal.metrics.engagement) ? Number(signal.metrics.engagement) : null,
            velocity: Number.isFinite(signal.metrics.velocity) ? Number(signal.metrics.velocity) : null
          }
        : null
    }))
    .filter((signal) => signal.text);
}

function boundedNormalizedSignals(normalizedSignals) {
  return normalizeArray(normalizedSignals)
    .slice(0, MAX_NORMALIZED_SIGNALS)
    .map((signal) => ({
      item: compactText(signal?.item),
      source: typeof signal?.source === 'string' ? signal.source : null,
      normalizedMetrics: signal?.normalizedMetrics && typeof signal.normalizedMetrics === 'object'
        ? {
            reliabilityWeight: Number.isFinite(signal.normalizedMetrics.reliabilityWeight)
              ? Number(signal.normalizedMetrics.reliabilityWeight)
              : null,
            weightedPopularity: Number.isFinite(signal.normalizedMetrics.weightedPopularity)
              ? Number(signal.normalizedMetrics.weightedPopularity)
              : null,
            weightedEngagement: Number.isFinite(signal.normalizedMetrics.weightedEngagement)
              ? Number(signal.normalizedMetrics.weightedEngagement)
              : null,
            weightedVelocity: Number.isFinite(signal.normalizedMetrics.weightedVelocity)
              ? Number(signal.normalizedMetrics.weightedVelocity)
              : null
          }
        : null
    }))
    .filter((signal) => signal.item);
}

export function buildTrendAnalysisPrompt({
  keyword,
  scoredSignals,
  rawSignals,
  normalizedSignals,
  context
} = {}) {
  const payload = {
    keyword: compactText(keyword, 120),
    context: context && typeof context === 'object' ? context : {},
    scoredSignals: boundedScoredSignals(scoredSignals),
    rawSignals: boundedRawSignals(rawSignals),
    normalizedSignals: boundedNormalizedSignals(normalizedSignals),
    outputContract: {
      summary: 'short grounded synthesis',
      recommendation: 'one practical recommendation',
      opportunities: ['opportunity'],
      risks: ['risk'],
      audienceSignals: ['audience signal'],
      contentAngles: ['content angle'],
      confidence: 0.0
    }
  };

  return [
    'Analyze these collected and scored trend signals.',
    'Use only this evidence. Return valid JSON matching outputContract.',
    JSON.stringify(payload, null, 2)
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
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(1, number));
}

function normalizeAnalysis(parsed, providerResult, rawText) {
  const source = parsed && typeof parsed === 'object' ? parsed : {};
  return {
    summary: compactText(source.summary, 500),
    recommendation: compactText(source.recommendation, 500),
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
  scoredSignals,
  rawSignals,
  normalizedSignals,
  context,
  model,
  temperature
} = {}) {
  assertWorkerExecutionContext();

  try {
    const prompt = buildTrendAnalysisPrompt({
      keyword,
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

