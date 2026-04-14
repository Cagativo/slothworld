# Copilot System Instructions for Slothworld

These instructions define the architecture, constraints, and development philosophy of Slothworld.

Copilot MUST follow these rules when generating, modifying, or suggesting code.

If a suggestion conflicts with these rules, it should be considered incorrect.

---
You are assisting in the development of “Slothworld”, an event-driven AI operations simulator that has evolved into a commerce automation engine.

This is not a game. It is a distributed AI workflow system that simulates an office of autonomous agents that execute real tasks and generate real outputs (including commercial assets).

---

## 🧠 SYSTEM CONTEXT

Slothworld consists of:

1. Agent Simulation Layer
- AI agents act as workers in a digital office
- Agents have roles (researcher, executor, operator, etc.)
- They pick up tasks, execute workflows, retry failures, and emit state transitions

2. Task + Workflow Engine
- Everything is a task (image generation, research, product creation, publishing)
- Tasks flow through: UI → normalization → queue → worker → execution → ACK completion
- ACK is the source of truth for completion

3. Event-Driven Architecture
- All system behavior is driven by events
- Event stream is used for observability and debugging
- No tight coupling between modules

4. Bridge Server
- Handles external integrations (Discord, Shopify, APIs)
- Ingests tasks and forwards them into the internal queue system
- Manages persistence via bridge-store.json

5. Render / Image Generation Pipeline
- Image generation is handled as a “provider-based system”
- DO NOT hardcode any single AI provider (e.g. OpenAI)
- All image generation must use an abstraction layer:

interface ImageProvider {
  generate(prompt: string, context: TaskContext): Promise<ImageResult>;
}

- Providers can include:
  - Hugging Face Inference API (primary free option)
  - Local ComfyUI server
  - Replicate (optional fallback)
  - OpenAI (legacy / optional)

- All image outputs must be stored in assets/generated/

6. Discord Integration
- Discord is a control plane for triggering tasks and receiving outputs
- Discord messages may create tasks or receive completion notifications

7. Operator Control Panel
- UI is read-only observability dashboard
- Shows:
  - tasks
  - agents
  - workflows
  - event stream
- Must not directly mutate system state

---

## 🧩 ARCHITECTURE RULES (VERY IMPORTANT)

- Never bypass the task queue system
- Never execute side effects outside ACK-based completion flow
- All external actions must go through bridge server or worker pipeline
- Image generation MUST go through ImageProvider abstraction
- No direct API calls inside UI components
- Keep modules strictly separated (core, workers, bridge, UI, render)

---

## 📝 TASK EXECUTION PATTERN

1. Task is created and normalized
2. Task is pushed into queue
3. Worker claims task
4. Worker executes task logic
5. External side effects occur inside worker only
6. Result is persisted
7. ACK event is emitted as the single source of truth

Workers must:
- be idempotent
- support retries
- emit events for observability
- never directly mutate global state without emitting events

---

## 🎨 IMAGE GENERATION RULES

When generating images:

- Always use structured prompts (not raw user input)
- Enforce consistent “Slothworld style”:
  - clean 2D illustration
  - office / system aesthetic
  - soft lighting
  - consistent UI/game-simulation visual identity
- Never depend on a single provider
- Always assume provider may fail and implement retry/fallback logic

---

## ⚙️ DEVELOPMENT PRIORITY

When writing or modifying code, prioritize:

1. System reliability (queue correctness, ACK integrity)
2. Observability (event tracing, debugging)
3. Modular design (pluggable providers, isolated services)
4. Deterministic workflows
5. Clear separation of simulation vs execution layers

---

## 💻 CODE GENERATION GUIDELINES

- Prefer small, composable modules over large files
- Always route execution through queues and workers
- Use explicit types/interfaces for all core systems (Task, Agent, Event, ImageProvider)
- Include logging or event emission for all important actions
- Design for retryability and idempotency
- Avoid hidden side effects

---

## 🚫 DO NOT

- Do not hardcode OpenAI image generation
- Do not bypass the task queue
- Do not mix UI logic with execution logic
- Do not directly mutate agent state without events
- Do not treat Slothworld as a game engine

---

## 🧠 CORE MINDSET

Slothworld is:

> A distributed AI workforce simulation that produces real-world outputs through a deterministic event-driven execution pipeline.

Every feature must respect this architecture.