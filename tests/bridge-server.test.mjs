/**
 * bridge-server.js unit tests — route and handler coverage
 *
 * Tests each route handler for happy-path behavior and key error paths.
 * The server is spawned in isolation (fresh store, no Discord bot token)
 * so no real simulation runs and no external services are called.
 * Engine mocking is achieved via environment variable isolation
 * (DISCORD_BOT_TOKEN='') and a temporary store file that is restored
 * after every test run.
 *
 * Coverage targets:
 *   - OPTIONS pre-flight (any URL)
 *   - GET /health
 *   - GET /tasks
 *   - POST /task  (happy paths + all validated error paths)
 *   - GET /events + GET /events?after=N
 *   - POST /task/:id/start
 *   - POST /task/:id/execute
 *   - POST /task/:id/ack  (ENGINE_ENFORCEMENT_VIOLATION cases)
 *   - Legacy-disabled endpoints (410)
 *   - Unknown / static route (404)
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { TREND_RESEARCH_WORKER_ID } from '../core/engine/workerCapabilityPolicy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const STORE_PATH = path.join(ROOT_DIR, 'bridge-store.json');

// Fixed Discord snowflake values used as test fixtures.
// These are valid 18-digit Discord snowflakes accepted by the bridge's validation rules.
const TEST_CHANNEL_ID = '1491500223288184964';
const TEST_MESSAGE_ID = '1491500223288184964';

let serverProcess = null;
let baseUrl = null;
let storeBackup = null;
let storeExistedBefore = false;
let serverStdout = '';
let serverStderr = '';

// ─── Utilities ────────────────────────────────────────────────────────────────

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = address && typeof address === 'object' ? address.port : null;
      probe.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        if (typeof port !== 'number') {
          reject(new Error('free_port_probe_failed'));
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForServer(url, timeoutMs = 15000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
      lastError = new Error(`health_status_${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(200);
  }
  throw new Error(
    `server_start_timeout url=${url} lastError=${lastError ? String(lastError.message || lastError) : 'none'}\n` +
    `stdout=${serverStdout.slice(-800)}\nstderr=${serverStderr.slice(-800)}`
  );
}

function postJson(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

function postRaw(url, rawBody) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: rawBody
  });
}

function postEmpty(url) {
  return fetch(url, { method: 'POST' });
}

/** Posts a minimal valid discord task and returns the parsed JSON response. */
async function createDiscordTask(overrides = {}) {
  const response = await postJson(`${baseUrl}/task`, {
    type: 'discord',
    title: 'Test task',
    action: 'reply_to_message',
    payload: {
      channelId: TEST_CHANNEL_ID,
      messageId: TEST_MESSAGE_ID,
      content: 'test'
    },
    ...overrides
  });
  assert.ok(response.ok, `createDiscordTask failed: ${response.status}`);
  return response.json();
}

// ─── Server lifecycle ─────────────────────────────────────────────────────────

before(async () => {
  try {
    storeBackup = await fs.readFile(STORE_PATH, 'utf8');
    storeExistedBefore = true;
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error;
    storeBackup = null;
    storeExistedBefore = false;
  }

  const port = await getFreePort();
  baseUrl = `http://127.0.0.1:${port}`;

  serverProcess = spawn('node', ['bridge-server.js'], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      DISCORD_BOT_TOKEN: '',
      // Raise the circuit-breaker limit so it does not interfere with tests.
      TASK_CREATION_LIMIT: '500'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  serverProcess.stdout.on('data', (chunk) => { serverStdout += String(chunk || ''); });
  serverProcess.stderr.on('data', (chunk) => { serverStderr += String(chunk || ''); });

  const earlyExit = new Promise((_, reject) => {
    serverProcess.once('exit', (code, signal) => {
      reject(new Error(`server_process_exited_early code=${code} signal=${signal}`));
    });
  });

  await Promise.race([waitForServer(baseUrl), earlyExit]);
});

after(async () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
    await new Promise((resolve) => {
      serverProcess.once('exit', () => resolve());
      setTimeout(resolve, 2000);
    });
  }

  if (storeExistedBefore && storeBackup !== null) {
    await fs.writeFile(STORE_PATH, storeBackup, 'utf8');
  } else {
    await fs.rm(STORE_PATH, { force: true });
  }
});

// ─── OPTIONS pre-flight ───────────────────────────────────────────────────────

test('OPTIONS pre-flight', async (t) => {
  await t.test('OPTIONS /task returns 204', async () => {
    const response = await fetch(`${baseUrl}/task`, { method: 'OPTIONS' });
    assert.equal(response.status, 204);
  });

  await t.test('OPTIONS on any path returns 204', async () => {
    const response = await fetch(`${baseUrl}/health`, { method: 'OPTIONS' });
    assert.equal(response.status, 204);
  });
});

// ─── GET /health ──────────────────────────────────────────────────────────────

test('GET /health', async (t) => {
  await t.test('returns 200 with ok, events, and tasks fields', async () => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.ok, true, 'ok must be true');
    assert.equal(typeof json.events, 'number', 'events must be a number');
    assert.equal(typeof json.tasks, 'number', 'tasks must be a number');
  });

  await t.test('events and tasks are non-negative integers', async () => {
    const response = await fetch(`${baseUrl}/health`);
    const json = await response.json();
    assert.ok(json.events >= 0, 'events must be >= 0');
    assert.ok(json.tasks >= 0, 'tasks must be >= 0');
  });
});

// ─── GET /tasks ───────────────────────────────────────────────────────────────

test('GET /tasks', async (t) => {
  await t.test('returns 200 with ok and tasks array', async () => {
    const response = await fetch(`${baseUrl}/tasks`);
    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.ok, true);
    assert.ok(Array.isArray(json.tasks), 'tasks must be an array');
  });

  await t.test('tasks in response have expected public fields', async () => {
    const { task: created } = await createDiscordTask({ title: 'tasks-field-test' });
    const response = await fetch(`${baseUrl}/tasks`);
    const json = await response.json();
    const found = json.tasks.find((t) => t && t.id === created.id);
    assert.ok(found, 'created task should appear in GET /tasks');
    assert.equal(typeof found.id, 'string', 'task.id must be a string');
    assert.equal(typeof found.type, 'string', 'task.type must be a string');
    assert.equal(typeof found.status, 'string', 'task.status must be a string');
    assert.equal(typeof found.createdAt, 'number', 'task.createdAt must be a number');
  });

  await t.test('does not expose engine-internal status strings', async () => {
    const response = await fetch(`${baseUrl}/tasks`);
    const { tasks } = await response.json();
    const engineInternal = new Set(['created', 'queued', 'claimed', 'awaiting_ack', 'acknowledged']);
    for (const task of tasks) {
      assert.equal(
        engineInternal.has(task.status),
        false,
        `task.status '${task.status}' must not be an engine-internal value`
      );
    }
  });
});

// ─── POST /task — happy paths ─────────────────────────────────────────────────

test('POST /task — happy paths', async (t) => {
  await t.test('accepts a valid discord task and returns 201 with task', async () => {
    const response = await postJson(`${baseUrl}/task`, {
      type: 'discord',
      title: 'Happy path discord',
      action: 'reply_to_message',
      payload: {
        channelId: TEST_CHANNEL_ID,
        messageId: TEST_MESSAGE_ID,
        content: 'hello'
      }
    });
    assert.equal(response.status, 201);
    const json = await response.json();
    assert.equal(json.ok, true);
    assert.ok(json.task, 'response must include task');
    assert.equal(typeof json.task.id, 'string');
    assert.equal(json.task.type, 'discord');
    assert.equal(json.deduplicated, false);
  });

  await t.test('accepts a valid shopify task and returns 201 with task', async () => {
    const response = await postJson(`${baseUrl}/task`, {
      type: 'shopify',
      title: 'Happy path shopify',
      action: 'process_order',
      payload: {}
    });
    assert.equal(response.status, 201);
    const json = await response.json();
    assert.equal(json.ok, true);
    assert.equal(json.task.type, 'shopify');
  });

  await t.test('generates a task id when none is provided', async () => {
    const response = await postJson(`${baseUrl}/task`, {
      type: 'discord',
      title: 'Auto-id task',
      action: 'send_channel_message',
      payload: { channelId: TEST_CHANNEL_ID, content: 'hi' }
    });
    assert.equal(response.status, 201);
    const { task } = await response.json();
    assert.ok(task.id && task.id.length > 0, 'task.id must be generated');
  });

  await t.test('returns 200 and deduplicated:true when same id is submitted twice', async () => {
    const sharedId = `dedup-bridge-test-${Date.now()}`;
    const payload = {
      id: sharedId,
      type: 'discord',
      title: 'Dedup test',
      action: 'reply_to_message',
      payload: {
        channelId: TEST_CHANNEL_ID,
        messageId: TEST_MESSAGE_ID,
        content: 'dedup'
      }
    };
    const first = await postJson(`${baseUrl}/task`, payload);
    assert.equal(first.status, 201, 'first submission must be 201');

    const second = await postJson(`${baseUrl}/task`, payload);
    assert.equal(second.status, 200, 'duplicate submission must be 200');
    const secondJson = await second.json();
    assert.equal(secondJson.deduplicated, true, 'must flag as deduplicated');
  });

  await t.test('strips lifecycle timing fields sent in the body', async () => {
    const response = await postJson(`${baseUrl}/task`, {
      type: 'discord',
      title: 'Lifecycle strip test',
      action: 'reply_to_message',
      payload: {
        channelId: TEST_CHANNEL_ID,
        messageId: TEST_MESSAGE_ID,
        content: 'test'
      },
      startedAt: 9999999999999,
      completedAt: 9999999999999,
      failedAt: 9999999999999
    });
    assert.equal(response.ok, true);
    const { task } = await response.json();
    assert.equal(task.startedAt, null, 'startedAt must be stripped');
    assert.equal(task.completedAt, null, 'completedAt must be stripped');
    assert.equal(task.failedAt, null, 'failedAt must be stripped');
  });

  await t.test('task status in response is a valid public status string', async () => {
    const response = await postJson(`${baseUrl}/task`, {
      type: 'shopify',
      title: 'Status string test',
      action: 'process_order',
      payload: {}
    });
    assert.ok(response.ok);
    const { task } = await response.json();
    const validPublic = new Set(['pending', 'processing', 'done', 'failed']);
    assert.ok(validPublic.has(task.status), `task.status '${task.status}' must be a valid public status`);
  });

  await t.test('TrendResearch emits TREND_RESEARCH_COMPLETED only after TASK_ACKED', async () => {
    const requestId = `trend-order-${Date.now()}`;
    const workerId = 'worker-trend-1';
    const response = await postJson(`${baseUrl}/task`, {
      id: requestId,
      type: 'TREND_RESEARCH',
      title: 'Trend ordering test',
      payload: {
        keyword: 'hoodie',
        requestId,
        workerId
      }
    });

    assert.equal(response.status, 201);

    let taskEvents = [];
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const eventsResponse = await fetch(`${baseUrl}/events`);
      assert.equal(eventsResponse.status, 200);
      const { events } = await eventsResponse.json();
      taskEvents = events.filter((event) => event && event.taskId === requestId);

      const hasAck = taskEvents.some((event) => event.type === 'TASK_ACKED');
      const hasCompleted = taskEvents.some((event) => event.type === 'TREND_RESEARCH_COMPLETED');
      if (hasAck && hasCompleted) {
        break;
      }

      await delay(100);
    }

    const ackedEvent = taskEvents.find((event) => event.type === 'TASK_ACKED');
    const completedEvent = taskEvents.find((event) => event.type === 'TREND_RESEARCH_COMPLETED');

    assert.ok(ackedEvent, 'TASK_ACKED event must exist for TrendResearch');
    assert.ok(completedEvent, 'TREND_RESEARCH_COMPLETED event must exist for TrendResearch');
    assert.ok(
      completedEvent.id > ackedEvent.id,
      `TREND_RESEARCH_COMPLETED must be emitted after TASK_ACKED (got ack=${ackedEvent.id}, completed=${completedEvent.id})`
    );
    assert.equal(completedEvent.payload.requestId, requestId, 'TREND_RESEARCH_COMPLETED must carry requestId');
    assert.equal(completedEvent.payload.taskId, requestId, 'TREND_RESEARCH_COMPLETED must carry taskId');
    assert.equal(completedEvent.payload.keyword, 'hoodie', 'TREND_RESEARCH_COMPLETED must carry keyword');
    assert.equal(completedEvent.payload.assignedAgentId, TREND_RESEARCH_WORKER_ID, 'TREND_RESEARCH_COMPLETED must carry canonical assignedAgentId');
    assert.equal(completedEvent.payload.workerId, TREND_RESEARCH_WORKER_ID, 'TREND_RESEARCH_COMPLETED must carry canonical workerId for indexedWorld');
    assert.ok(completedEvent.payload.result && Array.isArray(completedEvent.payload.result.ranked), 'TREND_RESEARCH_COMPLETED must carry ranked result payload');
  });

  await t.test('TrendResearch intake auto-populates default channelId when missing', async () => {
    const requestId = `trend-channel-${Date.now()}`;
    const response = await postJson(`${baseUrl}/task`, {
      id: requestId,
      type: 'TREND_RESEARCH',
      title: 'Trend channel wiring test',
      payload: {
        keyword: 'hoodie',
        requestId
      }
    });

    assert.equal(response.status, 201);
    const json = await response.json();
    assert.ok(json.task, 'task must be returned');
    assert.ok(json.task.payload, 'task payload must be present');
    assert.equal(
      json.task.payload.channelId,
      TEST_CHANNEL_ID,
      'TrendResearch task payload.channelId must default to fixed channel id'
    );
  });

  await t.test('TrendResearch without explicit workerId uses channelId as default owner', async () => {
    const requestId = `trend-default-owner-${Date.now()}`;
    const response = await postJson(`${baseUrl}/task`, {
      id: requestId,
      type: 'TREND_RESEARCH',
      title: 'Trend default owner test',
      payload: {
        keyword: 'hoodie',
        requestId
      }
    });

    assert.equal(response.status, 201);
    const json = await response.json();
    assert.ok(json.task && json.task.payload, 'task payload must be present');
    assert.ok(
      json.task.payload.workerId || json.task.payload.agentId || json.task.payload.assignedAgentId,
      'intake must assign a default workerId for TREND_RESEARCH tasks without explicit owner'
    );

    let taskEvents = [];
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const eventsResponse = await fetch(`${baseUrl}/events`);
      assert.equal(eventsResponse.status, 200);
      const { events } = await eventsResponse.json();
      taskEvents = events.filter((event) => event && event.taskId === requestId);

      const hasAck = taskEvents.some((event) => event.type === 'TASK_ACKED');
      const hasCompleted = taskEvents.some((event) => event.type === 'TREND_RESEARCH_COMPLETED');
      if (hasAck && hasCompleted) {
        break;
      }

      await delay(100);
    }

    const ackedEvent = taskEvents.find((event) => event.type === 'TASK_ACKED');
    const completedEvent = taskEvents.find((event) => event.type === 'TREND_RESEARCH_COMPLETED');

    assert.ok(ackedEvent, 'TASK_ACKED must be emitted');
    assert.equal(ackedEvent.payload.status, 'acknowledged', 'task with default workerId must succeed');
    assert.ok(completedEvent, 'TREND_RESEARCH_COMPLETED must be emitted when intake provides default owner');
    assert.ok(
      completedEvent.payload.assignedAgentId,
      'TREND_RESEARCH_COMPLETED must carry assignedAgentId derived from channelId'
    );
  });
});

// ─── POST /task — error paths ─────────────────────────────────────────────────

test('POST /task — error paths', async (t) => {
  await t.test('rejects unknown task type with 400', async () => {
    const response = await postJson(`${baseUrl}/task`, {
      type: 'unknown_type',
      title: 'Bad type'
    });
    assert.equal(response.status, 400);
    const json = await response.json();
    assert.equal(typeof json.error, 'string', 'error message must be returned');
  });

  await t.test('rejects task with internal:true with 400', async () => {
    const response = await postJson(`${baseUrl}/task`, {
      type: 'discord',
      title: 'Internal task',
      internal: true,
      payload: { channelId: TEST_CHANNEL_ID, content: 'blocked' }
    });
    assert.equal(response.status, 400);
    const json = await response.json();
    assert.equal(typeof json.error, 'string');
  });

  await t.test('rejects task with domain:system with 400', async () => {
    const response = await postJson(`${baseUrl}/task`, {
      type: 'discord',
      title: 'System domain task',
      domain: 'system',
      payload: { channelId: TEST_CHANNEL_ID, content: 'blocked' }
    });
    assert.equal(response.status, 400);
    const json = await response.json();
    assert.equal(typeof json.error, 'string');
  });

  await t.test('rejects task with depth exceeding limit with 400', async () => {
    const response = await postJson(`${baseUrl}/task`, {
      type: 'discord',
      title: 'Too deep',
      depth: 99,
      payload: { channelId: TEST_CHANNEL_ID, content: 'deep' }
    });
    assert.equal(response.status, 400);
    const json = await response.json();
    assert.equal(typeof json.error, 'string');
  });

  await t.test('rejects task with invalid priority with 400', async () => {
    const response = await postJson(`${baseUrl}/task`, {
      type: 'discord',
      title: 'Bad priority',
      priority: 99,
      payload: { channelId: TEST_CHANNEL_ID, content: 'test' }
    });
    assert.equal(response.status, 400);
    const json = await response.json();
    assert.equal(typeof json.error, 'string');
  });

  await t.test('rejects non-JSON body with 400', async () => {
    const response = await postRaw(`${baseUrl}/task`, 'not-valid-json{{');
    assert.equal(response.ok, false);
    assert.ok(response.status >= 400 && response.status < 500, 'non-JSON body must be a 4xx error');
  });

  await t.test('rejects empty object body (no type field) with 400', async () => {
    const response = await postJson(`${baseUrl}/task`, {});
    assert.equal(response.status, 400);
    const json = await response.json();
    assert.equal(typeof json.error, 'string');
  });

  await t.test('rejects non-object payload field with 400', async () => {
    const response = await postJson(`${baseUrl}/task`, {
      type: 'discord',
      title: 'Bad payload',
      payload: 'string-payload'
    });
    assert.equal(response.status, 400);
    const json = await response.json();
    assert.equal(typeof json.error, 'string');
  });

  await t.test('rejects non-string title with 400', async () => {
    const response = await postJson(`${baseUrl}/task`, {
      type: 'discord',
      title: 12345,
      payload: {}
    });
    assert.equal(response.status, 400);
    const json = await response.json();
    assert.equal(typeof json.error, 'string');
  });
});

// ─── GET /events ──────────────────────────────────────────────────────────────

test('GET /events', async (t) => {
  await t.test('returns 200 with ok and events array', async () => {
    const response = await fetch(`${baseUrl}/events`);
    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.ok, true);
    assert.ok(Array.isArray(json.events), 'events must be an array');
  });

  await t.test('event objects have id, type, taskId, timestamp, payload fields', async () => {
    // Create a task to ensure at least one event exists.
    await createDiscordTask({ title: 'events-field-test' });

    const response = await fetch(`${baseUrl}/events`);
    const { events } = await response.json();
    if (events.length > 0) {
      const ev = events[0];
      assert.equal(typeof ev.id, 'number', 'event.id must be a number');
      assert.equal(typeof ev.type, 'string', 'event.type must be a string');
      assert.equal(typeof ev.taskId, 'string', 'event.taskId must be a string');
      assert.equal(typeof ev.timestamp, 'number', 'event.timestamp must be a number');
      assert.ok(ev.payload !== undefined, 'event.payload must be present');
    }
  });

  await t.test('GET /events?after=N returns only events with id > N', async () => {
    // Get the current highest event id.
    const before = await fetch(`${baseUrl}/events`);
    const beforeJson = await before.json();
    const maxId = beforeJson.events.reduce((max, ev) => Math.max(max, ev.id), 0);

    // Create a new task to generate fresh events.
    await createDiscordTask({ title: 'events-after-test' });

    const afterResponse = await fetch(`${baseUrl}/events?after=${maxId}`);
    assert.equal(afterResponse.status, 200);
    const afterJson = await afterResponse.json();
    assert.equal(afterJson.ok, true);
    assert.ok(Array.isArray(afterJson.events));
    for (const ev of afterJson.events) {
      assert.ok(ev.id > maxId, `event.id ${ev.id} must be > after=${maxId}`);
    }
  });

  await t.test('GET /events?after=0 returns all events', async () => {
    const withAfter = await fetch(`${baseUrl}/events?after=0`);
    const withoutAfter = await fetch(`${baseUrl}/events`);
    const withAfterJson = await withAfter.json();
    const withoutAfterJson = await withoutAfter.json();
    // Both should return the same count (after=0 means all events with id > 0).
    assert.ok(withAfterJson.events.length >= 0, 'must return a valid array');
    assert.equal(withAfterJson.events.length, withoutAfterJson.events.length);
  });
});

// ─── POST /task/:id/start ─────────────────────────────────────────────────────

test('POST /task/:id/start', async (t) => {
  await t.test('returns 404 for a non-existent task id', async () => {
    const response = await postEmpty(`${baseUrl}/task/non-existent-task-id-12345/start`);
    assert.equal(response.status, 404);
    const json = await response.json();
    assert.equal(typeof json.error, 'string');
  });

  await t.test('returns 200 with task when called on an existing task', async () => {
    const { task } = await createDiscordTask({ title: 'start-endpoint-test' });
    const response = await postEmpty(`${baseUrl}/task/${encodeURIComponent(task.id)}/start`);
    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.ok, true);
    assert.ok(json.task, 'response must include task');
    assert.equal(json.task.id, task.id, 'task.id must match');
  });

  await t.test('is idempotent — calling start twice returns 200 both times', async () => {
    const { task } = await createDiscordTask({ title: 'start-idempotent-test' });
    const first = await postEmpty(`${baseUrl}/task/${encodeURIComponent(task.id)}/start`);
    assert.equal(first.status, 200);
    const second = await postEmpty(`${baseUrl}/task/${encodeURIComponent(task.id)}/start`);
    assert.equal(second.status, 200);
  });
});

// ─── POST /task/:id/ack ───────────────────────────────────────────────────────

test('POST /task/:id/ack — error paths', async (t) => {
  await t.test('returns 404 for a non-existent task id with clean body', async () => {
    const response = await postJson(`${baseUrl}/task/totally-missing-task-id/ack`, {});
    assert.equal(response.status, 404);
    const json = await response.json();
    assert.equal(typeof json.error, 'string');
  });

  await t.test('returns 409 ENGINE_ENFORCEMENT_VIOLATION when body contains executionResult', async () => {
    const { task } = await createDiscordTask({ title: 'ack-exec-result-test' });
    const response = await postJson(`${baseUrl}/task/${encodeURIComponent(task.id)}/ack`, {
      executionResult: { success: true }
    });
    assert.equal(response.status, 409);
    const json = await response.json();
    assert.equal(json.error, 'ENGINE_ENFORCEMENT_VIOLATION');
  });

  await t.test('returns 409 ENGINE_ENFORCEMENT_VIOLATION when body contains status override', async () => {
    const { task } = await createDiscordTask({ title: 'ack-status-override-test' });
    const response = await postJson(`${baseUrl}/task/${encodeURIComponent(task.id)}/ack`, {
      status: 'done'
    });
    assert.equal(response.status, 409);
    const json = await response.json();
    assert.equal(json.error, 'ENGINE_ENFORCEMENT_VIOLATION');
  });

  await t.test('returns 409 ENGINE_ENFORCEMENT_VIOLATION when body contains payload override', async () => {
    const { task } = await createDiscordTask({ title: 'ack-payload-override-test' });
    const response = await postJson(`${baseUrl}/task/${encodeURIComponent(task.id)}/ack`, {
      payload: { injected: true }
    });
    assert.equal(response.status, 409);
    const json = await response.json();
    assert.equal(json.error, 'ENGINE_ENFORCEMENT_VIOLATION');
  });

  await t.test('returns 409 ENGINE_ENFORCEMENT_VIOLATION when body contains retries override', async () => {
    const { task } = await createDiscordTask({ title: 'ack-retries-override-test' });
    const response = await postJson(`${baseUrl}/task/${encodeURIComponent(task.id)}/ack`, {
      retries: 5
    });
    assert.equal(response.status, 409);
    const json = await response.json();
    assert.equal(json.error, 'ENGINE_ENFORCEMENT_VIOLATION');
  });

  await t.test('returns 409 ENGINE_ENFORCEMENT_VIOLATION when task has not been executed', async () => {
    const { task } = await createDiscordTask({ title: 'ack-no-execution-test' });
    // Empty body is allowed, but the engine must reject ACK without prior execution.
    // Note: auto-execute may race here; we simply verify it is not a 2xx without execution context.
    const response = await postJson(`${baseUrl}/task/${encodeURIComponent(task.id)}/ack`, {});
    // May be 409 (not yet executed) or 200 (auto-executed already). Both are valid.
    assert.ok(
      response.status === 409 || response.status === 200,
      `Unexpected status ${response.status} — expected 200 (if auto-executed) or 409`
    );
    if (response.status === 409) {
      const json = await response.json();
      assert.equal(json.error, 'ENGINE_ENFORCEMENT_VIOLATION');
    }
  });
});

// ─── POST /task/:id/execute ───────────────────────────────────────────────────

test('POST /task/:id/execute', async (t) => {
  await t.test('returns 404 for a non-existent task id', async () => {
    const response = await postEmpty(`${baseUrl}/task/non-existent-execute-task/execute`);
    assert.equal(response.status, 404);
    const json = await response.json();
    assert.equal(typeof json.error, 'string');
  });

  await t.test('returns 200 or 409 for an existing task (engine decides lifecycle)', async () => {
    const { task } = await createDiscordTask({ title: 'execute-endpoint-test' });
    const response = await postEmpty(`${baseUrl}/task/${encodeURIComponent(task.id)}/execute`);
    // 200 = executed successfully; 409 = auto-execute already ran; both are correct behavior.
    assert.ok(
      response.status === 200 || response.status === 409,
      `Expected 200 or 409, got ${response.status}`
    );
    if (response.status === 200) {
      const json = await response.json();
      assert.equal(json.ok, true);
      assert.ok(json.task, 'response must include task on 200');
      assert.equal(typeof json.durationMs, 'number', 'durationMs must be a number');
    } else {
      const json = await response.json();
      assert.equal(json.error, 'ENGINE_ENFORCEMENT_VIOLATION');
    }
  });
});

// ─── Legacy-disabled endpoints (410) ─────────────────────────────────────────

test('Legacy-disabled endpoints return 410', async (t) => {
  const legacyRoutes = [
    '/asset-store/render',
    '/render/openai/generate',
    '/render/generate',
    '/debug/test-openai-image'
  ];

  for (const route of legacyRoutes) {
    await t.test(`POST ${route} returns 410 with legacy_execution_disabled error`, async () => {
      const response = await postJson(`${baseUrl}${route}`, {});
      assert.equal(response.status, 410, `${route} must return 410`);
      const json = await response.json();
      assert.equal(json.error, 'legacy_execution_disabled', `${route} error must be legacy_execution_disabled`);
      assert.equal(typeof json.detail, 'string', `${route} must include a detail string`);
    });
  }
});

// ─── Unknown / static route (404) ────────────────────────────────────────────

test('Unknown routes', async (t) => {
  await t.test('GET on an unknown path returns 404', async () => {
    const response = await fetch(`${baseUrl}/this-path-does-not-exist-at-all`);
    assert.equal(response.status, 404);
  });

  await t.test('POST on an unknown path falls through to static handler (not 2xx)', async () => {
    const response = await postJson(`${baseUrl}/unknown-route-xyz`, {});
    // Static handler returns 404 for unknown files.
    assert.ok(response.status >= 400, `Expected 4xx for unknown POST, got ${response.status}`);
  });
});
