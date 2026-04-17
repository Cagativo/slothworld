# Slothworld UI Architecture

This document reflects the current architecture. It is versionless by design.

Historical evolution (v1 → v2) has been fully consolidated into this spec.

---

## Purpose

The Slothworld UI is a deterministic, read-only projection of an event-driven system.

- The event log is the only source of truth
- `deriveWorldState` indexes events (no meaning)
- selectors define all semantic meaning
- UI renders selector output

No UI component may interpret raw events directly.

---

## deriveWorldState (Pure Indexer)

`deriveWorldState` is a pure indexer.

It returns indexed event containers without applying lifecycle semantics, metrics, or anomaly logic.

Returned structure:
- `events`: ordered raw event list
- `eventsByTaskId`: task-scoped event index
- `eventsByWorkerId`: worker-scoped event index

Hard boundary:
- Must not derive lifecycle status
- Must not compute metrics
- Must not infer anomalies
- Must not classify success or failure

---

## Selector Layer (Single Source of Meaning)

Selectors are the only semantic layer.

Selectors are pure functions.

They must:
- depend only on input data
- produce deterministic outputs
- contain all lifecycle and anomaly meaning

No other layer is allowed to define semantic meaning.

UI and rendering modules must consume selector outputs and never reinterpret event meaning.

### taskSelectors
Lifecycle derivation and task-level projections.
Examples:
- task status
- task snapshots
- transitions
- task timelines

### agentSelectors
Agent projections derived from indexed world state.
Examples:
- active task association
- visual state projection
- workload views

### metricsSelectors
Aggregations derived from lifecycle-safe selector inputs.
Examples:
- queue time
- execution duration
- ack latency
- throughput counts

### anomalySelectors
Clustered incident derivation for observability.

Examples:
- execution failures
- stalled tasks
- notification issues

Clusters are the only allowed anomaly output format.
UI must not construct or infer incidents manually.

---

## Event Taxonomy

Event taxonomy is strict and explicit.

### Lifecycle events:
- `TASK_CREATED`
- `TASK_ENQUEUED`
- `TASK_CLAIMED`
- `TASK_EXECUTE_STARTED`
- `TASK_EXECUTE_FINISHED`
- `TASK_ACKED`

### System events (observability only):
- `TASK_NOTIFICATION_SENT`
- `TASK_NOTIFICATION_SKIPPED`
- `TASK_NOTIFICATION_FAILED`

Rule:
- Lifecycle derivation must operate on lifecycle events only
- System events MUST NOT affect lifecycle derivation

---

## UI Consumption Rules

Strictly forbidden in UI and renderer modules:

- Reading `event.type` directly
- Reading `payload.status` directly
- Re-deriving lifecycle meaning outside selectors
- Re-deriving anomaly meaning outside selectors

Required:
- UI components consume selector outputs only
- Rendering consumes projection models only
- Renderer behavior is deterministic for a given indexed input

---

## Anomaly Clustering Model

`getIncidentClusters(indexedWorld, options)` returns:


{
  type,
  severity,
  taskIds,
  summary,
  representativeEvents
}

Field contract:

type: cluster identifier string
severity: "low" | "medium" | "high"
taskIds: array of related task IDs
summary: human-readable cluster summary
representativeEvents: array of representative events for inspection

System-event inclusion rules:
- Canvas renderer must call with `includeSystemEvents: false`
- Raccoon Feeder must call with `includeSystemEvents: true`

---

## Observability Events (Non-Lifecycle)

Notification observability is expressed through system events and must not modify lifecycle state.

Events:
- `TASK_NOTIFICATION_SENT`: notification dispatch succeeded
- `TASK_NOTIFICATION_SKIPPED`: notification intentionally not sent
- `TASK_NOTIFICATION_FAILED`: notification attempted but failed

Purpose:
- operational visibility
- anomaly clustering support
- diagnostics without affecting lifecycle

---

## Final Constraint

If a feature requires:
- new semantic interpretation
- lifecycle changes
- or state authority

it must be implemented in selectors, not in UI or rendering layers.