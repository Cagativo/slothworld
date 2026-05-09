import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildLocalBrainTaskPayload } from '../ui/task-creator-panel.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TASK_CREATOR_PATH = resolve(ROOT, 'ui/task-creator-panel.js');

test('task creator: Local Brain Test builds a local_llm task payload', () => {
  const payload = buildLocalBrainTaskPayload({
    title: '  Test local model  ',
    prompt: '  Say hello  '
  });

  assert.deepEqual(payload, {
    type: 'local_llm',
    title: 'Test local model',
    payload: {
      source: 'task_creator_panel',
      prompt: 'Say hello',
      system: 'You are a concise local assistant running inside Slothworld.',
      model: ''
    }
  });
});

test('task creator: Local Brain Test uses default title and prompt', () => {
  const payload = buildLocalBrainTaskPayload();

  assert.equal(payload.type, 'local_llm');
  assert.equal(payload.title, 'Local Brain Test');
  assert.equal(payload.payload.prompt, 'Reply with a short friendly hello from the local Slothworld brain.');
  assert.equal(payload.payload.model, '');
});

test('task creator: Local Brain Test uses injectTask and does not import provider', () => {
  const source = readFileSync(TASK_CREATOR_PATH, 'utf8');

  assert.match(source, /<option value="local_llm">Local Brain Test<\/option>/);
  assert.match(source, /window\.controlAPI\.injectTask\(/);
  assert.equal(/ollamaProvider|integrations\/llm\/providers|fetch\s*\(\s*['"]http:\/\/127\.0\.0\.1:11434/.test(source), false);
});
