export const CANONICAL_TASK_PIPELINE = [
  'createTask',
  'enqueueTask',
  'claimTask',
  'executeTask',
  'ackTask'
];

const seenLegacyWarnings = new Set();

export function getCanonicalPipelineLabel() {
  return CANONICAL_TASK_PIPELINE.join(' -> ');
}

export function warnLegacyExecutionPath(pathKey, details = {}) {
  if (!pathKey || seenLegacyWarnings.has(pathKey)) {
    return;
  }

  seenLegacyWarnings.add(pathKey);
  console.warn('[LEGACY_EXECUTION_PATH]', {
    path: pathKey,
    canonical: getCanonicalPipelineLabel(),
    details
  });
}
