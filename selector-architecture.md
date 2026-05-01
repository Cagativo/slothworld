# Selector Architecture

## Philosophy
Selectors are the only place where event meaning is defined.
They transform indexed event data into deterministic projections for UI and rendering.

Selectors are not optional helpers.
They are the semantic boundary of the UI architecture.

## Data Flow

```text
events -> deriveWorldState index -> selectors -> UI/renderer
```

Interpretation responsibilities by layer:
- event log: immutable history
- deriveWorldState: index-only structure
- selectors: lifecycle, metrics, anomaly meaning
- UI: pure projection and presentation

## Rules
- Selectors are the only place where meaning exists
- Selectors must be pure and deterministic for the same input
- Selectors must respect event taxonomy boundaries
- Lifecycle derivation must ignore system events
- UI and renderer must never re-derive selector semantics

## Taxonomy Compliance
Lifecycle selectors must operate on lifecycle-filtered events only.
System events are observability signals and cannot change lifecycle status.

Strict separation:
- Lifecycle events: execution truth
- System events: observability truth

## Example: getTaskStatus
`getTaskStatus` derives task lifecycle status from lifecycle events only.
It does not read system events and does not consume UI-local state.

Contract:
- Input: indexed world + taskId
- Output: deterministic lifecycle status projection
- Safety: lifecycle-only filtering and invariant checks

## Example: getIncidentClusters
`getIncidentClusters` derives clustered anomalies from indexed events.
It supports controlled inclusion of system events via options.

Contract shape:

```js
{
  type,
  severity,
  taskIds,
  summary,
  representativeEvents
}
```

Mode behavior:
- `includeSystemEvents: false` -> lifecycle incident clusters only
- `includeSystemEvents: true` -> lifecycle + observability incident clusters

## Operational Guidance
When adding new UI views:
- add or extend selector outputs first
- keep UI components read-only and projection-only
- avoid direct event parsing in UI modules
- validate taxonomy boundaries with selector contract tests
