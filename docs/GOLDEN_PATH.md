# EventBus & Golden Path Implementation Guide

## Overview

Slothworld now has a complete **event-driven task execution architecture** with full traceability and determinism.

### Core Components

1. **EventBus** (`core/engine/eventBus.js`)
   - Immutable append-only event log
   - Subscriber notification system
   - Event replay and task state reconstruction
   - Error tracking for debugging

2. **TaskEngine** (`core/engine/taskEngine.js`)
   - Single authority for task lifecycle
   - Emits events for all state transitions
   - Integrates with EventBus via `emitEvent` callback

3. **Event Bus Integration** (`core/engine/eventBusIntegration.js`)
   - Bridge between TaskEngine and EventBus
   - Persistence hooks for event storage
   - Task state recovery from event streams

## Golden Path - Complete Task Lifecycle

Every task follows this deterministic sequence:

```
1. POST /task → Validated input
2. TaskEngine.createTask()
   ↓ TASK_CREATED event
3. TaskEngine.enqueueTask()
   ↓ TASK_ENQUEUED event
4. TaskEngine.claimTask()
   ↓ TASK_CLAIMED event
5. Worker.executeTask() (via POST /task/:id/execute)
   ↓ TASK_EXECUTE_STARTED event
   ↓ Execution happens
   → TASK_EXECUTE_FINISHED event (status: awaiting_ack)
6. POST /task/:id/ack (HTTP) or TaskEngine.ackTask() directly
   ↓ TASK_ACKED event
   → Final status: 'acknowledged' or 'failed'
```

### Key Invariants

- **No state mutation without events**: Every state change emits an event first
- **Worker isolation**: Workers cannot mutate task state directly
- **Determinism**: Event stream alone determines final state
- **Immutability**: Event log is append-only, events are immutable copies
- **Traceability**: Full task history queryable from events

## Testing

### Golden Path Unit Test

```bash
node --test tests/golden-path.test.mjs
```

**What it verifies:**
- Task flows through all lifecycle states correctly
- All 6 expected events are emitted in order
- Event stream is immutable (external mutations don't affect log)
- Task state can be perfectly reconstructed from events
- No errors occur during event processing

**Output:**
```
✅ Golden Path: All checks passed
   - Events emitted: 6
   - Event sequence: TASK_CREATED → TASK_ENQUEUED → TASK_CLAIMED → TASK_EXECUTE_STARTED → TASK_EXECUTE_FINISHED → TASK_ACKED
   - Replay verification: OK
   - Immutability check: OK
```

### Enforcement Tests

```bash
npm run test:enforcement
```

The enforcement suite (13 tests) validates:
- ACK integrity (requires execution before ACK)
- Execution authority (TaskEngine is the only executor)
- Provider isolation (no direct provider calls)
- Side-effect isolation (no direct side effects)
- Lifecycle integrity (proper state transitions)

## Usage

### In Code

```javascript
import { createEventBus } from './core/engine/eventBus.js';
import { createTaskEngine } from './core/engine/taskEngine.js';

// Create EventBus
const eventBus = createEventBus();

// Subscribe to events
eventBus.subscribe((event) => {
  console.log(`[EVENT] ${event.type} for task ${event.taskId}`);
});

// Create TaskEngine with event integration
const taskEngine = createTaskEngine({
  emitEvent: (taskEngineEvent) => {
    eventBus.emit({
      type: taskEngineEvent.event,
      taskId: taskEngineEvent.taskId,
      payload: taskEngineEvent.payload
    });
  },
  executor: async (task) => {
    // Your execution logic here
    return { success: true, output: {...} };
  }
});

// Use task engine
const task = taskEngine.createTask({ id: 'task-1', type: 'my-type' });
const queued = taskEngine.enqueueTask(task.id);
const claimed = taskEngine.claimTask(task.id);
const result = await taskEngine.executeTask(task.id);
const acked = await taskEngine.ackTask(task.id);

// Query events
const allEvents = eventBus.getAllEvents();
const taskHistory = eventBus.replayTaskState('task-1');
```

### Event Stream Queries

```javascript
// Get all events
const events = eventBus.getAllEvents();
// [
//   { id: 1, type: 'TASK_CREATED', taskId: 'task-1', timestamp: ... },
//   { id: 2, type: 'TASK_ENQUEUED', taskId: 'task-1', timestamp: ... },
//   ...
// ]

// Get events after a specific ID (for pagination)
const recentEvents = eventBus.getEventStream(afterId);

// Reconstruct task state from events
const state = eventBus.replayTaskState('task-1');
// {
//   id: 'task-1',
//   status: 'acknowledged',
//   history: [
//     { event: 'TASK_CREATED', timestamp: ... },
//     { event: 'TASK_ENQUEUED', timestamp: ... },
//     ...
//   ],
//   eventCount: 6
// }

// Check for processing errors
const errors = eventBus.getErrors();
```

## Event Types

| Event | Triggered By | Task Status | Payload |
|-------|--------------|------------|---------|
| `TASK_CREATED` | createTask() | created | { status, type } |
| `TASK_ENQUEUED` | enqueueTask() | queued | { queueSize, attempts } |
| `TASK_CLAIMED` | claimTask() | claimed | { queueSize, attempts } |
| `TASK_EXECUTE_STARTED` | executeTask() | executing | { attempts, maxRetries } |
| `TASK_REQUEUED` | executeTask() (retry) | queued | { attempts, maxRetries, queueSize } |
| `TASK_EXECUTE_FINISHED` | executor result | awaiting_ack | { success, retryable, status } |
| `TASK_ACKED` | ackTask() | acknowledged/failed | { status, attempts, success } |
| `TASK_ACK_SIDE_EFFECT_FAILED` | ackTask() side effect error | (unchanged) | { error } |

## Observability

### Event Stream Endpoint

GET `/events` returns pending task events:
```json
{
  "ok": true,
  "events": [
    {
      "id": 1,
      "timestamp": 1713193456000,
      "task": { "id": "...", "status": "...", "..." }
    }
  ]
}
```

### Logging

All events are logged automatically. The logging format includes:
- Event type (TASK_CREATED, TASK_ENQUEUED, etc.)
- Task ID
- Relevant metadata (attempts, queue size, status, etc.)
- Timestamps

Example:
```
[TASK_ENGINE] { event: 'TASK_CREATED', taskId: 'task-1', status: 'created', type: 'image_render' }
[TASK_ENGINE] { event: 'TASK_ENQUEUED', taskId: 'task-1', queueSize: 1, attempts: 0 }
```

## Architecture Diagrams

### State Transitions

```
        ┌─────────────────────────────────────────┐
        │         TaskEngine Authority            │
        └─────────────────────────────────────────┘
                          │
                          ↓
        ┌─────────────────────────────────────────┐
        │      EventBus (Append-Only Log)         │
        │  - Emit events                          │
        │  - Notify subscribers                   │
        │  - Allow event replay                   │
        └─────────────────────────────────────────┘
                          │
                          ↓
        ┌─────────────────────────────────────────┐
        │    Task State (Read-Only Reference)     │
        │  Reconstructed from event stream        │
        └─────────────────────────────────────────┘
```

### Execution Flow

```
HTTP Request → TaskEngine → Event Emission → EventBus Log
                    ↓                           ↓
              State Transition            State Validation
                    ↓                           ↓
              Worker Exec                Event Subscribers
                    ↓                           ↓
              Result → EventBus → Reply to HTTP
```

## Guarantees

✅ **Determinism**: Same inputs → same events → same final state  
✅ **Immutability**: Events cannot be modified after emission  
✅ **Completeness**: All state changes visible in event stream  
✅ **Isolation**: Workers cannot bypass TaskEngine  
✅ **Auditability**: Full task history reconstructable from events  
✅ **Reliability**: No hidden state transitions  

## Error Handling

### Event Processing Errors

If an error occurs during event emission or subscription:
- Event is still recorded in the log
- Error is logged and tracked
- Subscriber errors don't block other subscribers
- Query via `eventBus.getErrors()` for debugging

### Task Execution Errors

If executor throws an error:
- Event `TASK_EXECUTE_FINISHED` emitted with success=false
- Task transitions to `awaiting_ack` state
- On ACK, task transitions to `failed` status
- Full error message preserved in event payload

## Future Enhancements

1. **Event Persistence**: Persist EventBus to disk for recovery
2. **Event Streaming**: WebSocket endpoint for real-time event stream
3. **Event Filtering**: Query events by task type, status, time range
4. **Event Metrics**: Counters for event types and task states
5. **Event Replay**: CLI tool to replay events from specific point
6. **Task Snapshots**: Periodic checkpoints of task state

## References

- [TaskEngine Source](../core/engine/taskEngine.js)
- [EventBus Source](../core/engine/eventBus.js)
- [Golden Path Test](../tests/golden-path.test.mjs)
- [Enforcement Tests](../tests/adversarial-enforcement.test.mjs)
