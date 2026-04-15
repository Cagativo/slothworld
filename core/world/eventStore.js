const rawEvents = [];
const listeners = new Set();

function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object') {
    return value;
  }

  Object.freeze(value);
  for (const key of Object.keys(value)) {
    deepFreeze(value[key]);
  }

  return value;
}

export function appendRawEvents(events) {
  if (!Array.isArray(events) || events.length === 0) {
    return;
  }

  const appended = [];
  for (const event of events) {
    const cloned = deepClone(event);
    const frozen = deepFreeze(cloned);
    rawEvents.push(frozen);
    appended.push(frozen);
  }

  if (!appended.length) {
    return;
  }

  for (const listener of listeners) {
    try {
      listener(appended.map((event) => deepClone(event)));
    } catch (_error) {
      // Event listeners are observational and must never break append flow.
    }
  }
}

export function getRawEvents() {
  return rawEvents.map((event) => deepClone(event));
}

export function clearRawEvents() {
  rawEvents.length = 0;
}

export function subscribeEventStream(handler) {
  if (typeof handler !== 'function') {
    throw new Error('invalid_event_stream_handler');
  }

  listeners.add(handler);
  return () => {
    listeners.delete(handler);
  };
}
