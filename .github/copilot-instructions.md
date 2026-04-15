🧠 CORE DEFINITION

Slothworld is a deterministic event-driven workflow execution engine with a real-time 2D office simulation UI.

The system is NOT a game or simulation engine.
The UI is ONLY a visualization layer of backend execution truth.

🧠 ARCHITECTURE TRUTH (ABSOLUTE)

Slothworld has three strictly separated layers:

1. 🧠 EXECUTION LAYER (SOURCE OF TRUTH)
TaskEngine is the ONLY authority over task lifecycle state
Workers execute tasks
Providers generate AI outputs
Bridge handles external integrations

RULES:

Only TaskEngine may mutate task state
Workers never directly modify lifecycle state
Providers are stateless and pure
2. 📡 EVENT LAYER (SYSTEM CONTRACT)

All state changes MUST emit immutable events.

UI and external systems MUST rely ONLY on events.

Required events:
TASK_CREATED
TASK_QUEUED
TASK_CLAIMED
TASK_STARTED
TASK_PROGRESS
TASK_COMPLETED
TASK_FAILED
TASK_ACKED

RULE:
If it is not an event, it does not exist for the UI.

3. 🎨 OFFICE UI LAYER (VISUALIZATION ONLY)

The UI is a 2D office where sprites represent workers.

IMPORTANT:

Agents do NOT exist as system entities
Agents are visual projections of worker + event state
UI is fully reactive and stateless

RULES:

UI MUST NOT execute logic
UI MUST NOT mutate state
UI MUST ONLY consume event stream
UI MUST NOT call providers or TaskEngine
🧍 AGENT MODEL (DERIVED ONLY)

Agents are visual sprites derived from events:

AgentViewModel = {
  agentId: string,
  role: "researcher" | "designer" | "operator" | "executor",
  workerId: string,
  state: "idle" | "moving" | "working" | "error" | "delivering",
  position: { x: number, y: number },
  currentTaskId?: string
}

RULE:

This model is NOT persisted as source of truth
It is derived entirely from event history
🎮 OFFICE SIMULATION MAPPING

UI animations MUST be driven by events:

TASK_CREATED → ticket appears
TASK_CLAIMED → agent walks to desk
TASK_STARTED → working animation
TASK_PROGRESS → progress update
TASK_COMPLETED → delivery animation
TASK_FAILED → error animation
🚫 STRICT FORBIDDEN RULES

DO NOT:

bypass TaskEngine
execute tasks outside worker pipeline
mutate state from UI
call providers directly from UI or bridge
skip event emission
treat agents as autonomous system entities
⚙️ DEVELOPMENT PRINCIPLES

When generating code:

Always route execution through TaskEngine
Always emit events for state changes
Workers must be idempotent and retry-safe
UI must be fully event-driven and stateless
Keep execution and visualization strictly separated
Prefer modular, pluggable architecture
🧠 CORE MINDSET

Slothworld is:

A deterministic AI workflow engine with a real-time visual office layer that renders system truth as animated worker sprites.

The UI is a metaphor. The engine is reality.

FINAL RULE

If a suggestion violates these rules, it is incorrect.