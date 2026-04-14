# Slothworld AI Office Simulation

Slothworld is a modular, event-driven browser simulation that visualizes agent behavior and task workflows. AI-controlled workers process queued tasks drawn from Discord and Shopify through a step-based execution loop. The system is structured with clear module boundaries across core simulation logic, rendering, UI controls, and a bridge server.

## Features

- **Modular architecture**: Core simulation, rendering, and UI logic cleanly separated into independent modules.
- **Event-driven**: Decoupled event system (event stream, emissions) enables observability and extensibility without cross-module coupling.
- **Agent simulation**: Four AI agents with role-based skills (researcher, executor, other) that autonomously claim tasks, move, work, and retry.
- **Step-based workflows**: Multi-step workflows with approval gates, retries, and context propagation.
- **Real-time canvas rendering**: Pixel art office with animated agents, desk queues, task progress bars, and workflow overlays.
- **Operator Control Panel**: Read-only runtime dashboard for task queues, agent state, workflows, and event stream.
- **Task Creator panel**: Form-driven task creation UI for Discord/Shopify intents (no manual in-canvas console input required).
- **Task bridge server**: HTTP endpoints for task ingestion, polling, execution, and acknowledgement. Persistent storage in `bridge-store.json`.
- **Optional Discord integration**: Listen for mentions and commands; ingest tasks via event polling.
- **Unified completion pipeline**: All tasks (UI, API, workflows, Discord) complete exclusively through ACK-based lifecycle handling ensuring consistent state transitions and reliable external side effects.
- **Discord completion notifications**: Completed tasks can notify Discord via channel post or message reply (when `messageId` is available).
- **Worker-based image generation**: `image_render` tasks run through a backend worker pipeline (provider -> worker persistence -> asset URL) with browser-safe UI calls.
- **Agent lifecycle + speech system**: Agents remain seated while working/waiting, transition through explicit visual states, and use cooldown-gated speech bubbles.

## System Architecture Flow

The runtime follows an ACK-centered task lifecycle:

```text
Task Creator UI
→ controlAPI.injectTask
→ Task Normalization (core/task-handling)
→ Desk Queue Assignment
→ Agent Execution Loop
→ Task Completion (status = done | failed)
→ ACK Handler (bridge-server)
→ External Side Effects (Discord / integrations)
```

All task completions must pass through ACK — no exceptions.

## Key Design Principles

### Single Completion Pipeline
All tasks must complete through `POST /task/:id/ack`.

### Bridge Store Lifecycle Mutation
Bridge lifecycle endpoints (`/start`, `/execute`, `/ack`) update existing stored task references in place.

### Payload Continuity
Task payload is carried end-to-end and used for integration behavior.
For Discord tasks, `channelId`, `messageId`, and `content` are the operational fields.

For image-render tasks, the bridge persists the generated PNG and returns a local asset URL that becomes `task.executionResult.imageUrl`.

### Event-driven execution
State changes emit events; no direct side-effect coupling in core.

### UI only emits intent
UI only calls `window.controlAPI.injectTask()`.

## System Behavior (Verified)

The following behavior is verified against runtime code in `core/`, `ui/`, `rendering/`, and `bridge-server.js`.

### Runtime task flow

1. UI task creation calls `window.controlAPI.injectTask(task)`.
2. `core/task-handling.normalizeTask` enforces task defaults and normalizes payload shape.
3. `addTaskToDesk` assigns the task to the least-loaded eligible desk and emits `TASK_CREATED`.
4. Agent loop (`core/agent-logic.update`) claims queued work (`TASK_STARTED`), progresses work, and triggers execution.
5. Task execution runs via tool mapping in `core/task-handling.executeTask`.
6. Completion always routes through `sendTaskAck(...)` to `POST /task/:id/ack` with status `done` or `failed`.
7. Bridge ACK handler persists final status, merges optional ACK payload updates, records timing/error fields, and triggers completion notifications.

### Payload and persistence rules

- Bridge normalization requires `type` (`discord` or `shopify`) and stores payload as an object.
- In simulation, payload is normalized before queueing; Discord payload is shaped around `channelId`, `content`, and optional `messageId`.
- ACK payload is merged into the stored task payload (not replaced) by the bridge.
- Bridge polling endpoint `GET /events?after=n` only returns tasks currently in `pending` status.

### Discord integration behavior

- Discord bot integration is enabled only when `DISCORD_BOT_TOKEN` is configured and client login succeeds.
- Listener ingests mentions and prefix commands (`!`) into bridge tasks, with optional channel gating via `ALLOWED_CHANNELS`.
- Bridge task execution for Discord replies fetches channel/message and replies; some actions (`fetch_order`, `refund_order`) return success notes for downstream handling.
- On ACK completion, bridge attempts completion notification:
  - reply to original message when `messageId` exists and fetch succeeds
  - fallback to channel send when reply is unavailable

### Image generation behavior

- The only supported image provider is OpenAI.
- `core/image-generation.js` is a browser-safe bridge client that posts to `POST /render/openai/generate` and returns normalized image result metadata.
- `bridge-server.js` delegates image execution to `core/workers/imageRenderWorker.js`.
- `imageRenderWorker.js` is the Node-only layer responsible for filesystem writes to `assets/generated/<productId>/` and returning persisted asset metadata.
- `openaiImageProvider.js` is provider logic only (OpenAI Responses API call + base64 extraction), with no filesystem writes.
- The OpenAI provider extracts the image from `response.output` where `type === "image_generation_call"` and reads `output.result` as base64 PNG.
- PNG-only output is enforced; SVG placeholder generation has been removed.
- `POST /asset-store/render` persists generated images under `assets/generated/<productId>/`.
- `/asset-store/render` accepts strict contract payloads only: `contentBase64` (PNG base64 string), `extension: "png"`, `mimeType: "image/png"`.
- `/asset-store/render` request body limit is set to 25MB to support image base64 payloads.
- `render.route` returns the persisted asset URL, and that URL is stored as `task.executionResult.imageUrl`.
- Generated images are created through the API and stored locally by the bridge; they are not expected to appear in the OpenAI Playground image history.

### Agent lifecycle + speech behavior

- Agent visual lifecycle is explicit: `idle -> moving -> sitting -> working -> waiting -> complete_react -> idle`.
- Agents stay seated for `working`, `waiting`, and `complete_react` rendering states.
- Completion is status-driven (`done`/`failed`), synchronized from completion events and task status.
- Speech bubbles are state-driven (`agent.speech`) with cooldown gating.
- Speech duration/cooldown is currently 7000ms.

### Control API behavior

- `window.controlAPI.injectTask(...)` is the primary UI/task-intent entrypoint and enqueues tasks in simulation.
- `window.dispatchCommand(...)` parses command strings and routes to inject/spawn/inspect/pause/resume/workflow actions.
- Keyboard debug-console interception is disabled; command APIs remain callable programmatically.

## Project Structure

The codebase is organized into modular components by responsibility:

### Core (`core/`)
- **constants.js** – Global timings, thresholds, debug flags, sprite configurations
- **utils.js** – Pure utility functions (random generation, ID creation, serialization)
- **app-state.js** – Shared state initialization: canvas, agents, desks, workflows, event emitter
- **task-handling.js** – Task factories, execution, tool registry, bridge polling, retry logic
- **workflow.js** – Workflow lifecycle: creation, step queueing, approval/rejection, context propagation
- **agent-logic.js** – Agent simulation lifecycle, task claiming/execution, completion reactions, and speech state updates
- **workers/imageRenderWorker.js** – Node worker for provider execution and file persistence to generated assets
- **types/TaskContext.ts** – Shared task execution context contract for providers/workers
- **types/ImageResult.ts** – Shared provider output contract with metadata/base64 fields

### Rendering (`rendering/`)
- **assets.js** – Asset loader and sprite path registry (lazy-loaded into memory)
- **overlays.js** – Visual effects: HUD, agent labels, workflow cards, task indicators, particles
- **canvas-renderer.js** – Render orchestration and canvas drawing primitive

### UI (`ui/`)
- **command-parser.js** – Pure command parsing (8+ commands: inject, spawn, inspect, approve, etc.)
- **operator-control-panel.js** – Read-only runtime observer panel (queues, agents, workflows, events)
- **task-creator-panel.js** – Form-based task injection UI with structured payload creation
- **control-api.js** – Control command handlers (agent inspection, movement, role assignment, workflow actions)
- **keyboard-input.js** – Keyboard binding shim (debug console interception retired)

### Image pipeline modules
- **core/image-generation.js** – Frontend-safe bridge client for image generation requests and normalized image results
- **integrations/rendering/render-router.js** – OpenAI-only render routing for `image_render` tasks
- **integrations/rendering/providers/openAIImageAdapter.js** – Render adapter that converts backend image results into the asset-store contract
- **integrations/rendering/providers/openaiImageProvider.js** – OpenAI provider logic (Responses API -> base64 PNG extraction), no filesystem access
- **integrations/rendering/providers/HuggingFaceImageProvider.ts** – Hugging Face provider implementation returning image payload metadata/base64
- **integrations/rendering/providers/ImageProvider.ts** – Shared provider interface (`generate(prompt, context) => ImageResult`)
- **integrations/rendering/asset-store.js** – Persists generated PNG assets through the bridge

### Root
- **main.js** – Thin orchestrator: imports all modules, exposes window API, starts simulation loop and bridge polling
- **index.html** – HTML entry point with canvas and ES module script loader
- **bridge-server.js** – Node.js backend: HTTP task API, Discord webhook listener, persistent storage
- **style.css** – Canvas wrapper styling
- **assets/** – Pixel art sprites for agents, desks, furniture, and environmental elements
- **bridge-store.json** – Persistent task storage

## Installation

### 1. Prerequisites

- Node.js 18+ (recommended)
- npm

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables (optional but recommended)

Create a `.env` file in the project root:

```env
HOST=0.0.0.0
PORT=3000
OPENAI_API_KEY=your_openai_api_key_here
DISCORD_BOT_TOKEN=your_token_here
ALLOWED_CHANNELS=123456789012345678,987654321098765432
```

Notes:

- If `DISCORD_BOT_TOKEN` is missing, Discord execution is disabled, but the app still runs.
- `ALLOWED_CHANNELS` is optional. Leave it empty to allow all channels.
- `OPENAI_API_KEY` is required for `image_render` tasks.
- Image generation is executed via OpenAI Responses API (`gpt-5` + `image_generation` tool).

## Usage

### 1. Start the app

```bash
npm start
```

This starts the bridge server and serves the frontend.

### 2. Open in browser

Visit:

```text
http://localhost:3000
```

### 3. Quick API examples

Create a task:

```bash
curl -X POST http://localhost:3000/task \
  -H "Content-Type: application/json" \
  -d '{
    "type": "discord",
    "title": "Reply to support message",
    "action": "reply_to_message",
    "payload": {
      "channelId": "demo-channel",
      "messageId": "demo-message",
      "content": "Automated reply from Slothworld"
    }
  }'
```

Create an image render task:

```bash
curl -X POST http://localhost:3000/task \
  -H "Content-Type: application/json" \
  -d '{
    "type": "image_render",
    "title": "Generate Product Image",
    "payload": {
      "productId": "product-demo",
      "provider": "openai",
      "designIntent": {
        "product_name": "Demo Mug",
        "style": "clean ecommerce product illustration",
        "mood": "commercial",
        "colors": ["white", "blue"],
        "composition": "centered hero composition",
        "camera": "front-facing studio shot",
        "background": "minimal plain backdrop",
        "prompt": "ceramic mug with a minimal geometric print"
      }
    }
  }'
```

Test the OpenAI image route directly:

```bash
curl -X POST http://localhost:3000/render/openai/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Minimal ecommerce product shot of a ceramic mug","productId":"product-demo"}'
```

Persist an image payload to asset store (strict contract):

```bash
curl -X POST http://localhost:3000/asset-store/render \
  -H "Content-Type: application/json" \
  -d '{
    "assetId":"asset-demo",
    "productId":"product-demo",
    "provider":"openai",
    "prompt":"demo",
    "contentBase64":"<base64_png>",
    "extension":"png",
    "mimeType":"image/png",
    "metadata":{}
  }'
```

Fetch tasks:

```bash
curl http://localhost:3000/tasks
```

Poll events after ID 0:

```bash
curl "http://localhost:3000/events?after=0"
```

Health check:

```bash
curl http://localhost:3000/health
```

### 4. Task Creator and Runtime Panels

Use the in-app Task Creator panel to create tasks with structured payloads:

- Select task type (`discord`, `shopify`, or `image_render`)
- Enter task title/content
- Submit task directly through `window.controlAPI.injectTask(...)`

For image tasks:

- The generated file is written to `assets/generated/<productId>/` as PNG.
- The task result uses the local generated asset URL, not a Playground URL.

Use the Operator Control Panel to inspect:

- Pending/running/completed/failed task queues
- Agent assignment and state
- Workflow progress and history
- Live event stream

### 5. Command API (without in-game console UI)

The keyboard-driven in-canvas debug console has been removed. Command execution APIs remain available programmatically:

- `window.dispatchCommand('inject discord "Help with order #42"')`
- `window.dispatchCommand('spawn workflow product vintage mug')`
- `window.dispatchCommand('inspect agent 0')`
- `window.dispatchCommand('approve workflow workflow-id')`

## Tech Stack

- **JavaScript (ES6 modules)** – Modular frontend with clean separation between core, rendering, and UI layers
- **HTML5 Canvas** – Real-time pixel art rendering and simulation visualization
- **Node.js HTTP server** – Lightweight backend (no framework dependencies)
- **OpenAI Node SDK** – Responses API client for image generation (`gpt-5` + `image_generation`)
- **discord.js** – Optional Discord bot integration for task ingestion
- **dotenv** – Environment variable configuration
- **JSON persistence** – `bridge-store.json` for task and event storage

## Future Improvements

- Add automated tests for bridge endpoints and workflow state transitions
- Add a dedicated UI panel for workflow inspection and filtering
- Add task filtering/search and sorting in debug tools
- Add Docker support for one-command local startup
- Add HTTP authentication and rate limiting for public deployments
- Add persistence for agent role preferences and desk configurations
- Add real-time metrics panel (throughput, error rates, workflow SLAs)

## Recent Migration Summary

- Removed the old stub image providers and SVG placeholder renderer.
- Removed `provider_stub` image generation mode and the mock image fallback path.
- Standardized image generation on OpenAI Responses API (`gpt-5` + `image_generation`).
- Standardized persisted image assets on PNG with `image/png` MIME type.
- Standardized asset-store contract on PNG base64 via `contentBase64` only.
- Increased `/asset-store/render` request body limit to 25MB to support image payloads.
- `task.executionResult.imageUrl` now points to the bridge-managed generated asset URL.

## System Classification

- Event-driven job queue simulator
- Workflow execution engine
- Agent orchestration sandbox
- External integration control plane
