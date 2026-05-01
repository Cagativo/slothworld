import { isSystemEvent } from '../../core/world/eventTaxonomy.js';

export function assertNoSystemEventInLifecycleDerivation(events, context) {
  if (!Array.isArray(events)) {
    return;
  }

  const offending = events.find((event) => isSystemEvent(event && event.type));
  if (!offending) {
    return;
  }

  throw new Error(`SYSTEM_EVENT_USED_IN_LIFECYCLE_DERIVATION:${context}:${offending.type}`);
}
