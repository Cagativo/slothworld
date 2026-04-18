/**
 * Bridge Intake Contract Tests
 *
 * Verifies the Bridge's "intake only" invariant:
 * - Bridge normalizes and persists tasks; it NEVER sets lifecycle status directly.
 * - Task status visible in the API is always engine-derived.
 * - Bridge delegates lifecycle progression exclusively to TaskEngine.
 * - Invalid or guarded intake paths return the correct HTTP status codes.
 * - ENGINE_ENFORCEMENT_VIOLATION is surfaced as 409 (not 400) on relevant endpoints.
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const STORE_PATH = path.join(ROOT_DIR, 'bridge-store.json');

let serverProcess = null;
let baseUrl = null;
let storeBackup = null;
let storeExistedBefore = false;
let serverStdout = '';
let serverStderr = '';

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
  throw new Error(`server_start_timeout url=${url} lastError=${lastError ? String(lastError.message || lastError) : 'none'}\nstdout=${serverStdout.slice(-800)}\nstderr=${serverStderr.slice(-800)}`);
}

async function postTask(payload) {
  return fetch(`${baseUrl}/task`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

async function getTasks() {
  const response = await fetch(`${baseUrl}/tasks`);
  assert.ok(response.ok, 'GET /tasks should succeed');
  const json = await response.json();
  return Array.isArray(json.tasks) ? json.tasks : [];
}

async function ackTask(taskId, body = {}) {
  return fetch(`${baseUrl}/task/${encodeURIComponent(taskId)}/ack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

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
      DISCORD_BOT_TOKEN: ''
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

// ─── Intake normalization contract ────────────────────────────────────────────

test('Intake normalization', async (t) => {
  await t.test('POST /task returns a task with expected normalized fields', async () => {
    const response = await postTask({
      type: 'discord',
      title: 'Normalization test',
      action: 'reply_to_message',
      payload: {
        channelId: '1491500223288184964',
        messageId: '1491500223288184964',
        content: 'test'
      }
    });

    assert.equal(response.ok, true, `POST /task should succeed, got ${response.status}`);
    const json = await response.json();
    assert.ok(json.task, 'response should include task');
    const task = json.task;

    assert.equal(typeof task.id, 'string', 'task.id must be a string');
    assert.equal(task.type, 'discord', 'task.type should be normalized');
    assert.equal(task.title, 'Normalization test', 'task.title should be preserved');
    assert.equal(task.action, 'reply_to_message', 'task.action should be normalized');
    assert.equal(typeof task.priority, 'number', 'task.priority must be a number');
    assert.equal(typeof task.createdAt, 'number', 'task.createdAt must be a timestamp');
    assert.equal(task.domain, 'external', 'task.domain must be external for non-internal tasks');
    assert.equal(task.internal, false, 'task.internal must be false for external tasks');
    assert.ok(typeof task.required === 'number' && task.required > 0, 'task.required must be positive');
  });

  await t.test('POST /task assigns a generated id if none provided', async () => {
    const response = await postTask({
      type: 'discord',
      title: 'Generated ID test',
      action: 'send_channel_message',
      payload: {
        channelId: '1491500223288184964',
        content: 'test'
      }
    });

    assert.equal(response.ok, true);
    const json = await response.json();
    assert.ok(json.task && typeof json.task.id === 'string' && json.task.id.length > 0, 'id should be generated');
  });

  await t.test('POST /task returns 201 for new tasks and 200 for deduplicates', async () => {
    const sharedId = `dedup-test-${Date.now()}`;
    const taskPayload = {
      id: sharedId,
      type: 'discord',
      title: 'Dedup test',
      action: 'reply_to_message',
      payload: {
        channelId: '1491500223288184964',
        messageId: '1491500223288184964',
        content: 'dedup'
      }
    };

    const first = await postTask(taskPayload);
    assert.equal(first.status, 201, 'first submission should return 201');

    const second = await postTask(taskPayload);
    assert.equal(second.status, 200, 'duplicate submission should return 200');
    const secondJson = await second.json();
    assert.equal(secondJson.deduplicated, true, 'response should flag deduplication');
  });
});

// ─── Intake guard contract ────────────────────────────────────────────────────

test('Intake guards', async (t) => {
  await t.test('POST /task blocks internal/system tasks via HTTP', async () => {
    const response = await postTask({
      type: 'discord',
      title: 'internal task',
      internal: true,
      payload: { channelId: '1491500223288184964', content: 'blocked' }
    });

    assert.equal(response.ok, false);
    assert.equal(response.status, 400, 'internal tasks must be rejected with 400');
  });

  await t.test('POST /task blocks tasks with system domain via HTTP', async () => {
    const response = await postTask({
      type: 'discord',
      title: 'system domain task',
      domain: 'system',
      payload: { channelId: '1491500223288184964', content: 'blocked' }
    });

    assert.equal(response.ok, false);
    assert.equal(response.status, 400, 'system-domain tasks must be rejected with 400');
  });

  await t.test('POST /task rejects invalid type', async () => {
    const response = await postTask({
      type: 'unknown_type',
      title: 'bad type task'
    });

    assert.equal(response.ok, false);
    assert.equal(response.status, 400);
    const json = await response.json();
    assert.ok(typeof json.error === 'string', 'error message should be returned');
  });

  await t.test('POST /task rejects task with depth exceeding limit', async () => {
    const response = await postTask({
      type: 'discord',
      title: 'deep task',
      depth: 99,
      payload: { channelId: '1491500223288184964', content: 'too deep' }
    });

    assert.equal(response.ok, false);
    assert.equal(response.status, 400, 'tasks exceeding depth limit must be rejected');
  });

  await t.test('POST /task rejects non-JSON body gracefully', async () => {
    const response = await fetch(`${baseUrl}/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json'
    });

    assert.equal(response.ok, false, 'invalid JSON body should be rejected');
  });
});

// ─── Bridge status invariant ──────────────────────────────────────────────────

test('Bridge status invariant', async (t) => {
  await t.test('task status in GET /tasks is always engine-derived, not a raw Bridge store field', async () => {
    const response = await postTask({
      type: 'discord',
      title: 'status-invariant-test',
      action: 'reply_to_message',
      payload: {
        channelId: '1491500223288184964',
        messageId: '1491500223288184964',
        content: 'test'
      }
    });

    assert.equal(response.ok, true);
    const { task: createdTask } = await response.json();
    assert.ok(createdTask, 'task must be returned');

    const tasks = await getTasks();
    const task = tasks.find((t) => t && t.id === createdTask.id);
    assert.ok(task, 'task should appear in GET /tasks');

    // Bridge cannot store a raw 'status' field that bypasses the engine.
    // The only valid statuses come from mapEngineStatusToPublic():
    // pending | processing | done | failed
    const validPublicStatuses = new Set(['pending', 'processing', 'done', 'failed']);
    assert.ok(
      validPublicStatuses.has(task.status),
      `task.status '${task.status}' must be an engine-mapped public status`
    );
  });

  await t.test('task status field is always a string in API response', async () => {
    const response = await postTask({
      type: 'shopify',
      title: 'status-string-test',
      action: 'process_order',
      payload: {}
    });

    assert.equal(response.ok, true);
    const { task } = await response.json();
    assert.equal(typeof task.status, 'string', 'task.status must always be a string');
  });
});

// ─── ENGINE_ENFORCEMENT_VIOLATION error handling ──────────────────────────────

test('ENGINE_ENFORCEMENT_VIOLATION error handling', async (t) => {
  await t.test('POST /task/:id/ack returns 409 when ACK body contains executionResult', async () => {
    const createResponse = await postTask({
      type: 'discord',
      title: 'ack-enforcement-test',
      action: 'reply_to_message',
      payload: {
        channelId: '1491500223288184964',
        messageId: '1491500223288184964',
        content: 'test'
      }
    });

    assert.equal(createResponse.ok, true);
    const { task } = await createResponse.json();

    const ackResponse = await ackTask(task.id, { executionResult: { success: true } });
    assert.equal(ackResponse.status, 409, 'ACK with executionResult in body must return 409');
    const ackJson = await ackResponse.json();
    assert.equal(ackJson.error, 'ENGINE_ENFORCEMENT_VIOLATION', 'error must identify ENGINE_ENFORCEMENT_VIOLATION');
  });

  await t.test('POST /task/:id/ack returns 409 when ACK body contains status override', async () => {
    const createResponse = await postTask({
      type: 'discord',
      title: 'ack-status-override-test',
      action: 'reply_to_message',
      payload: {
        channelId: '1491500223288184964',
        messageId: '1491500223288184964',
        content: 'test'
      }
    });

    assert.equal(createResponse.ok, true);
    const { task } = await createResponse.json();

    const ackResponse = await ackTask(task.id, { status: 'done' });
    assert.equal(ackResponse.status, 409, 'ACK with status override in body must return 409');
    const ackJson = await ackResponse.json();
    assert.equal(ackJson.error, 'ENGINE_ENFORCEMENT_VIOLATION');
  });

  await t.test('POST /task/:id/ack returns 409 when task has not been executed', async () => {
    const createResponse = await postTask({
      type: 'discord',
      title: 'ack-without-execution-test',
      action: 'reply_to_message',
      payload: {
        channelId: '1491500223288184964',
        messageId: '1491500223288184964',
        content: 'test'
      }
    });

    assert.equal(createResponse.ok, true);
    const { task } = await createResponse.json();

    // Attempt ACK with empty body — task has no executionRecord yet
    const ackResponse = await ackTask(task.id, {});
    assert.equal(ackResponse.status, 409, 'ACK without prior execution must return 409');
    const ackJson = await ackResponse.json();
    assert.equal(ackJson.error, 'ENGINE_ENFORCEMENT_VIOLATION');
  });
});
