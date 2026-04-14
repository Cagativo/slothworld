import { agents, desks, workflows, commandHistory, eventStream } from '../core/app-state.js';
import { addTaskToDesk, ingestTask } from '../core/task-handling.js';
import { createWorkflow, getWorkflow, listWorkflows } from '../core/workflow.js';
import { getRenderQueueStats } from '../integrations/rendering/render-queue.js';
import { getRenderQueueSnapshot, getFailedRenderReport, replayFailedRender, getRenderTrace } from '../integrations/rendering/render-stability.js';
import { controlAPI, dispatchCommand, inspectAgent, inspectDesk, inspectWorkflow } from './control-api.js';

function buildTestDesignIntent(override = {}) {
  return {
    product_name: 'minimalist cat lamp',
    style: 'modern scandinavian',
    mood: 'cozy ambient lighting',
    colors: ['warm white', 'soft beige'],
    composition: 'studio product shot',
    camera: '85mm lens',
    background: 'neutral gradient',
    prompt: 'Minimalist cat lamp, modern Scandinavian home decor, cozy ambient product photo, warm white glow, soft beige palette, studio product shot',
    ...override
  };
}

function injectRenderTask(productId, designIntent, override = {}) {
  const renderId = `render-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const task = {
    type: 'image_render',
    productId,
    provider: 'openai',
    designIntent,
    title: 'Test Render Task',
    renderId,
    payload: {
      renderId,
      productId,
      provider: 'openai',
      designIntent
    },
    ...override
  };

  const result = controlAPI.injectTask(task);
  console.log('[RENDER_TEST][INJECT]', {
    renderId,
    productId,
    provider: task.provider,
    status: result && result.success ? 'queued' : 'inject_failed',
    result
  });

  return {
    renderId,
    productId,
    provider: task.provider,
    status: result && result.success ? 'queued' : 'inject_failed',
    result
  };
}

function createTestProduct(options = {}) {
  const productId = `product_${Date.now()}`;
  const promptText = typeof options === 'string'
    ? options.trim()
    : (options && typeof options.promptText === 'string' ? options.promptText.trim() : '');

  if (!promptText) {
    console.error('[CreateProduct] missing_prompt');
    throw new Error('missing_prompt');
  }

  const concept = {
    name: promptText || 'minimalist cat lamp',
    niche: 'home decor',
    style: 'scandinavian'
  };

  const designIntent = {
    product_name: concept.name,
    style: (options && options.style) || concept.style,
    mood: (options && options.mood) || 'cozy ambient lighting',
    colors: (options && Array.isArray(options.colors) && options.colors.length > 0)
      ? options.colors
      : ['warm white', 'soft beige'],
    composition: (options && options.composition) || 'studio product shot',
    camera: (options && options.camera) || '85mm lens',
    background: (options && options.background) || 'neutral gradient',
    prompt: promptText,
    prompt_hint: promptText,
    niche: concept.niche
  };

  console.log('[CreateProduct]', {
    productId,
    designIntent
  });

  const task = {
    type: 'image_render',
    title: 'Generate Product Image',
    productId,
    provider: 'openai',
    designIntent,
    payload: {
      source: 'create_product_button',
      productId,
      provider: 'openai',
      designIntent
    }
  };

  const result = controlAPI.injectTask(task);

  return {
    productId,
    promptText,
    designIntent,
    result
  };
}

function generateBatchRenders(count = 3) {
  const total = Math.max(1, Number(count) || 1);
  const styleVariants = [
    'modern scandinavian',
    'japanese minimalism',
    'soft brutalist decor',
    'retro-futurist interior',
    'organic modern'
  ];
  const colorVariants = [
    ['warm white', 'soft beige'],
    ['cream', 'light oak'],
    ['amber', 'matte ivory'],
    ['pearl white', 'muted sand'],
    ['soft terracotta', 'linen']
  ];

  const results = [];
  for (let index = 0; index < total; index += 1) {
    const productId = `test_batch_${Date.now()}_${index}`;
    const style = styleVariants[index % styleVariants.length];
    const colors = colorVariants[index % colorVariants.length];
    const designIntent = buildTestDesignIntent({
      style,
      colors,
      product_name: `minimalist cat lamp v${index + 1}`
    });

    results.push(injectRenderTask(productId, designIntent, {
      title: `Test Render Task #${index + 1}`
    }));
  }

  return results;
}

function generateTestRender() {
  const productId = `test_${Date.now()}`;
  const designIntent = buildTestDesignIntent();
  return injectRenderTask(productId, designIntent);
}

export function exposeWindowAPI() {
  // Preserve the original window debug API surface exactly.
  window.addTaskToDesk = addTaskToDesk;
  window.ingestTask = ingestTask;
  window.createWorkflow = createWorkflow;
  window.workflows = workflows;
  window.getWorkflow = getWorkflow;
  window.listWorkflows = listWorkflows;
  window.inspectAgent = inspectAgent;
  window.inspectDesk = inspectDesk;
  window.inspectWorkflow = inspectWorkflow;
  window.controlAPI = controlAPI;
  window.dispatchCommand = dispatchCommand;
  window.commandHistory = commandHistory;
  window.eventStream = eventStream;
  window.getRenderQueueStats = getRenderQueueStats;
  window.getRenderQueueSnapshot = getRenderQueueSnapshot;
  window.getFailedRenderReport = getFailedRenderReport;
  window.replayFailedRender = replayFailedRender;
  window.getRenderTrace = getRenderTrace;
  window.generateTestRender = generateTestRender;
  window.createTestProduct = createTestProduct;
  window.generateBatchRenders = generateBatchRenders;

  // Keep direct access for existing debugging scripts.
  window.agents = agents;
  window.desks = desks;
}
