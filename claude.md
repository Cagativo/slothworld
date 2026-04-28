# CLAUDE.md

## Project summary
Slothworld is an event-driven workflow execution engine for autonomous AI operations.
It is not a game, not a simulation runtime, and not a UI-driven execution system.

## Non-negotiable architecture
- TaskEngine is the only lifecycle authority.
- `TASK_ACKED` is the sole terminal source of truth.
- UI is never authoritative.
- Workers execute task logic but do not mutate lifecycle state.
- Providers are pure inference/generation layers with no orchestration or state authority.

## Execution invariants
- Canonical flow: `execute -> ack -> side effects`
- Tasks cannot complete without execution.
- ACK requires a valid executionRecord.
- Workers cannot execute outside engine context.
- Providers cannot be called directly from UI.
- System events must never affect lifecycle state.

## UI rules
- UI is a deterministic, read-only projection of the event system.
- `deriveWorldState` is index-only and may only return:
  - `events`
  - `eventsByTaskId`
  - `eventsByWorkerId`
- `deriveWorldState` must not derive lifecycle, metrics, anomalies, or status.
- Selectors are the only semantic layer:
  - `taskSelectors`
  - `agentSelectors`
  - `metricsSelectors`
  - `anomalySelectors`
- UI components must consume selector outputs only.
- Renderer code must not inspect raw event payload semantics.

## Forbidden patterns
- UI branching on `event.type`
- UI branching on `payload.status`
- Lifecycle derivation outside selectors
- Anomaly derivation outside selectors
- System events affecting lifecycle
- Any execution path outside TaskEngine

## Change policy
When working on UI:
1. Preserve all architecture boundaries.
2. Do not move semantic meaning into components.
3. Prefer presentation/layout/styling changes over logic changes.
4. If a feature requires new semantic meaning, implement it in selectors, not UI.
5. Before coding, explain which files will change and why.

## Working style
- Start with discovery and planning before editing.
- Read relevant files first.
- Keep diffs small and architecture-safe.
- When changing UI, verify no component interprets raw events.
- If a constraint conflicts with a requested feature, call it out explicitly.

## Key modules
- `bridge-server.js`
- `core/engine/taskEngine.js`
- `core/workers/taskExecutionWorker.js`
- `integrations/rendering/providers/*`

## Validation
Before finishing:
- run relevant tests
- check selector contracts
- check taxonomy/lifecycle boundaries
- confirm UI still consumes selector outputs only