# Slothworld Execution Engine

Slothworld is an event-driven workflow execution engine for autonomous AI operations.

This system enforces a single deterministic execution pipeline. Any alternative execution path is invalid.

It is not a game, not a simulation runtime, and not a UI-driven execution system.

The platform behaves like a Zapier-style AI orchestration backend: tasks are ingested, routed through an execution engine, processed by workers, delegated to providers, and finalized through ACK-based completion with persistent records.

## 🔒 Core Guarantee

All task execution is strictly controlled by TaskEngine.

No task can:
- execute outside TaskEngine
- be marked complete without execution
- trigger side effects outside lifecycle

Execution is enforced as:

execute → ack → side effects

Any violation throws `ENGINE_ENFORCEMENT_VIOLATION`.

## Core Flow

```text
Intake -> Engine -> Queue -> Worker -> Provider -> Result -> ACK -> Persistence
```

```text
UI/External Trigger → Bridge → TaskEngine → Worker → Provider → Worker Result → ACK → Persistence
```

## Canonical Task Execution Flow (Authoritative)

The enforced lifecycle for externally created tasks is:

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
-> post-ACK side effects (for example Discord notification)
```

Execution must complete before ACK is accepted.

## Single Source of Truth Rule

Law: TaskEngine is the only lifecycle authority. ACK is the engine-emitted finalization event that commits completion state.

The TaskEngine is the ONLY system allowed to:

- transition task state
- define lifecycle status changes
- determine completion or failure
- authorize ACK finalization

Bridge, UI, Workers, and Providers may NOT:

- mutate task state directly
- override lifecycle status
- write completion status independently

All state changes must originate from TaskEngine and be finalized through ACK.

## Architecture

### 1. Intake (Bridge/Server)

- Receives task intents from UI and external systems.
- Normalizes and persists task records.
- Forwards execution through TaskEngine lifecycle endpoints.
- Does not execute provider logic directly.

### 2. Engine (Task Routing + Queue)

- State machine plus scheduler, not executor.
- The Engine is the only state machine in the system.
- Owns lifecycle transitions: create, enqueue, claim, execute, ack.
- Decides ordering, retries, completion, and failure.
- Enforces idempotency and deterministic status transitions.
- Orchestrates workers and finalizes state; it does not perform operational side effects.

### 3. Workers (Execution Layer)

- Execute task logic by type.
- Handle retries, error shaping, and result normalization.
- Own operational side effects: filesystem writes for generated artifacts, external integration calls, and message dispatch.
- Return execution output to the engine; workers do not commit lifecycle status.
- Return structured execution results to the engine.

### 4. Providers (AI Generation Layer)

- Provider abstraction for model calls (for example OpenAI, Hugging Face).
- Pure generation logic only.
- May perform model inference requests only.
- No filesystem access.
- No task-state mutation.
- No queue, bridge, or UI responsibilities.

### 5. Persistence (Storage Layer)

- Stores task records, execution results, event history, and generated asset metadata.
- Lifecycle status persistence is ACK-driven and engine-authoritative.
- Completion and failure status are committed only through ACK finalization.
- Worker-produced artifacts/metadata can be persisted, but task lifecycle state is not worker-writable.

## Runtime Guarantees

- All tasks go through TaskEngine.
- All execution happens in workers.
- All AI generation runs through providers.
- All completion finalization goes through ackTask.
- No browser-side execution logic for providers, queue processing, or filesystem writes.

## Explicit Invariants (Must Never Be Violated)

- Tasks cannot be completed without TaskEngine execution.
- ACK requires both `awaiting_ack` state and a valid `executionRecord`.
- UI is non-authoritative and cannot set terminal lifecycle state (`done`/`failed`) as source of truth.
- Workers cannot run outside TaskEngine execution context.
- Providers cannot be called outside worker/provider context.
- Side effects run only inside engine lifecycle, after ACK finalization.

## Execution Entry Points

The system now enforces one canonical execution chain.

Allowed runtime task entry points:

- `POST /task`: canonical intake (normalizes, persists, creates/enqueues in TaskEngine).
- `POST /task/:id/start`: lifecycle observation sync only; task remains engine-owned.
- `POST /task/:id/execute`: canonical execution trigger (TaskEngine claim -> execute -> ack).
- `POST /task/:id/ack`: idempotent ACK projection/persistence sync; finalization must already be engine-authoritative.

Rejected runtime entry points (HTTP 410):

- `POST /render/openai/generate`
- `POST /render/generate`
- `POST /asset-store/render`
- `POST /debug/test-openai-image`

Rejected runtime entry points (module/runtime guard):

- `integrations/rendering/render-queue.enqueueRenderTask`
- `integrations/rendering/render-queue.startRenderWorkers`
- `integrations/rendering/render-router.executeRenderRoute`
- `integrations/rendering/asset-store.persistRenderedAsset`
- `integrations/rendering/providers/openAIImageAdapter.render`
- `core/image-generation.generateImage`
- `core/task-handling.executeTool`

Canonical chain:

```text
POST /task -> TaskEngine.createTask -> TaskEngine.enqueueTask -> TaskEngine.claimTask -> TaskEngine.executeTask -> TaskEngine.ackTask -> projection/persistence read model
```

## Enforcement Mechanisms

- Runtime context guards in `core/engine/enforcementRuntime.js` enforce engine/worker/provider/side-effect execution boundaries.
- ACK validation rejects body-driven status or payload injection and requires existing `executionRecord`.
- Execution context propagation is performed through TaskEngine lifecycle so worker/provider/side-effect calls are validated.
- Task-creation circuit breaker throttles intake bursts in a 10-second window.
- Internal/system task intake blocking applies to external HTTP `/task` creation attempts.

## Security Guarantees

- No status forgery through ACK payload injection.
- No direct execution bypass outside TaskEngine lifecycle.
- No direct provider bypass outside worker context.
- No side-effect injection outside engine lifecycle.
- Deterministic lifecycle ordering is enforced: execute -> ack -> side effects.

## Observability / Logs

Key enforcement and ordering logs include:

- `TASK_EXECUTE_REQUEST`
- `TASK_EXECUTION_WORKER_RUN`
- `TASK_EXECUTE_FINISHED`
- `ACK_WITHOUT_EXECUTION`
- `ENGINE_ENFORCEMENT_VIOLATION`

## Failure, Retry, and Idempotency Rules

- Retry ownership is engine-directed and worker-executed.
- Workers return retryable versus terminal failures in structured results.
- A task reaches terminal state only when retries are exhausted or completion succeeds.
- Terminal failed tasks are persisted as failed outcomes (dead-letter equivalent) and are not re-executed automatically.
- Replays and duplicate execute attempts must be idempotent at the engine level.

## Event Contract & Failure Derivation

- TaskEngine remains the only lifecycle authority.
- ACK finalizes terminal lifecycle state.
- `TASK_ACKED` is the terminal authority for success and failure in the current merged event contract.
- A task is derived as failed when `TASK_ACKED` contains `payload.status === "failed"`.
- `TASK_FAILED` is not required for failure-state derivation in current runtime behavior.

Failure derivation contract summary:

```text
TASK_EXECUTE_FINISHED (success: false) -> awaiting_ack
TASK_ACKED (payload.status: failed) -> terminal failed
```

This keeps lifecycle finalization centralized in the engine ACK step and avoids frontend-owned terminal inference.

## Historical Event Artifacts

- Event history in `bridge-store.json` is append-only runtime history across runs.
- Older `TASK_ACKED` entries with `payload.status === "failed"` can remain in storage from prior execution cycles.
- These historical failed ACK events do not, by themselves, mean there is an active failure in the current cycle.
- UI and diagnostics must treat the event log as immutable history, not a live-only feed.

Interpretation rule:

- Event truth is authoritative, but operators should reason about failure in the context of recency or execution cycle boundaries when separating active versus historical failures.

## UI vs Event Truth Separation

- UI state is derived from event replay via `deriveWorldState`.
- The event store is the source of truth; frontend in-memory state is not authoritative.
- Derived failed tasks may include historical failures unless replay is scoped by recency window or execution cycle.
- This does not change architecture authority: TaskEngine owns lifecycle transitions, Bridge is intake-only, workers execute, providers generate, and ACK finalizes state.

## UI Architecture & Event-Driven Rendering Model

- TaskEngine is the lifecycle authority.
- `TASK_ACKED` is the sole terminal source of truth.
- `deriveWorldState` is Indexer Only.
- `deriveWorldState` returns `events`, `eventsByTaskId`, and `eventsByWorkerId`.
- `deriveWorldState` MUST NOT derive lifecycle state, metrics, or anomalies.
- `deriveWorldState` MUST NOT perform lifecycle derivation.
- Renderer is a pure projection layer (`events -> deriveWorldState(events) -> render(worldState)`).
- UI is fully event-driven and stateless.
- No lifecycle logic exists in the rendering layer.

Additional UI/runtime notes:

- Visual states include queued and awaiting_ack in the derived task/agent projection.
- The operator debug panel provides event timeline inspection (clickable events, payload inspector, selected-task highlighting, and event/task window filters).
- Invariants are enforced in tests, including: no terminal state without ACK, `TASK_FAILED` non-authoritative for terminal failure, `TASK_EXECUTE_FINISHED(success:false)` stays awaiting_ack, and `TASK_ACKED(status:"failed")` commits terminal failed.

## Selector Layer

- Selector Layer is the ONLY semantic layer.
- `taskSelectors` owns lifecycle derivation.
- `metricsSelectors` owns metrics aggregation.
- `anomalySelectors` owns anomaly clustering and observability interpretation.
- UI components are read-only projections over selector outputs.
- UI and rendering MUST NOT interpret raw events.
- Canvas excludes system events (`includeSystemEvents: false`).
- Raccoon Feeder includes system events (`includeSystemEvents: true`).

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

## Forbidden Patterns

- UI reading raw events for lifecycle meaning.
- UI logic branching directly on `event.type`.
- UI logic branching directly on `payload.status`.
- Lifecycle derivation outside selector modules.
- System events affecting lifecycle status or transitions.

## Boundary Summary

- UI is intent-only.
- Bridge handles intake and lifecycle API boundaries.
- Workers execute side effects; providers generate AI outputs.

## Deprecated Execution Paths

Legacy render-router and adapter-style execution paths are deprecated and disabled.
Current stable runtime is engine-first and worker-driven.

## Testing and CI Enforcement

- Adversarial enforcement tests validate exploit resistance against lifecycle, authority, provider, and side-effect bypasses.
- Invariant enforcement suite runs as permanent regression checks.
- CI workflow (`.github/workflows/invariant-enforcement.yml`) runs enforcement checks on push and pull request.

## Project Modules

- `bridge-server.js`: intake API, lifecycle endpoints, ACK persistence integration.
- `core/engine/taskEngine.js` and `core/engine/taskEngine.ts`: engine lifecycle contracts and runtime behavior.
- `core/workers/taskExecutionWorker.js`: task execution dispatcher.
- `core/workers/imageRenderWorker.js`: image task execution + filesystem persistence.
- `integrations/rendering/providers/*`: provider implementations and provider registry.
- `bridge-store.json`: persistent task/event storage.

## Installation

### 1. Prerequisites

- Node.js 18+
- npm

### 2. Install

```bash
npm install
```

### 3. Environment

Create `.env` in project root:

```env
HOST=0.0.0.0
PORT=3000
OPENAI_API_KEY=your_openai_api_key_here
HUGGINGFACE_API_KEY=your_huggingface_api_key_here
DISCORD_BOT_TOKEN=your_token_here
ALLOWED_CHANNELS=123456789012345678,987654321098765432
```

## Run

```bash
npm start
```

Server default:

```text
http://localhost:3000
```

## Minimal API Examples

Create task:

```bash
curl -X POST http://localhost:3000/task \
  -H "Content-Type: application/json" \
  -d '{
    "type": "image_render",
    "title": "Generate Product Image",
    "action": "render_product_image",
    "payload": {
      "productId": "product-demo",
      "provider": "openai",
      "designIntent": {
        "prompt": "minimal product hero shot"
      }
    }
  }'
```

Execute task lifecycle:

```bash
curl -X POST http://localhost:3000/task/<task-id>/start
curl -X POST http://localhost:3000/task/<task-id>/execute
curl -X POST http://localhost:3000/task/<task-id>/ack \
  -H "Content-Type: application/json" \
  -d '{}'
```

Fetch tasks/events:

```bash
curl http://localhost:3000/tasks
curl "http://localhost:3000/events?after=0"
```
