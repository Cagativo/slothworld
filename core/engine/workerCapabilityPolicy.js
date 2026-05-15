import {
  TASK_TYPE_LOCAL_LLM,
  TASK_TYPE_TREND_RESEARCH
} from '../constants.js';

export const TREND_RESEARCH_WORKER_ID = 'trend-research-worker';
export const LOCAL_LLM_WORKER_ID = 'local-llm-worker';

export const DEFAULT_WORKER_CAPABILITY_POLICY = Object.freeze({
  [TASK_TYPE_TREND_RESEARCH]: Object.freeze([TREND_RESEARCH_WORKER_ID]),
  [TASK_TYPE_LOCAL_LLM]: Object.freeze([LOCAL_LLM_WORKER_ID])
});

export function getDefaultWorkerForTaskType(taskType) {
  if (taskType === TASK_TYPE_TREND_RESEARCH) {
    return TREND_RESEARCH_WORKER_ID;
  }

  if (taskType === TASK_TYPE_LOCAL_LLM) {
    return LOCAL_LLM_WORKER_ID;
  }

  return null;
}

export function normalizeWorkerCapabilityPolicy(policy = DEFAULT_WORKER_CAPABILITY_POLICY) {
  const normalized = new Map();

  if (!policy || typeof policy !== 'object') {
    return normalized;
  }

  for (const [taskType, workerIds] of Object.entries(policy)) {
    if (!Array.isArray(workerIds)) {
      continue;
    }

    const eligibleWorkers = new Set(
      workerIds
        .filter((workerId) => typeof workerId === 'string' && workerId.trim())
        .map((workerId) => workerId.trim())
    );

    if (eligibleWorkers.size > 0) {
      normalized.set(taskType, eligibleWorkers);
    }
  }

  return normalized;
}

export function canWorkerClaimTaskType(policy, workerId, taskType) {
  if (!taskType || !policy.has(taskType)) {
    return true;
  }

  return typeof workerId === 'string' && policy.get(taskType).has(workerId.trim());
}

export function isWorkerEligibleForTaskType(workerId, taskType, policy = DEFAULT_WORKER_CAPABILITY_POLICY) {
  const normalizedPolicy = policy instanceof Map
    ? policy
    : normalizeWorkerCapabilityPolicy(policy);
  return canWorkerClaimTaskType(normalizedPolicy, workerId, taskType);
}

export function resolveWorkerForTaskType(taskType, candidateWorkerId, policy = DEFAULT_WORKER_CAPABILITY_POLICY) {
  const candidate = typeof candidateWorkerId === 'string' && candidateWorkerId.trim()
    ? candidateWorkerId.trim()
    : null;
  if (candidate && isWorkerEligibleForTaskType(candidate, taskType, policy)) {
    return candidate;
  }

  return getDefaultWorkerForTaskType(taskType);
}
