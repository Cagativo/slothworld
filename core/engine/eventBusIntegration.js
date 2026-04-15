/**
 * EventBus Integration Module
 * 
 * Provides EventBus management for bridge-server
 * Includes persistence hooks
 */

import { createEventBus } from './eventBus.js';

export function createBridgeEventBus(options = {}) {
  const onPersist = options.onPersist || (() => {});
  
  const eventBus = createEventBus({ 
    onPersist,
    now: options.now
  });

  // Track the last persisted event ID for reboot recovery
  let lastPersistedId = 0;

  return {
    /**
     * Emit an event from TaskEngine
     * Automatically bridges TaskEngineEvent format to EventBus format
     */
    emitFromTaskEngine(taskEngineEvent) {
      if (!taskEngineEvent) return;
      
      return eventBus.emit({
        type: taskEngineEvent.event,
        taskId: taskEngineEvent.taskId,
        payload: taskEngineEvent.payload
      });
    },

    /**
     * Subscribe to all events
     */
    subscribe(handler) {
      return eventBus.subscribe(handler);
    },

    /**
     * Get all events
     */
    getAllEvents() {
      return eventBus.getAllEvents();
    },

    /**
     * Get events after a given ID
     */
    getEventStream(afterId) {
      return eventBus.getEventStream(afterId);
    },

    /**
     * Get task state from event replay
     */
    replayTaskState(taskId) {
      return eventBus.replayTaskState(taskId);
    },

    /**
     * Get any errors that occurred during event processing
     */
    getErrors() {
      return eventBus.getErrors();
    },

    /**
     * For persistence on recovery
     */
    setLastPersistedId(id) {
      lastPersistedId = id;
    },

    getLastPersistedId() {
      return lastPersistedId;
    },

    /**
     * Internal hook for testing
     */
    _getInternalEventBus() {
      return eventBus;
    }
  };
}
