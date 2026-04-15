🧠 SLOTHWORLD — CANONICAL ARCHITECTURE CONTRACT

Slothworld is a deterministic event-driven workflow execution engine with a real-time 2D office visualization layer.

The system is NOT a game, NOT a simulation engine.
The UI is only a reactive visualization of backend execution truth.

🧠 ABSOLUTE SYSTEM TRUTH

There are exactly 3 layers:

1. 🧠 EXECUTION LAYER (SOURCE OF TRUTH)

TaskEngine is the ONLY authority over lifecycle state.

TaskEngine controls all task transitions
Workers execute tasks
Providers generate AI output (pure functions)
Bridge only routes external requests
HARD RULES:
Only TaskEngine may mutate task state
Workers NEVER directly set lifecycle state
Providers are stateless and cannot persist anything
No other system can create or finalize lifecycle transitions
2. 📡 EVENT LAYER (IMMUTABLE SYSTEM LOG)

All system truth is represented as append-only events.

UI + analytics MUST be derived ONLY from events.

📌 CANONICAL EVENT SET (STRICT)

These are the ONLY valid lifecycle events:

TASK_CREATED
TASK_ENQUEUED
TASK_CLAIMED
TASK_EXECUTE_STARTED
TASK_EXECUTE_FINISHED
TASK_ACKED
⚠️ IMPORTANT RULE
There is NO TASK_STARTED event
There is NO TASK_QUEUED event
There is NO TASK_COMPLETED event
There is NO TASK_FAILED event as a primary lifecycle event

Failure is derived from:

TASK_ACKED.payload.status === "failed"

3. 🎨 UI LAYER (OFFICE VISUALIZATION ONLY)

The UI is a stateless 2D office renderer.

It visualizes workers as sprites moving through an office.

HARD RULES:
UI does NOT execute logic
UI does NOT mutate state
UI does NOT call TaskEngine, workers, or providers
UI ONLY consumes event stream
🧍 AGENT MODEL (DERIVED VIEW ONLY)

Agents DO NOT exist in the backend.

They are derived from events:

AgentViewModel = {
  agentId: string,
  role: "researcher" | "designer" | "operator" | "executor",
  workerId: string,
  state: "idle" | "moving" | "working" | "error" | "delivering",
  position: { x: number, y: number },
  currentTaskId?: string
}

RULE:

This is NOT persisted
This is NOT authoritative
This is purely derived from event history
🎮 OFFICE SIMULATION MAPPING

UI animations MUST be derived from events:

TASK_CREATED → ticket appears
TASK_ENQUEUED → queued at intake desk
TASK_CLAIMED → worker moves to task
TASK_EXECUTE_STARTED → working animation begins
TASK_EXECUTE_FINISHED → processing complete animation
TASK_ACKED → terminal state animation (success/failure)
🚫 STRICT FORBIDDEN RULES

DO NOT:

bypass TaskEngine
create lifecycle state outside event emission
invent new event types
introduce TASK_STARTED / TASK_QUEUED / TASK_COMPLETED
mutate state from UI
call providers directly from UI or bridge
treat UI as a system actor
⚙️ ENGINEERING PRINCIPLES

When generating code:

Always route execution through TaskEngine
Always emit canonical events only
Workers must be idempotent and retry-safe
UI must be fully event-driven and stateless
Never introduce new lifecycle states without engine changes
Prefer strict determinism over convenience
🧠 CORE MINDSET

Slothworld is:

A deterministic AI workflow engine with a real-time visual office layer that renders execution truth as animated worker behavior.

The UI is a metaphor. The engine is reality.

FINAL RULE

If a suggestion violates this contract, it is incorrect.