# Slothworld AI Office Simulation

Slothworld is a modular, event-driven browser simulation that visualizes agent behavior and task workflows. AI-controlled workers process queued tasks—drawn from Discord and Shopify—through a deterministic simulation engine. The system is structured as a reusable workflow platform for AI-assisted product automation, with clear separation of concerns: core simulation logic, rendering pipeline, and user interface.

## Features

- **Modular architecture**: Core simulation, rendering, and UI logic cleanly separated into independent modules.
- **Event-driven**: Decoupled event system (event stream, emissions) enables observability and extensibility without cross-module coupling.
- **Agent simulation**: Four AI agents with role-based skills (researcher, executor, other) that autonomously claim tasks, move, work, and retry.
- **Deterministic workflows**: Multi-step workflows with approval gates, retry logic, and context propagation for reliable AI automation.
- **Real-time canvas rendering**: Pixel art office with animated agents, desk queues, task progress bars, and workflow overlays.
- **Task bridge server**: HTTP endpoints for task ingestion, polling, execution, and acknowledgement. Persistent storage in `bridge-store.json`.
- **Optional Discord integration**: Listen for mentions and commands; ingest tasks via event polling.
- **Debug console**: In-game command interface for inspection, workflow control, and manual task injection.

## Project Structure

The codebase is organized into modular components by responsibility:

### Core (`core/`)
- **constants.js** – Global timings, thresholds, debug flags, sprite configurations
- **utils.js** – Pure utility functions (random generation, ID creation, serialization)
- **app-state.js** – Shared state initialization: canvas, agents, desks, workflows, event emitter
- **task-handling.js** – Task factories, execution, tool registry, bridge polling, retry logic
- **workflow.js** – Workflow lifecycle: creation, step queueing, approval/rejection, context propagation
- **agent-logic.js** – Agent simulation: state machine (sitting→working→idle), movement, task claiming

### Rendering (`rendering/`)
- **assets.js** – Asset loader and sprite path registry (lazy-loaded into memory)
- **overlays.js** – Visual effects: HUD, agent labels, workflow cards, task indicators, particles
- **canvas-renderer.js** – Render orchestration and canvas drawing primitive

### UI (`ui/`)
- **command-parser.js** – Pure command parsing (8+ commands: inject, spawn, inspect, approve, etc.)
- **debug-console.js** – In-game console state and rendering
- **control-api.js** – Control command handlers (agent inspection, movement, role assignment, workflow actions)
- **keyboard-input.js** – Keyboard binding and console input capture

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
DISCORD_BOT_TOKEN=your_token_here
ALLOWED_CHANNELS=123456789012345678,987654321098765432
```

Notes:

- If `DISCORD_BOT_TOKEN` is missing, Discord execution is disabled, but the app still runs.
- `ALLOWED_CHANNELS` is optional. Leave it empty to allow all channels.

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

### 4. In-simulation debug commands

Type in the on-screen debug console and press Enter:

- `inject discord "Help with order #42"`
- `inject shopify "Process order #42"`
- `spawn workflow product vintage mug`
- `inspect agent 0`
- `inspect desk 2`
- `approve workflow workflow-id`

## Tech Stack

- **JavaScript (ES6 modules)** – Modular frontend with clean separation between core, rendering, and UI layers
- **HTML5 Canvas** – Real-time pixel art rendering and simulation visualization
- **Node.js HTTP server** – Lightweight backend (no framework dependencies)
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
