export const LIFECYCLE_EVENTS = Object.freeze([
  'TASK_CREATED',
  'TASK_ENQUEUED',
  'TASK_CLAIMED',
  'TASK_EXECUTE_STARTED',
  'TASK_EXECUTE_FINISHED',
  'TASK_ACKED',
  'TASK_REQUEUED',
  'TASK_EXECUTE_SKIPPED_IDEMPOTENT',
  'TASK_ACK_SIDE_EFFECT_FAILED'
]);

export const SYSTEM_EVENTS = Object.freeze([
  'TASK_NOTIFICATION_SENT',
  'TASK_NOTIFICATION_SKIPPED',
  'TASK_NOTIFICATION_FAILED'
]);

export const AGENT_EVENTS = Object.freeze([
  'AGENT_SPAWNED',
  'AGENT_ASSIGNED_IDLE'
]);

export const WORKFLOW_EVENTS = Object.freeze([
  'TREND_RESEARCH_REQUESTED',
  'TREND_RESEARCH_COMPLETED',
  'TREND_RESEARCH_FAILED'
]);

const lifecycleSet = new Set(LIFECYCLE_EVENTS);
const systemSet = new Set(SYSTEM_EVENTS);
const agentSet = new Set(AGENT_EVENTS);
const workflowSet = new Set(WORKFLOW_EVENTS);
const warnedUnknownTypes = new Set();

const strictUnknownEventTypes = typeof process !== 'undefined'
  && process
  && process.env
  && process.env.SLOTHWORLD_STRICT_EVENT_TAXONOMY === '1';

function isDevMode() {
  if (typeof process !== 'undefined' && process && process.env && process.env.NODE_ENV) {
    return process.env.NODE_ENV !== 'production';
  }

  if (typeof window !== 'undefined' && window && window.location) {
    return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  }

  return true;
}

export const LIFECYCLE_EVENT_TYPES = LIFECYCLE_EVENTS;
export const SYSTEM_EVENT_TYPES = SYSTEM_EVENTS;
export const AGENT_EVENT_TYPES = AGENT_EVENTS;
export const WORKFLOW_EVENT_TYPES = WORKFLOW_EVENTS;

function guardUnknownEventType(type) {
  if (!isDevMode() || typeof type !== 'string') {
    return;
  }

  if (lifecycleSet.has(type) || systemSet.has(type) || agentSet.has(type) || workflowSet.has(type) || warnedUnknownTypes.has(type)) {
    return;
  }

  warnedUnknownTypes.add(type);
  const message = `[EventTaxonomy] Unknown event type ${type}`;

  if (strictUnknownEventTypes) {
    throw new Error(message);
  }

  console.warn('[EventTaxonomy] Unknown event type', type);
}

export function isLifecycleEvent(type) {
  guardUnknownEventType(type);
  return typeof type === 'string' && lifecycleSet.has(type);
}

export function isSystemEvent(type) {
  guardUnknownEventType(type);
  return typeof type === 'string' && systemSet.has(type);
}

export function isWorkflowEvent(type) {
  guardUnknownEventType(type);
  return typeof type === 'string' && workflowSet.has(type);
}
