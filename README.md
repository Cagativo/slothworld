# Slothworld Execution Engine

Slothworld is an event-driven workflow execution engine for autonomous AI operations.

This system enforces a single deterministic execution pipeline. Any alternative execution path is invalid.

It is not a game, not a simulation runtime, and not a UI-driven execution system.

## Core Guarantee

All task execution is strictly controlled by TaskEngine.

No task can:
- execute outside TaskEngine
- be marked complete without execution
- trigger side effects outside lifecycle

Execution is enforced as:

```text
execute -> ack -> side effects
```

Any violation throws `ENGINE_ENFORCEMENT_VIOLATION`.

## Core Flow

```text
Intake -> Engine -> Queue -> Worker -> Provider -> Result -> ACK -> Persistence
```

```text
UI/External Trigger -> Bridge -> TaskEngine -> Worker -> Provider -> Worker Result -> ACK -> Persistence
```

## Canonical Task Execution Flow (Authoritative)

```text
POST /task
-> TaskEngine.createTask
-> TaskEngine.enqueueTask
-> TaskEngine.claimTask
-> POST /task/:id/execute
-> TaskExecutionWorker
-> TaskEngine stores executionRecord
-> POST /task/:id/ack
-> TaskEngine finalizes
```

## Single Source of Truth Rule

TaskEngine is the lifecycle authority.

It is the only system allowed to:
- transition task state
- define lifecycle status changes
- determine completion or failure
- authorize ACK finalization

Bridge, UI, Workers, and Providers must NOT:
- mutate task state directly
- override lifecycle status
- write completion state independently

`TASK_ACKED` is the sole terminal source of truth.

## Architecture

### Intake

- Normalizes and persists tasks
- Calls TaskEngine only
- Does not execute provider logic

### Engine

- Owns lifecycle transitions
- Schedules and orchestrates execution
- Finalizes state through ACK

### Workers

- Execute task logic
- Perform side effects
- Return structured results
- Do NOT mutate lifecycle state

### Providers

- Pure model inference layer
- No state mutation
- No filesystem access
- No orchestration responsibilities

### Persistence

- Stores events and execution records
- Lifecycle state is ACK-authoritative

## Runtime Guarantees

- All tasks go through TaskEngine
- All execution happens in workers
- All AI runs through providers
- All completion is finalized by ACK
- UI is never authoritative

## Explicit Invariants

- Tasks cannot complete without execution
- ACK requires a valid executionRecord
- Workers cannot execute outside engine context
- Providers cannot be called directly from UI
- Side effects occur only post-ACK

## Execution Entry Points

Allowed:
- `POST /task`
- `POST /task/:id/start`
- `POST /task/:id/execute`
- `POST /task/:id/ack`

Rejected:
- `/render/*`
- `/asset-store/*`
- `/debug/*`

## Event Taxonomy

### Lifecycle Events

- `TASK_CREATED`
- `TASK_ENQUEUED`
- `TASK_CLAIMED`
- `TASK_EXECUTE_STARTED`
- `TASK_EXECUTE_FINISHED`
- `TASK_ACKED`

### System Events

System Events are non-lifecycle, observability only.

- `TASK_NOTIFICATION_SENT`
- `TASK_NOTIFICATION_SKIPPED`
- `TASK_NOTIFICATION_FAILED`
- System events MUST NOT affect lifecycle.

## UI Architecture

- UI is event-driven and stateless.
- UI consumes selector outputs only.
- Renderer is a pure projection layer (`events -> deriveWorldState(events) -> render(worldState)`).
- UI and rendering MUST NOT interpret raw events.

## Selector Layer

Selector Layer is the ONLY semantic layer.

- `taskSelectors` owns lifecycle derivation.
- `metricsSelectors` owns metrics aggregation.
- `anomalySelectors` owns anomaly clustering and observability interpretation.
- UI MUST ONLY consume selectors.

## deriveWorldState

`deriveWorldState` is Indexer Only.
`deriveWorldState` returns `events`, `eventsByTaskId`, and `eventsByWorkerId`.
`deriveWorldState` MUST NOT derive lifecycle state, metrics, or anomalies.
`deriveWorldState` MUST NOT perform lifecycle derivation.

## Forbidden Patterns

- UI reading raw events.
- UI logic branching directly on `event.type`.
- UI logic branching directly on `payload.status`.
- lifecycle logic outside selectors.
- system events affecting lifecycle.

## UI Architecture

- UI remains event-driven end-to-end.
- `deriveWorldState` is index-only (`events`, `eventsByTaskId`, `eventsByWorkerId`).
- Selector modules are the only semantic layer (`taskSelectors`, `agentSelectors`, `metricsSelectors`, `anomalySelectors`).
- Lifecycle meaning is derived only from canonical lifecycle events.
- System events are observability-only and do not affect lifecycle derivation.
- UI components are read-only projections over selector outputs.
- Renderer is deterministic and does not inspect raw event payload semantics.
- Anomaly detection is clustered via `getIncidentClusters`.
- Canvas excludes system events (`includeSystemEvents: false`).
- Raccoon Feeder includes system events (`includeSystemEvents: true`).

## Forbidden Patterns

- UI reading raw events for lifecycle meaning.
- UI logic branching directly on `event.type`.
- UI logic branching directly on `payload.status`.
- Lifecycle derivation outside selector modules.
- System events affecting lifecycle status or transitions.

## Boundary Summary

- UI = projection only
- Bridge = intake only
- Workers = execution layer
- Providers = generation layer
- Engine = lifecycle authority

## Testing & CI Enforcement

- `invariant-enforcement.yml` validates runtime safety.
- Selector contract tests enforce deterministic outputs.
- Taxonomy contract tests enforce event purity.
- Anomaly cluster tests enforce schema stability.
- README contract tests enforce architecture wording.

## Modules

- `bridge-server.js`
- `core/engine/taskEngine.js`
- `core/workers/taskExecutionWorker.js`
- `integrations/rendering/providers/*`

## Installation

```bash
npm install
```

## Run

```bash
npm start
```

Server:

```text
http://localhost:3000
```
