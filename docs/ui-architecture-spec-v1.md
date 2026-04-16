Here is your **clean, consolidated, production-grade UI Architecture Spec v2** — combining everything you already built plus the missing enforcement layer so Copilot stops drifting.

You can paste this directly into:

```text
docs/ui-architecture-spec-v2.md
```

---

# 🎨 SLOTHWORLD — UI ARCHITECTURE SPEC v2

---

# 🧠 PURPOSE

The Slothworld UI is a **read-only observability system** for a deterministic event-driven execution engine.

It is NOT:

* a game
* a simulation
* a control system
* a workflow orchestrator

It is:

> a real-time visual debugger for TaskEngine execution

---

# 🧠 ABSOLUTE UI TRUTH

The UI has NO authority over system state.

It only renders truth derived from:

```text
event stream → deriveWorldState → selectors → UI views
```

---

# 🧱 UI DESIGN PRINCIPLES (NON-NEGOTIABLE)

## 1. Event-first architecture

All UI originates from the immutable event stream.

No UI state is authoritative.

---

## 2. Read-only system

UI MUST NOT:

* mutate tasks
* trigger execution
* influence engine behavior
* call providers or backend actions

---

## 3. Multi-view consistency

All panels represent the SAME underlying truth.

Different views ≠ different interpretations.

---

## 4. No hidden logic

UI may:

* filter
* group
* visualize
* highlight

UI may NOT:

* infer lifecycle meaning beyond spec
* invent new system concepts
* create workflow behavior
* introduce decision systems

---

# 🧩 UI SYSTEM MODULES

---

# 1. 🧠 EVENT STREAM CORE

## Role

Immutable backbone of UI.

### Input

* append-only event log

### Output

* normalized event objects

### Rules

* immutable
* chronological ordering guaranteed
* no interpretation logic

### Consumers

* Task Inspector
* Raccoon Feeder
* Canvas Renderer
* Dashboard

---

# 2. 📜 TASK LIFECYCLE INSPECTOR (PRIMARY DEBUG VIEW)

## Role

Explains a single task’s full history.

### Shows:

* full event chain
* timestamps between transitions
* worker involvement
* execution duration
* ACK outcome

### Canonical flow:

```text
TASK_CREATED
→ TASK_ENQUEUED
→ TASK_CLAIMED
→ TASK_EXECUTE_STARTED
→ TASK_EXECUTE_FINISHED
→ TASK_ACKED
```

### Rules:

* derived ONLY from events
* no inferred states
* must flag missing transitions

---

# 3. 🦝 RACCOON FEEDER (EXCEPTION VIEW)

## Role

Read-only anomaly aggregation dashboard.

### Input (ONLY event filters)

* TASK_ACKED failures
* stalled ACK windows
* execution timeouts
* missing transitions
* enforcement violations

### Output

Grouped incident clusters:

* failed_tasks
* stalled_tasks
* unacked_tasks
* execution_timeouts

---

## 🚫 HARD RULES

The Raccoon Feeder MUST NOT:

* trigger retries
* modify tasks
* execute actions
* act as a control system

It is:

> a log intelligence view, not an operator system

---

# 4. 🎮 CANVAS OFFICE RENDERER (SPATIAL VIEW)

## Role

Visual metaphor of execution state.

### Entities (derived only)

* workers
* tasks
* desks
* movement paths

---

## Event mapping:

| Event                 | Visual              |
| --------------------- | ------------------- |
| TASK_CREATED          | ticket spawns       |
| TASK_ENQUEUED         | queued              |
| TASK_CLAIMED          | worker moves        |
| TASK_EXECUTE_STARTED  | working animation   |
| TASK_EXECUTE_FINISHED | processing complete |
| TASK_ACKED            | terminal animation  |

---

## Rules:

* no lifecycle inference
* no stored state
* no logic decisions

---

# 5. 🧭 SYSTEM OVERVIEW DASHBOARD

## Role

High-level system observability.

### Displays:

* active tasks
* throughput
* ACK success/failure rate
* worker utilization
* queue depth
* execution latency

---

## Rules:

* aggregation only
* no per-task mutation
* no semantic inference

---

# 🧍 AGENT VISUAL MODEL (UI ONLY)

Agents DO NOT exist in backend.

They are derived views:

```ts
AgentViewModel = {
  agentId: string,
  role: "researcher" | "designer" | "operator" | "executor",
  state: "idle" | "moving" | "working" | "error" | "delivering",
  position: { x: number, y: number },
  currentTaskId?: string
}
```

---

## RULES

* NOT persisted
* NOT authoritative
* NOT system actors

Agents are:

> animated projections of worker activity

---

# 📊 UI SEMANTIC REGISTRY (STRICT DEFINITION LAYER)

UI is ONLY allowed to use semantics defined here.

---

## 1. TASK DERIVED STATES

Allowed derived states:

* active_task
* executing_task
* pending_ack_task
* completed_task (TASK_ACKED success)
* failed_task (TASK_ACKED failure)

---

## 2. TIME METRICS (STRICT)

Only allowed timing calculations:

* queue_time
  = TASK_CREATED → TASK_CLAIMED

* execution_duration
  = TASK_EXECUTE_STARTED → TASK_EXECUTE_FINISHED

* ack_latency
  = TASK_EXECUTE_FINISHED → TASK_ACKED

NO other timing interpretations allowed.

---

## 3. ANOMALY DEFINITIONS (STRICT RULES)

Only valid anomalies:

* stalled_ack
  TASK_EXECUTE_FINISHED exists AND no TASK_ACKED after threshold

* execution_missing_finish
  TASK_EXECUTE_STARTED exists AND no TASK_EXECUTE_FINISHED

* duplicate_ack
  multiple TASK_ACKED for same taskId

---

## 🚫 PROHIBITED SEMANTICS

UI MUST NOT invent:

* retry storms
* failure clusters
* behavioral intelligence layers
* system health heuristics
* execution irregularities (unless defined above)

If not in registry → it does not exist.

---

# 🔁 DATA FLOW MODEL

```text
Event Stream
   ↓
Event Normalizer
   ↓
deriveWorldState()
   ↓
Semantic Selectors (REGISTRY ONLY)
   ↓
UI Panels
```

---

# 🎨 VISUAL DESIGN RULES

* same event = same meaning everywhere
* no panel may reinterpret lifecycle independently
* animation is representation, not state

---

# 🚫 FORBIDDEN UI PATTERNS

DO NOT:

* mutate tasks
* introduce control actions
* store hidden state per panel
* build smart agents
* infer lifecycle transitions
* create new semantics outside registry
* introduce UI-driven workflows

---

# 🧠 CORE UI MINDSET

The UI is:

> a deterministic observability system for a workflow engine

NOT:

> an interactive simulation of agents

---

# 🧠 FINAL RULE

If a feature requires:

* new lifecycle meaning
* new semantic category
* execution influence
* or system authority

👉 it does NOT belong in UI.

---

# 🧭 VERSION GUARANTEE

This spec is:

* deterministic
* event-bound
* Copilot-safe
* implementation-constrained
* extension-controlled via registry only

---