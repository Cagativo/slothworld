/**
 * Bridge server entry point.
 *
 * All route and business logic has been extracted into focused modules under server/.
 * This file is intentionally a thin entry point that delegates to server/index.js.
 *
 * server/
 *   intake.js     — POST /task, GET /tasks, legacy disabled routes
 *   events.js     — GET /events
 *   metrics.js    — GET /health
 *   simulation.js — POST /task/:id/start, /execute, /ack
 *   index.js      — shared setup, HTTP server, mounts all route modules
 */

import { startServer } from './server/index.js';


startServer();
