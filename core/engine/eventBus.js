/**
 * EventBus - Immutable append-only event log with subscriber support
 * 
 * Core responsibilities:
 * - Persist events in append-only log
 * - Emit events to all subscribers
 * - Support event stream replay
 * - Ensure deterministic ordering
 */

export function createEventBus(options = {}) {
  const log = [];
  const subscribers = [];
  const errors = [];
  let nextEventId = 1;

  const now = options.now || (() => Date.now());
  const onPersist = options.onPersist || (() => {}); // Hook for external persistence

  /**
   * Add event to log and notify subscribers
   * @param {Object} event - Event object (must have type at minimum)
   * @returns {number} eventId assigned to this event
   */
  function emit(event) {
    if (!event || typeof event !== 'object' || !event.type) {
      const error = new Error('invalid_event_no_type');
      errors.push({ error, event, timestamp: now() });
      throw error;
    }

    const storedEvent = {
      id: nextEventId,
      ...event,
      timestamp: event.timestamp || now()
    };

    log.push(storedEvent);
    nextEventId += 1;

    // Notify subscribers synchronously (deterministic)
    for (const handler of subscribers) {
      try {
        handler(storedEvent);
      } catch (error) {
        errors.push({
          error,
          event: storedEvent,
          handlerError: error.message,
          timestamp: now()
        });
      }
    }

    // Persist hook for external storage
    try {
      onPersist(storedEvent);
    } catch (error) {
      errors.push({
        error,
        event: storedEvent,
        persistError: error.message,
        timestamp: now()
      });
    }

    return storedEvent.id;
  }

  /**
   * Subscribe handler to all future events
   * @param {Function} handler - Called with each new event
   */
  function subscribe(handler) {
    if (typeof handler !== 'function') {
      throw new Error('invalid_handler_not_function');
    }
    subscribers.push(handler);
  }

  /**
   * Get immutable copy of event stream, optionally starting after a given ID
   * @param {number} afterEventId - Return events after this ID (inclusive of ID+1)
   * @returns {Array} Immutable copy of events
   */
  function getEventStream(afterEventId) {
    let startIdx = 0;

    if (typeof afterEventId === 'number' && afterEventId >= 0) {
      // Find first event with id > afterEventId
      startIdx = log.findIndex((e) => e.id > afterEventId);
      if (startIdx === -1) {
        startIdx = log.length; // No events after this ID
      }
    }

    // Return deep copy to prevent external mutation
    return log.slice(startIdx).map((event) => JSON.parse(JSON.stringify(event)));
  }

  /**
   * Get all events in the log
   * @returns {Array} Immutable copy of full event log
   */
  function getAllEvents() {
    return getEventStream(-1);
  }

  /**
   * Get event errors that occurred during emit or subscription
   * @returns {Array} Errors that occurred
   */
  function getErrors() {
    return errors.slice().map((err) => JSON.parse(JSON.stringify(err)));
  }

  /**
   * Reconstruct state of a task by replaying its events
   * @param {string} taskId - Task ID to reconstruct
   * @returns {Object} Task state reconstructed from events
   */
  function replayTaskState(taskId) {
    const taskEvents = log.filter((e) => e.taskId === taskId);

    let state = {
      id: taskId,
      status: null,
      history: [],
      eventCount: taskEvents.length
    };

    for (const event of taskEvents) {
      state.history.push({
        event: event.type,
        timestamp: event.timestamp,
        payload: event.payload
      });

      // Simple state machine
      if (event.type === 'TASK_CREATED') {
        state.status = 'created';
      } else if (event.type === 'TASK_ENQUEUED') {
        state.status = 'queued';
      } else if (event.type === 'TASK_CLAIMED') {
        state.status = 'claimed';
      } else if (event.type === 'TASK_EXECUTE_STARTED') {
        state.status = 'executing';
      } else if (event.type === 'TASK_EXECUTE_FINISHED') {
        state.status = 'awaiting_ack';
      } else if (event.type === 'TASK_ACKED') {
        state.status = event.payload?.success ? 'acknowledged' : 'failed';
      }
    }

    return state;
  }

  return {
    emit,
    subscribe,
    getEventStream,
    getAllEvents,
    getErrors,
    replayTaskState
  };
}
