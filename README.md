# Slothworld Execution Engine

Slothworld is an event-driven workflow execution engine for autonomous AI operations.

This system enforces a single deterministic execution pipeline. Any alternative execution path is invalid.

It is not a game, not a simulation runtime, and not a UI-driven execution system.

The platform behaves like a Zapier-style AI orchestration backend: tasks are ingested, routed through an execution engine, processed by workers, delegated to providers, and finalized through ACK-based completion with persistent records.

---

## 🔒 Core Guarantee

All task execution is strictly controlled by TaskEngine.

No task can:
- execute outside TaskEngine
- be marked complete without execution
- trigger side effects outside lifecycle

Execution is enforced as:

execute → ack → side effects

Any violation throws `ENGINE_ENFORCEMENT_VIOLATION`.

---

## Core Flow

```text
Intake -> Engine -> Queue -> Worker -> Provider -> Result -> ACK -> Persistence
````

```text
UI/External Trigger → Bridge → TaskEngine → Worker → Provider → Worker Result → ACK → Persistence
```

---

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

---

## Single Source of Truth Rule

TaskEngine is the only lifecycle authority.

It is the only system allowed to:

* transition task state
* define lifecycle status changes
* determine completion or failure
* authorize ACK finalization

Bridge, UI, Workers, Providers must NOT:

* mutate task state directly
* override lifecycle status
* write completion state independently

---

## Architecture

### Intake (Bridge)

* Normalizes and persists tasks
* Calls TaskEngine only
* No execution logic

### Engine (TaskEngine)

* State machine + scheduler
* Owns lifecycle transitions
* Executes orchestration only

### Workers

* Execute task logic
* Perform side effects
* Return structured results
* Do NOT mutate lifecycle state

### Providers

* Pure model inference layer
* No state, no filesystem, no orchestration

### Persistence

* Stores events + execution records
* Lifecycle state is ACK-authoritative

---

## Runtime Guarantees

* All tasks go through TaskEngine
* All execution happens in workers
* All AI runs through providers
* All completion is finalized by ACK
* UI is never authoritative

---

## Explicit Invariants

* Tasks cannot complete without execution
* ACK requires valid executionRecord
* Workers cannot execute outside engine context
* Providers cannot be called directly from UI
* Side effects occur only post-ACK

---

## Execution Entry Points

Allowed:

* POST /task
* POST /task/:id/start
* POST /task/:id/execute
* POST /task/:id/ack

Rejected:

* /render/*
* /asset-store/*
* /debug/*

---

## Event Contract

### Lifecycle Events

* TASK_CREATED
* TASK_ENQUEUED
* TASK_CLAIMED
* TASK_EXECUTE_STARTED
* TASK_EXECUTE_FINISHED
* TASK_ACKED

### System Events (Observability Only)

* TASK_NOTIFICATION_SENT
* TASK_NOTIFICATION_SKIPPED
* TASK_NOTIFICATION_FAILED

System events MUST NOT affect lifecycle.

---

## UI Architecture (Source of Truth Model)

* UI is event-driven and stateless
* UI consumes `deriveWorldState` output only
* UI MUST NOT inspect raw events
* Renderer is pure projection

---

## Selector Layer (ONLY Semantic Layer)

Selectors are the ONLY semantic system.

* taskSelectors → lifecycle derivation
* metricsSelectors → aggregation
* anomalySelectors → clustering

UI MUST ONLY consume selectors.

---

## deriveWorldState (Indexer Only)

Returns:

* events
* eventsByTaskId
* eventsByWorkerId

MUST NOT:

* derive lifecycle
* compute metrics
* infer anomalies

---

## Forbidden Patterns

* UI reading raw events
* UI using event.type directly
* UI using payload.status directly
* lifecycle logic outside selectors
* system events affecting lifecycle

---

## Boundary Summary

* UI = projection only
* Bridge = intake only
* Workers = execution layer
* Providers = generation layer
* Engine = lifecycle authority

---

## Testing & CI Enforcement

* invariant-enforcement.yml validates runtime safety
* selector-contract tests enforce deterministic outputs
* taxonomy contract tests enforce event purity
* anomaly cluster tests enforce schema stability

---

## Modules

* bridge-server.js
* core/engine/taskEngine.js
* core/workers/taskExecutionWorker.js
* integrations/rendering/providers/*

---

## Run

```bash
npm install
npm start
```

Server:

```text
http://localhost:3000
```

---

## Minimal API

```bash
curl -X POST http://localhost:3000/task ...
curl http://localhost:3000/tasks
curl http://localhost:3000/events
```

---
