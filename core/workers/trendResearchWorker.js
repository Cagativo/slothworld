import { runCollectSignalsWorker } from './collectSignalsWorker.js';
import { runSignalNormalizationWorker } from './signalNormalizationWorker.js';
import { runScoreTrendsWorker } from './scoreTrendsWorker.js';
import { runSelectCandidatesWorker } from './selectCandidatesWorker.js';
import { runProduceFinalOutputWorker } from './produceFinalOutputWorker.js';
import { runAnalyzeTrendsWorker } from './analyzeTrendsWorker.js';
import { assertWorkerExecutionContext } from '../engine/enforcementRuntime.js';

function failure(error, failedStep, result = null) {
  return {
    success: false,
    error: typeof error === 'string' ? error : (error && error.message ? error.message : 'trend_research_failed'),
    failedStep,
    result
  };
}

function normalizeKeyword(input) {
  return input && typeof input.keyword === 'string' ? input.keyword.trim() : '';
}

function enrichCandidates(candidates, scoredSignals) {
  const scoredByItem = new Map(
    (Array.isArray(scoredSignals) ? scoredSignals : [])
      .filter((entry) => entry && typeof entry.item === 'string')
      .map((entry) => [entry.item, entry])
  );

  return (Array.isArray(candidates) ? candidates : []).map((candidate) => {
    const scored = scoredByItem.get(candidate?.item);
    return {
      ...(scored && typeof scored === 'object' ? scored : {}),
      ...(candidate && typeof candidate === 'object' ? candidate : {})
    };
  });
}

function sourceCounts(rawSignals) {
  const counts = {};
  for (const signal of Array.isArray(rawSignals) ? rawSignals : []) {
    const source = typeof signal?.source === 'string' && signal.source.trim()
      ? signal.source.trim()
      : 'unknown';
    counts[source] = (counts[source] || 0) + 1;
  }
  return counts;
}

export async function runTrendResearchTaskWorker(input) {
  assertWorkerExecutionContext();

  const payload = input && input.payload && typeof input.payload === 'object'
    ? input.payload
    : (input && typeof input === 'object' ? input : {});
  const keyword = normalizeKeyword(payload);

  if (!keyword) {
    return failure('missing_keyword', 1);
  }

  const collectStep = await runCollectSignalsWorker({ keyword });
  if (!collectStep.success) {
    return failure(collectStep.error, 1, collectStep.result || null);
  }

  const normalizedStep = runSignalNormalizationWorker({
    keyword,
    signals: collectStep.result.signals,
    rawSignals: collectStep.result.rawSignals
  });
  if (!normalizedStep.success) {
    return failure(normalizedStep.error, 2, normalizedStep.result || null);
  }

  const scoreStep = runScoreTrendsWorker({
    normalizedSignals: normalizedStep.result.normalizedSignals
  });
  if (!scoreStep.success) {
    return failure(scoreStep.error, 2, scoreStep.result || null);
  }

  const analysisStep = await runAnalyzeTrendsWorker({
    keyword,
    scoredSignals: scoreStep.result.scored,
    rawSignals: collectStep.result.rawSignals,
    normalizedSignals: normalizedStep.result.normalizedSignals,
    context: payload.context,
    model: payload.model,
    temperature: payload.temperature
  });
  if (!analysisStep.success) {
    return failure(analysisStep.error, 3, analysisStep.result || null);
  }

  const candidateStep = runSelectCandidatesWorker({ scored: scoreStep.result.scored });
  if (!candidateStep.success) {
    return failure(candidateStep.error, 4, candidateStep.result || null);
  }

  const candidates = enrichCandidates(candidateStep.result.candidates, scoreStep.result.scored);
  const finalStep = runProduceFinalOutputWorker({ candidates });
  if (!finalStep.success) {
    return failure(finalStep.error, 5, finalStep.result || null);
  }

  return {
    success: true,
    result: {
      keyword,
      ranked: finalStep.result.ranked,
      analysis: analysisStep.result,
      scored: scoreStep.result.scored,
      candidates,
      evidence: {
        keyword,
        sources: sourceCounts(collectStep.result.rawSignals),
        rawSignals: collectStep.result.rawSignals,
        normalizedSignals: normalizedStep.result.normalizedSignals,
        scoredSignals: scoreStep.result.scored
      }
    }
  };
}

