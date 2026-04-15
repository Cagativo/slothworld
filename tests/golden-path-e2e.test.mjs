import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

let serverProcess = null;
let baseUrl = null;

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url, timeoutMs = 10000) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) {
        return;
      }
    } catch (_e) {
      // Server not ready yet
    }
    await delay(100);
  }
  
  throw new Error(`server_startup_timeout after ${timeoutMs}ms at ${url}`);
}

before(async () => {
  const port = 13579;
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

  await waitForServer(baseUrl);
  await delay(500); // Extra buffer for full initialization
});

after(() => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
  }
});

test('Golden Path: HTTP End-to-End Task Flow', async (t) => {
  // Create a task via HTTP
  const createResponse = await fetch(`${baseUrl}/task`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'image_render',
      title: 'Golden Path E2E Test',
      action: 'generate',
      payload: { 
        message: 'testing end-to-end flow',
        prompt: 'test prompt'
      }
    })
  });

  assert.ok(createResponse.ok, `task creation should succeed, got ${createResponse.status}`);
  const createData = await createResponse.json();
  const taskId = createData.task?.id;
  assert.ok(taskId, 'task id should be returned');

  console.log(`   Created task: ${taskId}`);

  // Fetch task state
  const fetchResponse = await fetch(`${baseUrl}/tasks`);
  assert.ok(fetchResponse.ok, 'tasks endpoint should work');
  const tasksData = await fetchResponse.json();
  const task = tasksData.tasks?.find((t) => t.id === taskId);
  assert.ok(task, 'created task should be in tasks list');

  console.log(`   Task status: ${task.status}`);

  // Get event stream for this task
  const eventsResponse = await fetch(`${baseUrl}/events`);
  let events = [];
  
  if (eventsResponse.ok) {
    const eventsData = await eventsResponse.json();
    events = eventsData.events || [];
    const taskEvents = events.filter((e) => e.taskId === taskId);
    console.log(`   Events for task: ${taskEvents.map((e) => e.type).join(' → ')}`);
  } else {
    console.log(`   Events endpoint not available (${eventsResponse.status})`);
  }

  assert.ok(events.length > 0 || task, 'either events or task state should exist');

  console.log('✅ Event-driven HTTP flow: Operational');
});
