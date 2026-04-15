import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { createTaskExecutionWorker } from '../core/workers/taskExecutionWorker.js';
import { openAIImageProvider } from '../integrations/rendering/providers/openaiImageProvider.js';
import { persistRenderAssetContract } from '../core/workers/assetPersistenceWorker.js';
import { createDiscordNotificationWorker } from '../core/workers/discordNotificationWorker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const STORE_PATH = path.join(ROOT_DIR, 'bridge-store.json');

let serverProcess = null;
let baseUrl = null;
let storeBackup = null;
let serverExistedBefore = false;
let storeExistedBefore = false;
const cleanupGeneratedDirs = new Set();
let serverStdout = '';
let serverStderr = '';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url, timeoutMs = 15000) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) {
        return;
      }
      lastError = new Error(`health_status_${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await delay(200);
  }

  const details = [
    'server_start_timeout',
    `url=${url}`,
    `lastError=${lastError ? String(lastError.message || lastError) : 'none'}`,
    `stdout=${serverStdout.slice(-1200)}`,
    `stderr=${serverStderr.slice(-1200)}`
  ].join('\n');
  throw new Error(details);
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

async function createTask(payload = {}) {
  const response = await fetch(`${baseUrl}/task`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      type: 'discord',
      title: 'adversarial task',
      action: 'reply_to_message',
      payload: {
        channelId: '1491500223288184964',
        messageId: '1491500223288184964',
        content: 'adversarial'
      },
      ...payload
    })
  });

  assert.equal(response.ok, true, 'task creation failed unexpectedly');
  const json = await response.json();
  assert.equal(json && json.task && typeof json.task.id === 'string', true, 'task id missing from create response');
  return json.task.id;
}

async function ackTask(taskId, body) {
  return fetch(`${baseUrl}/task/${encodeURIComponent(taskId)}/ack`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
}

async function executeTask(taskId) {
  return fetch(`${baseUrl}/task/${encodeURIComponent(taskId)}/execute`, {
    method: 'POST'
  });
}

async function getTaskFromTasksApi(taskId) {
  const response = await fetch(`${baseUrl}/tasks`);
  assert.equal(response.ok, true, 'failed to fetch tasks');
  const json = await response.json();
  const tasks = json && Array.isArray(json.tasks) ? json.tasks : [];
  return tasks.find((task) => task && task.id === taskId) || null;
}

async function getTasks() {
  const response = await fetch(`${baseUrl}/tasks`);
  assert.equal(response.ok, true, 'failed to fetch tasks list');
  const json = await response.json();
  return json && Array.isArray(json.tasks) ? json.tasks : [];
}

function snapshotTaskState(task) {
  if (!task) {
    return null;
  }

  return {
    status: task.status,
    engineStatus: task.engineStatus || null,
    completedAt: task.completedAt || null,
    failedAt: task.failedAt || null,
    durationMs: typeof task.durationMs === 'number' ? task.durationMs : null,
    executionResultJson: task.executionResult ? JSON.stringify(task.executionResult) : null
  };
}

function assertTaskStateUnchanged(before, after, contextLabel) {
  assert.deepEqual(after, before, `${contextLabel}: task state mutated unexpectedly`);
}

async function assertTaskNotTerminal(taskId, contextLabel) {
  const task = await getTaskFromTasksApi(taskId);
  assert.ok(task, `${contextLabel}: task not found`);
  assert.notEqual(task.status, 'done', `${contextLabel}: task incorrectly became done`);
  assert.notEqual(task.status, 'failed', `${contextLabel}: task incorrectly became failed`);
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (_error) {
    return false;
  }
}

before(async () => {
  try {
    storeBackup = await fs.readFile(STORE_PATH, 'utf8');
    storeExistedBefore = true;
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      throw error;
    }

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

  serverProcess.stdout.on('data', (chunk) => {
    serverStdout += String(chunk || '');
  });
  serverProcess.stderr.on('data', (chunk) => {
    serverStderr += String(chunk || '');
  });

  const earlyExit = new Promise((_, reject) => {
    serverProcess.once('exit', (code, signal) => {
      reject(new Error(`server_process_exited_early code=${code} signal=${signal}\nstdout=${serverStdout.slice(-1200)}\nstderr=${serverStderr.slice(-1200)}`));
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

  for (const dirPath of cleanupGeneratedDirs) {
    await fs.rm(dirPath, { recursive: true, force: true });
  }
});

test('ACK integrity', async (t) => {
  await t.test('should reject ACK without execution', async () => {
    const taskId = await createTask({ title: 'ack-integrity-no-exec' });
    const before = snapshotTaskState(await getTaskFromTasksApi(taskId));

    const ackResponse = await ackTask(taskId, {});
    assert.equal(ackResponse.ok, false);
    assert.equal(ackResponse.status, 409);
    const ackJson = await ackResponse.json();
    assert.equal(ackJson && ackJson.error, 'ENGINE_ENFORCEMENT_VIOLATION');

    const after = snapshotTaskState(await getTaskFromTasksApi(taskId));
    assertTaskStateUnchanged(before, after, 'should reject ACK without execution');
    await assertTaskNotTerminal(taskId, 'should reject ACK without execution');
  });

  await t.test('should reject ACK with fake executionResult body', async () => {
    const taskId = await createTask({ title: 'ack-integrity-fake-result' });
    const before = snapshotTaskState(await getTaskFromTasksApi(taskId));

    const ackResponse = await ackTask(taskId, { executionResult: { success: true } });
    assert.equal(ackResponse.ok, false);
    assert.equal(ackResponse.status, 409);
    const ackJson = await ackResponse.json();
    assert.equal(ackJson && ackJson.error, 'ENGINE_ENFORCEMENT_VIOLATION');

    const after = snapshotTaskState(await getTaskFromTasksApi(taskId));
    assertTaskStateUnchanged(before, after, 'should reject ACK with fake executionResult body');
    await assertTaskNotTerminal(taskId, 'should reject ACK with fake executionResult body');
  });
});

test('Execution authority', async (t) => {
  await t.test('should reject direct worker.executeTask invocation outside TaskEngine', async () => {
    const anchorTaskId = await createTask({ title: 'execution-authority-anchor' });
    const before = snapshotTaskState(await getTaskFromTasksApi(anchorTaskId));

    const worker = createTaskExecutionWorker({
      getDiscordClient: () => null,
      taskTriggeredMessageIds: new Set()
    });

    await assert.rejects(
      async () => worker.executeTask({
        id: 'worker-bypass-task',
        type: 'discord',
        action: 'reply_to_message',
        payload: {
          channelId: '1491500223288184964',
          messageId: '1491500223288184964',
          content: 'attack'
        }
      }),
      (error) => error && error.message === 'ENGINE_ENFORCEMENT_VIOLATION'
    );

    const after = snapshotTaskState(await getTaskFromTasksApi(anchorTaskId));
    assertTaskStateUnchanged(before, after, 'should reject direct worker.executeTask invocation outside TaskEngine');
  });
});

test('Provider isolation', async (t) => {
  await t.test('should reject direct provider.generate invocation outside worker context', async () => {
    const tasksBefore = (await getTasks()).length;

    await assert.rejects(
      async () => openAIImageProvider.generate('attack prompt', { metadata: { productId: 'attack' } }),
      (error) => error && error.message === 'ENGINE_ENFORCEMENT_VIOLATION'
    );

    const tasksAfter = (await getTasks()).length;
    assert.equal(tasksAfter, tasksBefore, 'provider bypass attempt mutated task state');
  });
});

test('Side-effect isolation', async (t) => {
  await t.test('should reject direct asset persistence side-effect invocation', async () => {
    const marker = `attack-product-${Date.now()}`;
    const targetDir = path.join(ROOT_DIR, 'assets', 'generated', marker);
    cleanupGeneratedDirs.add(targetDir);
    const existedBefore = await pathExists(targetDir);

    await assert.rejects(
      async () => persistRenderAssetContract({
        assetId: 'attack-asset',
        productId: marker,
        provider: 'openai',
        prompt: 'attack',
        contentBase64: Buffer.from('attack').toString('base64'),
        metadata: {}
      }),
      (error) => error && error.message === 'ENGINE_ENFORCEMENT_VIOLATION'
    );

    const existsAfter = await pathExists(targetDir);
    assert.equal(existsAfter, existedBefore, 'filesystem side effect occurred during bypass attempt');
  });

  await t.test('should reject direct discord side-effect invocation', async () => {
    const calls = {
      channelFetch: 0,
      messageFetch: 0,
      reply: 0,
      send: 0
    };

    const fakeClient = {
      isReady: () => true,
      channels: {
        fetch: async () => {
          calls.channelFetch += 1;
          return {
            messages: {
              fetch: async () => {
                calls.messageFetch += 1;
                return {
                  reply: async () => {
                    calls.reply += 1;
                  }
                };
              }
            },
            send: async () => {
              calls.send += 1;
            }
          };
        }
      }
    };

    const worker = createDiscordNotificationWorker({
      getDiscordClient: () => fakeClient
    });

    await assert.rejects(
      async () => worker.notifyTaskCompletion({
        id: 'discord-side-effect-bypass',
        payload: {
          channelId: '1491500223288184964',
          messageId: '1491500223288184964',
          content: 'attack'
        }
      }),
      (error) => error && error.message === 'ENGINE_ENFORCEMENT_VIOLATION'
    );

    assert.equal(calls.channelFetch, 0, 'discord channel fetch side effect occurred');
    assert.equal(calls.messageFetch, 0, 'discord message fetch side effect occurred');
    assert.equal(calls.reply, 0, 'discord reply side effect occurred');
    assert.equal(calls.send, 0, 'discord send side effect occurred');
  });
});

test('Lifecycle integrity', async (t) => {
  await t.test('should reject created -> ack lifecycle skip', async () => {
    const taskId = await createTask({ title: 'lifecycle-skip-created-to-ack' });
    const before = snapshotTaskState(await getTaskFromTasksApi(taskId));

    const ackResponse = await ackTask(taskId, {});
    assert.equal(ackResponse.ok, false);
    assert.equal(ackResponse.status, 409);

    const after = snapshotTaskState(await getTaskFromTasksApi(taskId));
    assertTaskStateUnchanged(before, after, 'should reject created -> ack lifecycle skip');
    await assertTaskNotTerminal(taskId, 'should reject created -> ack lifecycle skip');
  });

  await t.test('should allow terminal state only after execute -> ack', async () => {
    const taskId = await createTask({ title: 'lifecycle-valid-execute-ack' });

    const executeResponse = await executeTask(taskId);
    assert.equal(executeResponse.ok, true, 'execute should succeed in valid lifecycle path');

    const ackResponse = await ackTask(taskId, {});
    assert.equal(ackResponse.ok, true, 'ack should succeed in valid lifecycle path');

    const task = await getTaskFromTasksApi(taskId);
    assert.ok(task, 'task missing after valid lifecycle');
    assert.ok(task.status === 'done' || task.status === 'failed', 'task should be terminal only after execute + ack');
  });
});
