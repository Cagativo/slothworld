import { isSystemEvent } from '../../core/world/eventTaxonomy.js';

function isDevMode() {
  if (typeof process !== 'undefined' && process && process.env && process.env.NODE_ENV) {
    return process.env.NODE_ENV !== 'production';
  }

  if (typeof window !== 'undefined' && window && window.location) {
    return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  }

  return true;
}

export function assertNoSystemEventInLifecycleDerivation(events, context) {
  if (!isDevMode() || !Array.isArray(events)) {
    return;
  }

  const offending = events.find((event) => isSystemEvent(event && event.type));
  if (!offending) {
    return;
  }

  throw new Error(`SYSTEM_EVENT_USED_IN_LIFECYCLE_DERIVATION:${context}:${offending.type}`);
}
