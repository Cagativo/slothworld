Slothworld Execution Engine

Slothworld is an event-driven workflow execution engine for autonomous AI operations.

This system enforces a single deterministic execution pipeline. Any alternative execution path is invalid.

It is not a game, not a simulation runtime, and not a UI-driven execution system.

The platform behaves like a Zapier-style AI orchestration backend: tasks are ingested, routed through an execution engine, processed by workers, delegated to providers, and finalized through ACK-based completion with persistent records.

🔒 Core Guarantee

All task execution is strictly controlled by TaskEngine.

No task can:

execute outside TaskEngine
be marked complete without execution
trigger side effects outside lifecycle

Execution is enforced as:

execute → ack → side effects

Any violation throws ENGINE_ENFORCEMENT_VIOLATION.

Core Flow
Intake -> Engine -> Queue -> Worker -> Provider -> Result -> ACK -> Persistence
UI/External Trigger -> Bridge -> TaskEngine -> Worker -> Provider -> Worker Result -> ACK -> Persistence
Canonical Task Execution Flow (Authoritative)
POST /task
-> TaskEngine.createTask
-> TaskEngine.enqueueTask
-> TaskEngine.claimTask
-> POST /task/:id/execute
-> TaskExecutionWorker
-> TaskEngine stores executionRecord
-> POST /task/:id/ack
-> TaskEngine finalizes
-> post-ACK side effects

Execution must complete before ACK is accepted.

Single Source of Truth Rule

TaskEngine is the only lifecycle authority.

It is the ONLY system allowed to:

transition task state
define lifecycle status changes
determine completion or failure
authorize ACK finalization

Bridge, UI, Workers, and Providers MUST NOT:

mutate lifecycle state
override execution results
finalize completion independently
Architecture Layers
1. Intake (Bridge / Server)
Accepts external requests
Normalizes and persists task intent
Forwards execution to TaskEngine
No execution logic allowed
2. Engine (TaskEngine)
Only state machine in the system
Owns lifecycle transitions:
create → enqueue → claim → execute → ack
Ensures deterministic execution order
Enforces idempotency
Does NOT perform AI or side effects directly
3. Workers (Execution Layer)
Execute task logic
Perform retries and error shaping
Perform controlled side effects (files, APIs, messaging)
Return execution results to engine
Cannot mutate lifecycle state
4. Providers (AI Layer)
Pure model inference layer (OpenAI, HF, etc.)
No filesystem access
No lifecycle access
No orchestration logic
5. Persistence Layer
Stores tasks, events, execution records
ACK is the only lifecycle commit point
Worker artifacts are stored as outputs, not state transitions
Runtime Guarantees
All tasks go through TaskEngine
All execution happens in workers
All AI generation runs through providers
All completion finalization goes through ACK
No browser-side execution logic exists
Explicit Invariants
Tasks cannot complete without TaskEngine execution
ACK requires valid executionRecord
UI is non-authoritative for lifecycle state
Workers cannot run outside engine context
Providers cannot be called outside workers
Side effects occur only after ACK finalization
Execution Entry Points
Allowed
POST /task
POST /task/:id/start
POST /task/:id/execute
POST /task/:id/ack
Rejected (410)
/render/*
/debug/*render*
/asset-store/*
Event Model
Lifecycle Events (authoritative)
TASK_CREATED
TASK_ENQUEUED
TASK_CLAIMED
TASK_EXECUTE_STARTED
TASK_EXECUTE_FINISHED
TASK_ACKED
System Events (observability only)
TASK_NOTIFICATION_SENT
TASK_NOTIFICATION_SKIPPED
TASK_NOTIFICATION_FAILED

System events MUST NOT affect lifecycle derivation.

Event Contract Rule
TASK_ACKED is the terminal authority
Failure is derived from:
TASK_ACKED.payload.status === "failed"
Event Store Rule
bridge-store.json is append-only history
historical failures do not imply active failure state
UI must treat events as replayable history, not live truth
UI Architecture (Projection Model)

UI is strictly a read-only projection layer.

Rules:

UI consumes selector outputs only
UI MUST NOT read raw events for meaning
UI MUST NOT branch on event.type
UI MUST NOT branch on payload.status
Renderer is deterministic and stateless
Selector Layer (Single Source of Meaning)

Selectors are the ONLY semantic layer.

taskSelectors → lifecycle derivation
metricsSelectors → performance aggregation
anomalySelectors → observability clustering

UI must ONLY consume selector outputs.

deriveWorldState (Indexer Only)

Returns:

events
eventsByTaskId
eventsByWorkerId

Must NOT:

derive lifecycle
compute metrics
infer anomalies
interpret semantics
Anomaly Clustering Model
{
  type,
  severity,
  taskIds,
  summary,
  representativeEvents
}

Rules:

only anomalySelectors may construct clusters
UI never modifies clusters
system events optionally included via flag
System Observability Routing
Canvas renderer → includeSystemEvents: false
Raccoon Feeder → includeSystemEvents: true
Forbidden Patterns
UI interpreting raw events
UI branching on event.type
UI branching on payload.status
lifecycle logic outside selectors
system events affecting lifecycle
Boundary Summary
UI = projection layer
Bridge = intake layer
TaskEngine = lifecycle authority
Workers = execution layer
Providers = AI layer
Selectors = semantic layer
Testing & CI Enforcement

System integrity is enforced via:

selector contract freeze tests
taxonomy invariants (lifecycle vs system separation)
anomaly cluster contract tests
CI enforcement pipeline

Any violation of:

lifecycle derivation rules
selector output shape
system event leakage

→ must fail CI

Runtime Modules
bridge-server.js → intake + routing
core/engine/taskEngine.js → lifecycle authority
core/workers/* → execution layer
integrations/providers/* → AI layer
bridge-store.json → event log