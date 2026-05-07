# Canvas Interaction Contract

This contract defines how the Slothworld canvas chooses interaction targets, renders popovers, and boots the baked background. It is intended to keep normal mode friendly and user-facing while preserving diagnostics in debug and calibration modes.

## Mode Split

Normal mode is the user-facing projection. It must only expose selector-safe, friendly view models and broad workstation affordances.

Debug and calibration modes may expose diagnostics, raw ids, bounds, zones, priorities, and render-path traces so layout and hit testing can be inspected.

## Interaction Priority

Normal mode target priority:

1. `taskResult`
2. `taskMarker`
3. `station`
4. background

Debug and calibration target priority:

1. `taskResult`
2. `taskMarker`
3. `agent`
4. `station`
5. world/debug zones

Task result targets must beat station hotspots. Task marker targets must beat station hotspots. Station hotspots are broad, forgiving fallback targets when no higher-priority task target is hit.

## Target Types

Allowed normal-mode target types:

- `taskResult`
- `taskMarker`
- `station`
- `agent`, only when the agent component is explicitly marked `normalInteractive: true` and carries a friendly `agentInspectionViewModel`

Debug-only target types:

- default `agent` targets
- `world-zone-indicator`
- raw zone/debug bounds

World zones are never normal-mode popover targets.

## Normal Popovers

Allowed normal popover fields:

- friendly title
- short status label
- friendly station summary lines
- friendly task result lines
- friendly task marker lines
- friendly agent lines from `agentInspectionViewModel` only
- anomaly indication as user-facing attention state

Banned normal popover fields and text:

- `type:`
- `target:`
- `priority:`
- `zone:`
- `bounds:`
- `world-zone`
- raw `sloth-` ids
- `engineCrystal`
- `TASK_`
- `AGENT_`
- raw event names
- camelCase internals
- raw target metadata
- raw geometry or hit-test bounds

Debug mode may show these diagnostics.

## Station And Agent Responsibility

Stations own normal-mode workstation interaction. Hotspots should be broad and forgiving so users can inspect desks, monitors, shelves, and work areas without needing pixel-perfect target geometry.

Agents are debug-only in normal mode unless explicitly marked `normalInteractive: true` and supplied with a friendly `agentInspectionViewModel`. Default agent sprites must not steal station hover or click in normal mode.

## Task Results

Task result access is explicit and high priority. A task result target must win over overlapping station hotspots, and its normal popover must come from a friendly task result view model. Task marker targets follow the same rule and beat stations.

## Baked Background Boot Policy

The background boot policy has three states:

- `baked-ready`: a baked background asset is loaded and should be drawn.
- `baked-pending`: normal mode is waiting for the baked background; draw only the neutral boot background.
- `fallback-allowed`: debug, calibration, or explicit opt-in mode may draw the legacy procedural fallback.

During baked-pending normal boot:

- do not call `renderTreehouseBackdrop()`
- do not call semantic prop composition from `renderWorldCompositionLayer()`
- do not draw task result/trend overlays over the blank boot background
- do not flash the legacy procedural scene

The procedural fallback remains available for debug and calibration.

## Calibration And Export

Calibration mode may expose diagnostic overlays, station bounds, handles, ids, and export tooling. Calibration data must remain projection data: it describes UI hit areas and anchors, not TaskEngine lifecycle state. Exported hotspot geometry should be treated as canvas interaction calibration, not engine data.

## Flags

Render boot tracing is gated and off by default:

```js
window.__SLOTHWORLD_TRACE_RENDER_BOOT__ = true
localStorage.setItem('slothworld.traceRenderBoot', '1')
```

Procedural fallback rendering is gated during baked-pending normal boot. It may be explicitly enabled with:

```js
window.__SLOTHWORLD_ALLOW_PROCEDURAL_FALLBACK__ = true
localStorage.setItem('slothworld.allowProceduralFallback', '1')
```

Debug mode may also enable procedural fallback and diagnostic interaction behavior.
