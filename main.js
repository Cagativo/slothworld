// --- Setup ---
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
canvas.width = 800;
canvas.height = 600;

const DEBUG_RENDER_POINTS = false;
const TARGET_RETRY_DELAY = 30;
const SITTING_TO_WORKING_DELAY = 45;
const IDLE_WANDER_REASSIGN_DELAY = 150;
const WANDER_TARGET_INTERVAL = 75;
const TASK_EXECUTION_FAILURE_CHANCE = 0.05;
const BRIDGE_POLL_INTERVAL_MS = 1500;
const DEFAULT_WORKFLOW_STEP_MAX_RETRIES = 2;

window.DEV_MODE = false;
const ACTION_TOOL_MAP = {
  reply_to_message: 'discord.reply',
  fetch_order: 'shopify.process_order',
  refund_order: 'shopify.process_order',
  process_order: 'shopify.process_order',
  research_product: 'research.query',
  generate_design_prompt: 'shopify.generate_design_prompt',
  generate_mock_image: 'image.generate',
  create_product_listing: 'shopify.create_product_listing'
};
const SITTING_OFFSET = {
  x: 0,
  y: 0
};

const spriteConfigs = {
  desk: { width: 96, height: 64 },
  computer: { width: 28, height: 24 },
  agent: { width: 48, height: 48 }
};

function drawSprite(ctx, image, x, y, config) {
  if (!image) {
    return;
  }

  const drawX = x - config.width / 2;
  const drawY = y - config.height / 2;

  if (
    config.sourceWidth !== undefined &&
    config.sourceHeight !== undefined &&
    config.sourceX !== undefined &&
    config.sourceY !== undefined
  ) {
    ctx.drawImage(
      image,
      config.sourceX,
      config.sourceY,
      config.sourceWidth,
      config.sourceHeight,
      drawX,
      drawY,
      config.width,
      config.height
    );
    return;
  }

  ctx.drawImage(image, drawX, drawY, config.width, config.height);
}

function drawLogicalPoint(ctx, x, y) {
  if (!DEBUG_RENDER_POINTS) {
    return;
  }

  ctx.fillStyle = '#ff2b2b';
  ctx.beginPath();
  ctx.arc(x, y, 2, 0, Math.PI * 2);
  ctx.fill();
}

function toCenterPosition(topLeftX, topLeftY, config) {
  return {
    x: topLeftX + config.width / 2,
    y: topLeftY + config.height / 2
  };
}

function createDesk(x, y) {
  return {
    x,
    y,
    type: 'desk',
    occupied: false,
    slots: {
      seat: { offsetX: 0, offsetY: 40 },
      computer: { offsetX: 0, offsetY: -20 }
    },
    occupant: null,
    queue: [],
    currentTask: null,
    paused: false,
    completedTasks: 0,
    failedTasks: 0,
    lastFailedTask: null,
    computer: {
      offsetX: 0,
      offsetY: -20
    }
  };
}

function createDeskFromTopLeft(topLeftX, topLeftY) {
  const centerPosition = toCenterPosition(topLeftX, topLeftY, spriteConfigs.desk);
  return createDesk(centerPosition.x, centerPosition.y);
}

function getDeskSlotPosition(desk, slotName) {
  const slot = desk.slots[slotName];
  return {
    x: desk.x + slot.offsetX,
    y: desk.y + slot.offsetY
  };
}

function randomInRange(min, max) {
  return Math.random() * (max - min) + min;
}

function generateId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createRandomAgent() {
  return {
    x: randomInRange(0, canvas.width),
    y: randomInRange(0, canvas.height),
    targetX: null,
    targetY: null,
    targetDesk: null,
    targetSlot: null,
    role: 'other',
    direction: 'down',
    animationFrame: 0,
    animationTimer: 0,
    stateTimer: 0,
    wanderTimer: 0,
    targetRetryTimer: 0,
    productivity: randomInRange(0.6, 1.3),
    skills: {
      discord: 1,
      shopify: 1
    },
    state: 'idle',
    speed: randomInRange(0.8, 2.2)
  };
}

const roles = ['researcher', 'executor', 'other', 'other'];
const agents = roles.map((role, index) => {
  const agent = createRandomAgent();
  agent.id = index;
  agent.role = role;

  if (role === 'researcher') {
    agent.skills.discord = 1.5;
    agent.skills.shopify = 0.9;
  } else if (role === 'executor') {
    agent.skills.discord = 0.9;
    agent.skills.shopify = 1.5;
  }

  return agent;
});
const desks = [
  createDeskFromTopLeft(160, 150),
  createDeskFromTopLeft(300, 150),
  createDeskFromTopLeft(440, 150),
  createDeskFromTopLeft(160, 300),
  createDeskFromTopLeft(300, 300),
  createDeskFromTopLeft(440, 300)
];
const workflows = new Map();
const commandHistory = [];
const eventStream = [];
const agentStateTracker = new Map();

function emitEvent(type, payload) {
  const event = {
    type,
    timestamp: Date.now(),
    payload: payload || {}
  };

  eventStream.push(event);
  if (eventStream.length > 2000) {
    eventStream.shift();
  }

  return event;
}

function isDeskAvailableForAgent(desk, agent) {
  return !desk.occupied || desk.occupant === agent;
}

function getDeskLoadScore(desk) {
  return desk.queue.length + (desk.currentTask ? 1 : 0);
}

function cloneContext(value) {
  try {
    return JSON.parse(JSON.stringify(value || {}));
  } catch (error) {
    return {};
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sanitizeJsonValue(value) {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    return undefined;
  }

  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (Array.isArray(value)) {
    return value.map((item) => {
      const sanitizedItem = sanitizeJsonValue(item);
      return sanitizedItem === undefined ? null : sanitizedItem;
    });
  }

  if (!isPlainObject(value)) {
    return undefined;
  }

  const sanitizedObject = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    const sanitizedNestedValue = sanitizeJsonValue(nestedValue);
    if (sanitizedNestedValue !== undefined) {
      sanitizedObject[key] = sanitizedNestedValue;
    }
  }

  return sanitizedObject;
}

function validateWorkflowContextEntry(entry) {
  const sanitizedEntry = sanitizeJsonValue(entry);
  if (!isPlainObject(sanitizedEntry)) {
    return null;
  }

  return sanitizedEntry;
}

function inferDefaultPriority(task) {
  const title = (task.title || '').toLowerCase();

  if (title.includes('log') || title.includes('passive')) {
    return 0;
  }

  if (task.type === 'discord' && (title.includes('mention') || title.includes('command'))) {
    return 2;
  }

  if (task.type === 'shopify' && title.includes('order')) {
    return 2;
  }

  return 1;
}

function buildWorkflowPlan(steps, keyword) {
  return steps.map((step, index) => ({
    id: `step-${index}`,
    index,
    tool: step.tool || null,
    action: step.action || null,
    type: step.type || 'discord',
    title: step.title || `Step ${index + 1}`,
    description: step.description || step.title || `Unnamed step`,
    complexity: step.complexity || 'med',
    rolePreference: step.rolePreference || 'any',
    payload: step.payload || {}
  }));
}

function createWorkflow(workflowInput) {
  const shouldPlan = workflowInput.shouldPlan !== false;
  const plan = shouldPlan ? buildWorkflowPlan(workflowInput.steps || [], workflowInput.context && workflowInput.context.keyword) : null;

  const workflow = {
    id: workflowInput.id || `workflow-${generateId()}`,
    context: cloneContext(workflowInput.context),
    steps: Array.isArray(workflowInput.steps) ? workflowInput.steps.slice() : [],
    stepStatuses: Array.isArray(workflowInput.steps) ? workflowInput.steps.map(() => 'pending') : [],
    stepAttempts: Array.isArray(workflowInput.steps) ? workflowInput.steps.map(() => 0) : [],
    stepMaxRetries: Array.isArray(workflowInput.steps)
      ? workflowInput.steps.map((step) => {
        if (Number.isInteger(step && step.maxRetries) && step.maxRetries >= 0) {
          return step.maxRetries;
        }

        return DEFAULT_WORKFLOW_STEP_MAX_RETRIES;
      })
      : [],
    currentStepIndex: 0,
    status: shouldPlan ? 'pending_approval' : 'running',
    plan: plan,
    createdAt: Date.now(),
    approvedAt: null,
    completedAt: null,
    failedAt: null
  };

  workflows.set(workflow.id, workflow);

  if (plan) {
    emitEvent('WORKFLOW_PLANNED', {
      workflowId: workflow.id,
      stepCount: plan.length,
      context: cloneContext(workflow.context)
    });
  } else {
    enqueueWorkflowStep(workflow.id, 0);
  }

  return workflow;
}

function getWorkflowStepName(workflow, stepIndex) {
  if (!workflow || !Array.isArray(workflow.steps) || stepIndex < 0 || stepIndex >= workflow.steps.length) {
    return `step_${stepIndex}`;
  }

  const step = workflow.steps[stepIndex] || {};
  return step.action || step.title || `step_${stepIndex}`;
}

function logWorkflowStepTransition(workflow, stepIndex, toStatus) {
  const stepName = getWorkflowStepName(workflow, stepIndex);
  console.log(`[WORKFLOW][${workflow.id}][STEP] ${stepName} → ${toStatus}`);
  emitEvent('WORKFLOW_STEP_CHANGED', {
    workflowId: workflow.id,
    stepIndex,
    stepName,
    status: toStatus
  });
}

async function sendWorkflowFailureDiscordMessage(workflow, task, executionResult) {
  const channelId =
    (workflow && workflow.context && workflow.context.sourceChannelId) ||
    (task && task.payload && task.payload.channelId) ||
    null;
  const messageId =
    (workflow && workflow.context && workflow.context.sourceMessageId) ||
    (task && task.payload && task.payload.messageId) ||
    null;

  if (!channelId) {
    console.warn('[WORKFLOW]', 'missing_failure_channel', workflow && workflow.id);
    return;
  }

  const stepName = getWorkflowStepName(workflow, task && task.workflowStepIndex);
  const reason = executionResult && executionResult.error ? executionResult.error : 'unknown_error';
  const keyword = workflow && workflow.context && workflow.context.keyword ? workflow.context.keyword : 'workflow';

  await executeDiscordTask({
    id: `${workflow.id}-failure-notice-${Date.now()}`,
    type: 'discord',
    action: 'reply_to_message',
    payload: {
      channelId,
      messageId,
      content: `Workflow failed for "${keyword}" at step "${stepName}". Error: ${reason}`
    }
  });
}

function buildWorkflowSnapshot(workflow) {
  if (!workflow) {
    return null;
  }

  const currentStepName = getWorkflowStepName(workflow, workflow.currentStepIndex);
  const currentStepStatus = workflow.stepStatuses[workflow.currentStepIndex] || 'pending';
  const completedSteps = workflow.steps
    .map((step, index) => ({
      index,
      name: step.action || step.title || `step_${index}`,
      status: workflow.stepStatuses[index] || 'pending'
    }))
    .filter((step) => step.status === 'done');

  return {
    id: workflow.id,
    status: workflow.status,
    currentStep: {
      index: workflow.currentStepIndex,
      name: currentStepName,
      status: currentStepStatus
    },
    completedSteps,
    contextSnapshot: cloneContext(workflow.context),
    createdAt: workflow.createdAt,
    completedAt: workflow.completedAt,
    failedAt: workflow.failedAt,
    totalSteps: workflow.steps.length
  };
}

function getWorkflow(id) {
  if (!id) {
    return null;
  }

  return buildWorkflowSnapshot(workflows.get(id));
}

function listWorkflows() {
  return Array.from(workflows.values()).map((workflow) => buildWorkflowSnapshot(workflow));
}

function enqueueAllWorkflowSteps(workflowId) {
  const workflow = workflows.get(workflowId);
  if (!workflow || !workflow.steps || workflow.steps.length === 0) {
    return false;
  }

  workflow.status = 'running';
  workflow.approvedAt = Date.now();
  enqueueWorkflowStep(workflow.id, 0);
  return true;
}

function enqueueWorkflowStep(workflowId, stepIndex) {
  const workflow = workflows.get(workflowId);
  if (!workflow || workflow.status !== 'running' || stepIndex < 0 || stepIndex >= workflow.steps.length) {
    return null;
  }

  const step = workflow.steps[stepIndex];
  const task = {
    id: `${workflow.id}-step-${stepIndex}`,
    type: step.type || 'discord',
    tool: step.tool || null,
    action: step.action || step.tool || 'reply_to_message',
    title: step.title || `${workflow.id}:${step.tool || step.action || `step_${stepIndex}`}`,
    priority: step.priority ?? 1,
    required: step.required ?? randomInRange(80, 200),
    payload: {
      ...(step.payload || {}),
      context: cloneContext(workflow.context)
    },
    workflowId,
    workflowStepIndex: stepIndex,
    workflowContextInput: cloneContext(workflow.context),
    status: 'pending'
  };

  const desk = addTaskToDesk(task);
  if (!desk) {
    return null;
  }

  workflow.currentStepIndex = stepIndex;
  workflow.stepStatuses[stepIndex] = 'running';
  logWorkflowStepTransition(workflow, stepIndex, 'running');
  return task;
}

function applyWorkflowTaskCompletion(task, executionResult) {
  if (!task || !task.workflowId) {
    return;
  }

  const workflow = workflows.get(task.workflowId);
  if (!workflow || workflow.status !== 'running') {
    return;
  }

  const stepIndex = task.workflowStepIndex;
  if (typeof stepIndex !== 'number' || stepIndex < 0 || stepIndex >= workflow.steps.length) {
    return;
  }

  const step = workflow.steps[stepIndex];
  const contextKey = step.contextKey || step.action || `step_${stepIndex}`;
  const isFailedStep = executionResult && executionResult.success === false;
  const currentAttempt = (workflow.stepAttempts[stepIndex] || 0) + 1;
  const maxRetries = workflow.stepMaxRetries[stepIndex] ?? DEFAULT_WORKFLOW_STEP_MAX_RETRIES;
  const stepStatus = isFailedStep ? 'failed' : 'done';
  const contextEntry = validateWorkflowContextEntry({
    taskId: task.id,
    status: stepStatus,
    input: cloneContext(task.payload && task.payload.context),
    output: executionResult || null,
    attempts: currentAttempt,
    maxRetries,
    completedAt: Date.now()
  });

  workflow.stepAttempts[stepIndex] = currentAttempt;

  if (!contextEntry) {
    workflow.stepStatuses[stepIndex] = 'failed';
    workflow.status = 'failed';
    workflow.failedAt = Date.now();
    logWorkflowStepTransition(workflow, stepIndex, 'failed');
    sendWorkflowFailureDiscordMessage(workflow, task, { success: false, error: 'invalid_workflow_context_entry' });
    return;
  }

  workflow.stepStatuses[stepIndex] = stepStatus;
  workflow.context[contextKey] = contextEntry;

  logWorkflowStepTransition(workflow, stepIndex, stepStatus);

  if (isFailedStep) {
    if (currentAttempt <= maxRetries) {
      const retriedTask = enqueueWorkflowStep(workflow.id, stepIndex);
      if (retriedTask) {
        console.log('[WORKFLOW]', workflow.id, 'retry', getWorkflowStepName(workflow, stepIndex), `${currentAttempt}/${maxRetries}`);
        return;
      }
    }

    workflow.status = 'failed';
    workflow.failedAt = Date.now();
    sendWorkflowFailureDiscordMessage(workflow, task, executionResult);
    return;
  }

  const nextStepIndex = stepIndex + 1;
  if (nextStepIndex >= workflow.steps.length) {
    workflow.status = 'done';
    workflow.completedAt = Date.now();
    return;
  }

  enqueueWorkflowStep(workflow.id, nextStepIndex);
}

function createProductWorkflowFromTask(task) {
  const args = Array.isArray(task.payload && task.payload.args) ? task.payload.args : [];
  const keyword = (args[0] || 'unknown-product').trim();
  const channelId = task.payload && task.payload.channelId ? task.payload.channelId : null;
  const messageId = task.payload && task.payload.messageId ? task.payload.messageId : null;

  const workflow = createWorkflow({
    id: `workflow-product-${task.id}`,
    context: {
      keyword,
      sourceTaskId: task.id,
      sourceMessageId: messageId,
      sourceChannelId: channelId
    },
    steps: [
      {
        tool: 'research.query',
        contextKey: 'research_product',
        title: `Research product: ${keyword}`,
        description: `Search for market trends and data on "${keyword}"`,
        complexity: 'low',
        rolePreference: 'researcher',
        type: 'shopify'
      },
      {
        tool: 'shopify.generate_design_prompt',
        contextKey: 'generate_design_prompt',
        title: `Generate design prompt: ${keyword}`,
        description: `Create a design brief based on research findings`,
        complexity: 'med',
        rolePreference: 'executor',
        type: 'shopify'
      },
      {
        tool: 'image.generate',
        contextKey: 'generate_mock_image',
        title: `Generate mock image: ${keyword}`,
        description: `Generate a visual mockup of the product`,
        complexity: 'high',
        rolePreference: 'executor',
        type: 'shopify'
      },
      {
        tool: 'shopify.create_product_listing',
        contextKey: 'create_product_listing',
        title: `Create listing: ${keyword}`,
        description: `Create Shopify product listing with all details`,
        complexity: 'med',
        rolePreference: 'executor',
        type: 'shopify'
      },
      {
        tool: 'discord.reply',
        contextKey: 'reply_to_message',
        title: `Reply with listing: ${keyword}`,
        description: `Send completion notice to Discord channel`,
        complexity: 'low',
        rolePreference: 'any',
        type: 'discord',
        payload: {
          channelId,
          messageId,
          content: `Product workflow started for "${keyword}".`
        }
      }
    ],
    shouldPlan: true
  });

  // Mark the command trigger task as resolved so polling does not re-deliver it.
  sendTaskAck(task.id, 'done', task.retries || 0, {
    success: true,
    workflowId: workflow.id,
    note: 'Converted command task into workflow'
  });

  return workflow;
}

function inferPriorityFromDiscord(event) {
  const eventType = (event.type || '').toLowerCase();
  const title = (event.title || '').toLowerCase();

  if (eventType === 'mention' || eventType === 'command' || title.includes('mention') || title.includes('command')) {
    return 2;
  }

  if (eventType === 'log' || eventType === 'passive' || title.includes('log') || title.includes('passive')) {
    return 0;
  }

  return 1;
}

function inferPriorityFromShopify(event) {
  const eventType = (event.type || '').toLowerCase();
  const title = (event.title || '').toLowerCase();

  if (eventType === 'order' || title.includes('order')) {
    return 2;
  }

  if (eventType === 'log' || eventType === 'passive' || title.includes('log') || title.includes('passive')) {
    return 0;
  }

  return 1;
}

function createDiscordTask(event) {
  return {
    id: generateId(),
    type: 'discord',
    title: event.title || 'Discord Event',
    priority: inferPriorityFromDiscord(event),
    progress: 0,
    required: randomInRange(80, 200),
    status: 'pending',
    action: 'reply_to_message',
    payload: {
      channelId: event.channelId || 'unknown-channel',
      messageId: event.messageId || generateId(),
      content: event.content || 'Automated response generated by simulation.'
    },
    meta: event
  };
}

function createShopifyTask(event) {
  return {
    id: generateId(),
    type: 'shopify',
    title: event.title || 'Shopify Event',
    priority: inferPriorityFromShopify(event),
    progress: 0,
    required: randomInRange(120, 260),
    status: 'pending',
    action: 'process_order',
    payload: {
      orderId: event.orderId || `order-${generateId()}`
    },
    meta: event
  };
}

async function executeDiscordTask(task) {
  if (!task || !task.id) {
    return { success: false, error: 'Missing task id' };
  }

  try {
    const response = await fetch(`/task/${encodeURIComponent(task.id)}/execute`, {
      method: 'POST'
    });

    if (!response.ok) {
      return { success: false, error: `execute_${response.status}` };
    }

    const data = await response.json();
    return data && data.result ? data.result : { success: false, error: 'Invalid execute response' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

const tools = {
  discord: {
    async reply(payload, context) {
      const listing = context && context.create_product_listing && context.create_product_listing.output;
      const keyword = context && context.keyword ? context.keyword : 'product';
      let content = payload && payload.content ? payload.content : 'Automated response generated by simulation.';

      if (listing && listing.success) {
        content = `Done: ${listing.title} (${listing.listingId}) for keyword "${keyword}".`;
      }

      const task = {
        id: (payload && payload.taskId) || generateId(),
        type: 'discord',
        action: 'reply_to_message',
        payload: {
          channelId: payload && payload.channelId ? payload.channelId : null,
          messageId: payload && payload.messageId ? payload.messageId : null,
          content
        }
      };

      const result = await executeDiscordTask(task);
      if (result && result.success) {
        return { success: true, data: result };
      }

      return {
        success: false,
        error: result && result.error ? result.error : 'discord_reply_failed',
        data: result || null
      };
    }
  },
  shopify: {
    process_order(payload) {
      console.log('[SHOPIFY ACTION]', 'process_order', payload);
      return { success: true, data: { processed: true } };
    },
    generate_design_prompt(payload, context) {
      const keyword = (payload && payload.keyword) || (context && context.keyword) || 'unknown-product';
      const research = context && context.research_product && context.research_product.output;
      return {
        success: true,
        data: {
          keyword,
          prompt: `Design a product visual for ${keyword}. Insights: ${research ? research.findings.join('; ') : 'general market fit'}`
        }
      };
    },
    create_product_listing(payload, context) {
      const keyword = (payload && payload.keyword) || (context && context.keyword) || 'unknown-product';
      const promptData = context && context.generate_design_prompt && context.generate_design_prompt.output;
      const imageData = context && context.generate_mock_image && context.generate_mock_image.output;

      return {
        success: true,
        data: {
          listingId: `listing-${generateId()}`,
          title: `${keyword} - Automated Listing`,
          description: promptData ? promptData.prompt : `Automated listing for ${keyword}`,
          imageUrl: imageData ? imageData.imageUrl : null
        }
      };
    }
  },
  image: {
    generate(payload, context) {
      const keyword = (payload && payload.keyword) || (context && context.keyword) || 'unknown-product';
      return {
        success: true,
        data: {
          keyword,
          imageUrl: `mock://${keyword.replace(/\s+/g, '-').toLowerCase()}-v1.png`
        }
      };
    }
  },
  research: {
    query(payload, context) {
      const keyword = (payload && payload.keyword) || (context && context.keyword) || 'unknown-product';
      return {
        success: true,
        data: {
          keyword,
          findings: [`Trend around ${keyword}`, `Audience notes for ${keyword}`]
        }
      };
    }
  }
};

function resolveTool(toolName) {
  if (!toolName || typeof toolName !== 'string') {
    return null;
  }

  const segments = toolName.split('.');
  let current = tools;

  for (const segment of segments) {
    if (!current || typeof current !== 'object') {
      return null;
    }

    current = current[segment];
  }

  return typeof current === 'function' ? current : null;
}

function normalizeToolResult(result) {
  if (result && typeof result === 'object' && typeof result.success === 'boolean') {
    return {
      success: result.success,
      data: result.data,
      error: result.error
    };
  }

  return {
    success: false,
    error: 'invalid_tool_result'
  };
}

function inferToolNameForTask(task) {
  if (task && task.tool) {
    return task.tool;
  }

  if (task && task.action && ACTION_TOOL_MAP[task.action]) {
    return ACTION_TOOL_MAP[task.action];
  }

  if (task && task.type === 'discord') {
    return 'discord.reply';
  }

  if (task && task.type === 'shopify') {
    return 'shopify.process_order';
  }

  return null;
}

async function executeTool(toolName, payload, context) {
  const tool = resolveTool(toolName);
  if (!tool) {
    return { success: false, error: `tool_not_found:${toolName}` };
  }

  try {
    const result = await tool(payload || {}, context || {});
    return normalizeToolResult(result);
  } catch (error) {
    return {
      success: false,
      error: error && error.message ? error.message : 'tool_execution_failed'
    };
  }
}

async function executeTask(task) {
  if (!task || !task.type) {
    return { success: false, error: 'Invalid task' };
  }

  const payload = task.payload && typeof task.payload === 'object' ? { ...task.payload } : {};
  const context = payload.context && typeof payload.context === 'object' ? payload.context : {};
  const toolName = inferToolNameForTask(task);

  if (!toolName) {
    return { success: false, error: `Unsupported task type: ${task.type}` };
  }

  const toolResult = await executeTool(toolName, {
    ...payload,
    taskId: task.id
  }, context);

  if (!toolResult.success) {
    return {
      success: false,
      error: toolResult.error || 'tool_execution_failed'
    };
  }

  return {
    success: true,
    ...(toolResult.data && typeof toolResult.data === 'object' ? toolResult.data : { data: toolResult.data })
  };
}

function normalizePriority(priority, task) {
  if (priority === 0 || priority === 1 || priority === 2) {
    return priority;
  }

  return inferDefaultPriority(task);
}

function findBestDeskForTask(task) {
  const sameTypeProcessingDesks = desks.filter((desk) => desk.currentTask && desk.currentTask.type === task.type);
  const deskPool = sameTypeProcessingDesks.length > 0 ? sameTypeProcessingDesks : desks;

  let bestDesk = deskPool[0] || null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const desk of deskPool) {
    const score = getDeskLoadScore(desk);
    if (score < bestScore) {
      bestScore = score;
      bestDesk = desk;
    }
  }

  return bestDesk;
}

function normalizeTask(task) {
  const payload = task.payload && typeof task.payload === 'object' ? { ...task.payload } : {};

  if (task.workflowContextInput && payload.context === undefined) {
    payload.context = cloneContext(task.workflowContextInput);
  }

  return {
    id: task.id ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: task.type ?? 'discord',
    tool: task.tool ?? null,
    title: task.title ?? 'Untitled task',
    progress: task.progress ?? 0,
    required: task.required ?? 100,
    priority: normalizePriority(task.priority, task),
    status: task.status ?? 'pending',
    action: task.action ?? null,
    payload,
    retries: task.retries ?? 0,
    maxRetries: task.maxRetries ?? 3,
    workflowId: task.workflowId ?? null,
    workflowStepIndex: typeof task.workflowStepIndex === 'number' ? task.workflowStepIndex : null,
    workflowContextInput: task.workflowContextInput ? cloneContext(task.workflowContextInput) : null
  };
}

async function sendTaskAck(taskId, status, retries, executionResult) {
  if (!taskId) {
    return;
  }

  try {
    await fetch(`/task/${encodeURIComponent(taskId)}/ack`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        status,
        retries,
        executionResult
      })
    });
  } catch (error) {
    console.warn('[TASK]', 'ack_error', taskId, error && error.message);
  }
}

function syncTaskStart(task, attempt = 0) {
  if (!task || !task.id || task._startedSynced) {
    return;
  }

  task._startedSynced = true;

  fetch(`/task/${encodeURIComponent(task.id)}/start`, {
    method: 'POST'
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`start_sync_${response.status}`);
      }
    })
    .catch((error) => {
      task._startedSynced = false;
      console.warn('[TASK]', 'start_sync_error', task.id, error && error.message);

      if (attempt < 2) {
        window.setTimeout(() => {
          syncTaskStart(task, attempt + 1);
        }, 500 * (attempt + 1));
      }
    });
}

function hasTaskInSimulation(taskId) {
  if (!taskId) {
    return false;
  }

  for (const desk of desks) {
    if (desk.currentTask && desk.currentTask.id === taskId) {
      return true;
    }

    if (desk.queue.some((queuedTask) => queuedTask.id === taskId)) {
      return true;
    }
  }

  return false;
}

function handleTaskExecutionResult(desk, task) {
  if (Math.random() < TASK_EXECUTION_FAILURE_CHANCE) {
    task.retries += 1;

    if (task.retries < task.maxRetries) {
      task.status = 'pending';
      task.progress = 0;
      desk.queue.unshift(task);
      console.log('[TASK]', 'retry', task.type, task.title, `${task.retries}/${task.maxRetries}`);
    } else {
      task.status = 'failed';
      desk.failedTasks += 1;
      desk.lastFailedTask = task;
      console.log('[TASK]', 'failed', task.type, task.title);
      emitEvent('TASK_COMPLETED', {
        taskId: task.id,
        taskType: task.type,
        deskIndex: desks.indexOf(desk),
        success: false,
        reason: 'max_retries_reached'
      });
      const failureResult = { success: false, error: 'max_retries_reached' };
      applyWorkflowTaskCompletion(task, failureResult);
      sendTaskAck(task.id, 'failed', task.retries, failureResult);
    }

    desk.currentTask = null;
    return;
  }

  task.status = 'done';
  console.log('[TASK]', 'completed', task.type, task.title);

  executeTask(task)
    .then((executionResult) => {
      emitEvent('TASK_COMPLETED', {
        taskId: task.id,
        taskType: task.type,
        deskIndex: desks.indexOf(desk),
        success: !(executionResult && executionResult.success === false),
        error: executionResult && executionResult.success === false ? executionResult.error : null
      });
      applyWorkflowTaskCompletion(task, executionResult);
      const ackStatus = executionResult && executionResult.success === false ? 'failed' : 'done';
      sendTaskAck(task.id, ackStatus, task.retries, executionResult || { success: false, error: 'Missing execution result' });
    })
    .catch((error) => {
      emitEvent('TASK_COMPLETED', {
        taskId: task.id,
        taskType: task.type,
        deskIndex: desks.indexOf(desk),
        success: false,
        error: error && error.message ? error.message : 'Execution failed'
      });
      const failureResult = { success: false, error: error && error.message ? error.message : 'Execution failed' };
      applyWorkflowTaskCompletion(task, failureResult);
      sendTaskAck(task.id, 'failed', task.retries, failureResult);
    });

  desk.currentTask = null;
  desk.completedTasks += 1;
}

function addTaskToDesk(task) {
  const normalizedTask = normalizeTask(task);
  if (hasTaskInSimulation(normalizedTask.id)) {
    return null;
  }

  const desk = findBestDeskForTask(normalizedTask);
  if (!desk) {
    return null;
  }

  normalizedTask.status = 'pending';
  desk.queue.push(normalizedTask);
  desk.queue.sort((a, b) => b.priority - a.priority);
  console.log('[TASK]', 'added', normalizedTask.type, normalizedTask.title);
  emitEvent('TASK_CREATED', {
    taskId: normalizedTask.id,
    taskType: normalizedTask.type,
    deskIndex: desks.indexOf(desk),
    priority: normalizedTask.priority,
    workflowId: normalizedTask.workflowId || null
  });
  return desk;
}

function ingestTask(task) {
  if (!task || !task.type) {
    return;
  }

  if (task.type === 'discord' && task.action === 'start_product_workflow') {
    createProductWorkflowFromTask(task);
    return;
  }

  addTaskToDesk(task);
}

function simulateIncomingTasks() {
  if (!window.DEV_MODE) {
    return;
  }
  
  if (Math.random() < 0.02) {
    ingestTask(createDiscordTask({
      title: 'New command',
      type: 'command'
    }));
  }

  if (Math.random() < 0.01) {
    ingestTask(createShopifyTask({
      title: 'New order',
      type: 'order'
    }));
  }
}

let bridgeLastEventId = 0;
let bridgePollingStarted = false;

async function pollBridgeTasks() {
  try {
    const response = await fetch(`/events?after=${bridgeLastEventId}`);
    if (!response.ok) {
      return;
    }

    const data = await response.json();
    if (!data || !Array.isArray(data.events)) {
      return;
    }

    for (const event of data.events) {
      if (typeof event.id === 'number') {
        bridgeLastEventId = Math.max(bridgeLastEventId, event.id);
      }

      if (event.task) {
        ingestTask(event.task);
      }
    }
  } catch (error) {
    console.warn('[BRIDGE]', 'poll_error', error && error.message);
  }
}

function startBridgePolling() {
  if (bridgePollingStarted) {
    return;
  }

  bridgePollingStarted = true;
  pollBridgeTasks();
  window.setInterval(pollBridgeTasks, BRIDGE_POLL_INTERVAL_MS);
}

function sanitizeTaskForView(task) {
  if (!task) {
    return null;
  }

  return {
    id: task.id,
    type: task.type,
    title: task.title,
    status: task.status,
    priority: task.priority,
    progress: task.progress,
    required: task.required,
    action: task.action || null,
    tool: task.tool || null,
    workflowId: task.workflowId || null,
    workflowStepIndex: typeof task.workflowStepIndex === 'number' ? task.workflowStepIndex : null
  };
}

function captureRuntimeSnapshot() {
  return {
    agents: agents.map((agent) => ({
      id: agent.id,
      role: agent.role,
      state: agent.state,
      targetDeskIndex: agent.targetDesk ? desks.indexOf(agent.targetDesk) : null,
      position: { x: Math.round(agent.x), y: Math.round(agent.y) }
    })),
    desks: desks.map((desk, index) => ({
      id: index,
      paused: !!desk.paused,
      occupied: desk.occupied,
      queueLength: desk.queue.length,
      hasCurrentTask: !!desk.currentTask
    })),
    workflows: listWorkflows().map((workflow) => ({
      id: workflow.id,
      status: workflow.status,
      currentStepIndex: workflow.currentStep ? workflow.currentStep.index : null
    })),
    taskCount: getTasks().length
  };
}

function computeStateDiff(beforeSnapshot, afterSnapshot) {
  const diff = {};
  for (const key of Object.keys(afterSnapshot)) {
    const beforeValue = JSON.stringify(beforeSnapshot[key]);
    const afterValue = JSON.stringify(afterSnapshot[key]);
    if (beforeValue !== afterValue) {
      diff[key] = {
        before: beforeSnapshot[key],
        after: afterSnapshot[key]
      };
    }
  }

  return Object.keys(diff).length > 0 ? diff : null;
}

function summarizeResult(result) {
  if (!result) {
    return 'no_result';
  }

  if (!result.success) {
    return result.error || 'failed';
  }

  if (result.command) {
    return `${result.command}:ok`;
  }

  return 'ok';
}

function recordCommandHistory(commandString, parsedCommand, result, affectedEntities, stateDiff) {
  commandHistory.push({
    command: commandString,
    timestamp: Date.now(),
    success: !!(result && result.success),
    parsed: parsedCommand,
    affectedEntities: affectedEntities || {},
    resultSummary: summarizeResult(result),
    stateDiff: stateDiff || null
  });

  if (commandHistory.length > 1000) {
    commandHistory.shift();
  }
}

function inspectAgent(id) {
  const agentId = Number(id);
  const agent = agents.find((candidate) => candidate.id === agentId);
  if (!agent) {
    return null;
  }

  return {
    id: agent.id,
    role: agent.role,
    state: agent.state,
    position: { x: Math.round(agent.x), y: Math.round(agent.y) },
    targetDeskIndex: agent.targetDesk ? desks.indexOf(agent.targetDesk) : null,
    speed: agent.speed,
    productivity: agent.productivity,
    skills: { ...agent.skills }
  };
}

function inspectDesk(id) {
  const deskIndex = Number(id);
  const desk = desks[deskIndex];
  if (!desk) {
    return null;
  }

  return {
    id: deskIndex,
    paused: !!desk.paused,
    occupied: desk.occupied,
    queueLength: desk.queue.length,
    completedTasks: desk.completedTasks,
    failedTasks: desk.failedTasks,
    currentTask: sanitizeTaskForView(desk.currentTask),
    queuedTasks: desk.queue.map((task) => sanitizeTaskForView(task))
  };
}

function inspectWorkflow(id) {
  return getWorkflow(id);
}

function injectTask(task) {
  if (!task || typeof task !== 'object') {
    return { success: false, error: 'invalid_task' };
  }

  const mergedTask = {
    id: task.id || `manual-${generateId()}`,
    ...task
  };

  const desk = addTaskToDesk(mergedTask);
  if (!desk) {
    return { success: false, error: 'task_injection_rejected' };
  }

  emitEvent('TASK_CREATED', {
    source: 'control_api',
    taskId: mergedTask.id,
    taskType: mergedTask.type || 'discord',
    deskIndex: desks.indexOf(desk)
  });

  return { success: true, data: sanitizeTaskForView(mergedTask) };
}

function getTasks() {
  const tasks = [];
  for (let deskIndex = 0; deskIndex < desks.length; deskIndex += 1) {
    const desk = desks[deskIndex];
    if (desk.currentTask) {
      tasks.push({ deskIndex, lane: 'current', task: sanitizeTaskForView(desk.currentTask) });
    }

    for (const queuedTask of desk.queue) {
      tasks.push({ deskIndex, lane: 'queue', task: sanitizeTaskForView(queuedTask) });
    }
  }

  return tasks;
}

function getDeskState() {
  return desks.map((desk, index) => ({
    id: index,
    paused: !!desk.paused,
    occupied: desk.occupied,
    queueLength: desk.queue.length,
    completedTasks: desk.completedTasks,
    failedTasks: desk.failedTasks,
    currentTask: sanitizeTaskForView(desk.currentTask)
  }));
}

function getAgents() {
  return agents.map((agent) => inspectAgent(agent.id));
}

function moveAgent(agentId, deskIndex) {
  const agent = agents.find((candidate) => candidate.id === Number(agentId));
  const desk = desks[Number(deskIndex)];

  if (!agent) {
    return { success: false, error: 'agent_not_found' };
  }

  if (!desk) {
    return { success: false, error: 'desk_not_found' };
  }

  if (!isDeskAvailableForAgent(desk, agent)) {
    return { success: false, error: 'desk_occupied' };
  }

  clearAgentTarget(agent);
  desk.occupied = true;
  desk.occupant = agent;
  agent.targetDesk = desk;
  agent.targetSlot = desk.slots.seat;
  const seatPosition = getDeskSlotPosition(desk, 'seat');
  agent.targetX = seatPosition.x;
  agent.targetY = seatPosition.y;
  agent.state = 'moving';
  agent.stateTimer = 0;
  agent.wanderTimer = 0;
  agent.targetRetryTimer = 0;

  emitEvent('AGENT_MOVED', {
    agentId: agent.id,
    deskIndex: Number(deskIndex)
  });

  return { success: true, data: inspectAgent(agent.id) };
}

function setAgentRole(agentId, role) {
  const agent = agents.find((candidate) => candidate.id === Number(agentId));
  if (!agent) {
    return { success: false, error: 'agent_not_found' };
  }

  if (role !== 'researcher' && role !== 'executor' && role !== 'other') {
    return { success: false, error: 'invalid_role' };
  }

  agent.role = role;
  if (role === 'researcher') {
    agent.skills.discord = 1.5;
    agent.skills.shopify = 0.9;
  } else if (role === 'executor') {
    agent.skills.discord = 0.9;
    agent.skills.shopify = 1.5;
  } else {
    agent.skills.discord = 1;
    agent.skills.shopify = 1;
  }

  emitEvent('AGENT_ROLE_CHANGED', {
    agentId: agent.id,
    role: agent.role
  });

  return { success: true, data: inspectAgent(agent.id) };
}

function pauseDesk(deskId) {
  const desk = desks[Number(deskId)];
  if (!desk) {
    return { success: false, error: 'desk_not_found' };
  }

  desk.paused = true;
  emitEvent('DESK_PAUSED', {
    deskId: Number(deskId)
  });

  return { success: true, data: inspectDesk(deskId) };
}

function resumeDesk(deskId) {
  const desk = desks[Number(deskId)];
  if (!desk) {
    return { success: false, error: 'desk_not_found' };
  }

  desk.paused = false;
  emitEvent('DESK_RESUMED', {
    deskId: Number(deskId)
  });

  return { success: true, data: inspectDesk(deskId) };
}

function getWorkflowsControl() {
  return listWorkflows();
}

function approveWorkflow(workflowId) {
  const workflow = workflows.get(workflowId);
  if (!workflow) {
    return { success: false, error: 'workflow_not_found' };
  }

  if (workflow.status !== 'pending_approval') {
    return { success: false, error: 'workflow_not_pending_approval' };
  }

  const success = enqueueAllWorkflowSteps(workflowId);
  if (!success) {
    return { success: false, error: 'failed_to_enqueue_steps' };
  }

  emitEvent('WORKFLOW_APPROVED', {
    workflowId,
    stepCount: workflow.steps.length
  });

  return { success: true, data: getWorkflow(workflowId) };
}

function rejectWorkflow(workflowId, reason) {
  const workflow = workflows.get(workflowId);
  if (!workflow) {
    return { success: false, error: 'workflow_not_found' };
  }

  if (workflow.status !== 'pending_approval') {
    return { success: false, error: 'workflow_not_pending_approval' };
  }

  workflow.status = 'rejected';
  workflow.failedAt = Date.now();

  emitEvent('WORKFLOW_REJECTED', {
    workflowId,
    reason: reason || 'user_rejection'
  });

  return { success: true, data: getWorkflow(workflowId) };
}

function editWorkflowStep(workflowId, stepId, patch) {
  const workflow = workflows.get(workflowId);
  if (!workflow) {
    return { success: false, error: 'workflow_not_found' };
  }

  if (workflow.status !== 'pending_approval') {
    return { success: false, error: 'workflow_not_pending_approval' };
  }

  const stepIndex = Number(stepId.replace('step-', ''));
  if (isNaN(stepIndex) || stepIndex < 0 || stepIndex >= workflow.steps.length) {
    return { success: false, error: 'invalid_step_id' };
  }

  const step = workflow.steps[stepIndex];
  if (patch && typeof patch === 'object') {
    Object.assign(step, patch);
  }

  if (workflow.plan && workflow.plan[stepIndex]) {
    Object.assign(workflow.plan[stepIndex], patch);
  }

  return { success: true, data: { stepIndex, step } };
}

const controlAPI = {
  injectTask,
  getTasks,
  getDeskState,
  getAgents,
  moveAgent,
  setAgentRole,
  pauseDesk,
  resumeDesk,
  getWorkflows: getWorkflowsControl,
  inspectWorkflow,
  approveWorkflow,
  rejectWorkflow,
  editWorkflowStep
};

function parseCommandInput(inputString) {
  const input = String(inputString || '').trim();
  if (!input) {
    return { success: false, error: 'empty_command' };
  }

  const injectMatch = input.match(/^inject\s+(discord|shopify)\s+"([\s\S]+)"$/i);
  if (injectMatch) {
    return {
      success: true,
      command: 'inject',
      type: injectMatch[1].toLowerCase(),
      message: injectMatch[2]
    };
  }

  const spawnWorkflowMatch = input.match(/^spawn\s+workflow\s+product\s+(.+)$/i);
  if (spawnWorkflowMatch) {
    return {
      success: true,
      command: 'spawn_workflow_product',
      keyword: spawnWorkflowMatch[1].trim()
    };
  }

  const inspectAgentMatch = input.match(/^inspect\s+agent\s+(\d+)$/i);
  if (inspectAgentMatch) {
    return { success: true, command: 'inspect_agent', agentId: Number(inspectAgentMatch[1]) };
  }

  const pauseDeskMatch = input.match(/^pause\s+desk\s+(\d+)$/i);
  if (pauseDeskMatch) {
    return { success: true, command: 'pause_desk', deskId: Number(pauseDeskMatch[1]) };
  }

  const resumeDeskMatch = input.match(/^resume\s+desk\s+(\d+)$/i);
  if (resumeDeskMatch) {
    return { success: true, command: 'resume_desk', deskId: Number(resumeDeskMatch[1]) };
  }

  const inspectDeskMatch = input.match(/^inspect\s+desk\s+(\d+)$/i);
  if (inspectDeskMatch) {
    return { success: true, command: 'inspect_desk', deskId: Number(inspectDeskMatch[1]) };
  }

  const inspectWorkflowMatch = input.match(/^inspect\s+workflow\s+(.+)$/i);
  if (inspectWorkflowMatch) {
    return { success: true, command: 'inspect_workflow', workflowId: inspectWorkflowMatch[1].trim() };
  }

  const approveWorkflowMatch = input.match(/^approve\s+workflow\s+(.+)$/i);
  if (approveWorkflowMatch) {
    return { success: true, command: 'approve_workflow', workflowId: approveWorkflowMatch[1].trim() };
  }

  const rejectWorkflowMatch = input.match(/^reject\s+workflow\s+(.+?)(?:\s+(.+))?$/i);
  if (rejectWorkflowMatch) {
    return { 
      success: true, 
      command: 'reject_workflow', 
      workflowId: rejectWorkflowMatch[1].trim(),
      reason: rejectWorkflowMatch[2] ? rejectWorkflowMatch[2].trim() : null
    };
  }

  return { success: false, error: 'unknown_command' };
}

function dispatchCommand(inputString) {
  const beforeSnapshot = captureRuntimeSnapshot();
  const parsed = parseCommandInput(inputString);
  if (!parsed.success) {
    const failedResult = { success: false, command: 'parse', error: parsed.error };
    recordCommandHistory(String(inputString || ''), parsed, failedResult, {}, null);
    return failedResult;
  }

  let result;
  let affectedEntities = {};

  if (parsed.command === 'inject') {
    if (parsed.type === 'discord') {
      result = {
        command: 'inject',
        ...controlAPI.injectTask(createDiscordTask({ title: 'Manual inject', type: 'command', content: parsed.message }))
      };
      affectedEntities = {
        tasks: result && result.data && result.data.id ? [result.data.id] : []
      };
      const afterSnapshot = captureRuntimeSnapshot();
      recordCommandHistory(String(inputString || ''), parsed, result, affectedEntities, computeStateDiff(beforeSnapshot, afterSnapshot));
      return result;
    }

    result = {
      command: 'inject',
      ...controlAPI.injectTask(createShopifyTask({ title: parsed.message, type: 'order' }))
    };
    affectedEntities = {
      tasks: result && result.data && result.data.id ? [result.data.id] : []
    };
    const afterSnapshot = captureRuntimeSnapshot();
    recordCommandHistory(String(inputString || ''), parsed, result, affectedEntities, computeStateDiff(beforeSnapshot, afterSnapshot));
    return result;
  }

  if (parsed.command === 'spawn_workflow_product') {
    const workflow = createProductWorkflowFromTask({
      id: `manual-cmd-${generateId()}`,
      type: 'discord',
      action: 'start_product_workflow',
      payload: {
        args: [parsed.keyword],
        channelId: null,
        messageId: null
      }
    });

    result = {
      success: true,
      command: 'spawn_workflow_product',
      data: workflow ? getWorkflow(workflow.id) : null
    };
    affectedEntities = {
      workflows: workflow ? [workflow.id] : []
    };
    const afterSnapshot = captureRuntimeSnapshot();
    recordCommandHistory(String(inputString || ''), parsed, result, affectedEntities, computeStateDiff(beforeSnapshot, afterSnapshot));
    return result;
  }

  if (parsed.command === 'inspect_agent') {
    const data = inspectAgent(parsed.agentId);
    result = { success: !!data, command: 'inspect_agent', data, error: data ? undefined : 'agent_not_found' };
    affectedEntities = { agents: [parsed.agentId] };
    const afterSnapshot = captureRuntimeSnapshot();
    recordCommandHistory(String(inputString || ''), parsed, result, affectedEntities, computeStateDiff(beforeSnapshot, afterSnapshot));
    return result;
  }

  if (parsed.command === 'inspect_desk') {
    const data = inspectDesk(parsed.deskId);
    result = { success: !!data, command: 'inspect_desk', data, error: data ? undefined : 'desk_not_found' };
    affectedEntities = { desks: [parsed.deskId] };
    const afterSnapshot = captureRuntimeSnapshot();
    recordCommandHistory(String(inputString || ''), parsed, result, affectedEntities, computeStateDiff(beforeSnapshot, afterSnapshot));
    return result;
  }

  if (parsed.command === 'inspect_workflow') {
    const data = controlAPI.inspectWorkflow(parsed.workflowId);
    result = { success: !!data, command: 'inspect_workflow', data, error: data ? undefined : 'workflow_not_found' };
    affectedEntities = { workflows: [parsed.workflowId] };
    const afterSnapshot = captureRuntimeSnapshot();
    recordCommandHistory(String(inputString || ''), parsed, result, affectedEntities, computeStateDiff(beforeSnapshot, afterSnapshot));
    return result;
  }

  if (parsed.command === 'pause_desk') {
    result = {
      command: 'pause_desk',
      ...controlAPI.pauseDesk(parsed.deskId)
    };
    affectedEntities = { desks: [parsed.deskId] };
    const afterSnapshot = captureRuntimeSnapshot();
    recordCommandHistory(String(inputString || ''), parsed, result, affectedEntities, computeStateDiff(beforeSnapshot, afterSnapshot));
    return result;
  }

  if (parsed.command === 'resume_desk') {
    result = {
      command: 'resume_desk',
      ...controlAPI.resumeDesk(parsed.deskId)
    };
    affectedEntities = { desks: [parsed.deskId] };
    const afterSnapshot = captureRuntimeSnapshot();
    recordCommandHistory(String(inputString || ''), parsed, result, affectedEntities, computeStateDiff(beforeSnapshot, afterSnapshot));
    return result;
  }

  if (parsed.command === 'approve_workflow') {
    const approval = approveWorkflow(parsed.workflowId);
    result = {
      success: approval.success,
      command: 'approve_workflow',
      data: approval.data,
      error: approval.error
    };
    affectedEntities = { workflows: [parsed.workflowId] };
    const afterSnapshot = captureRuntimeSnapshot();
    recordCommandHistory(String(inputString || ''), parsed, result, affectedEntities, computeStateDiff(beforeSnapshot, afterSnapshot));
    return result;
  }

  if (parsed.command === 'reject_workflow') {
    const rejection = rejectWorkflow(parsed.workflowId, parsed.reason);
    result = {
      success: rejection.success,
      command: 'reject_workflow',
      data: rejection.data,
      error: rejection.error
    };
    affectedEntities = { workflows: [parsed.workflowId] };
    const afterSnapshot = captureRuntimeSnapshot();
    recordCommandHistory(String(inputString || ''), parsed, result, affectedEntities, computeStateDiff(beforeSnapshot, afterSnapshot));
    return result;
  }

  result = { success: false, command: parsed.command, error: 'unsupported_command' };
  const afterSnapshot = captureRuntimeSnapshot();
  recordCommandHistory(String(inputString || ''), parsed, result, affectedEntities, computeStateDiff(beforeSnapshot, afterSnapshot));
  return result;
}

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

function hasAnyDeskTasks() {
  return desks.some((desk) => desk.currentTask || desk.queue.length > 0);
}

function releaseDesk(desk, agent) {
  if (desk.occupant === agent) {
    desk.occupied = false;
    desk.occupant = null;
  }
}

function clearAgentTarget(agent, { releaseDesk: shouldReleaseDesk = true } = {}) {
  if (shouldReleaseDesk && agent.targetDesk && agent.targetDesk.occupant === agent) {
    releaseDesk(agent.targetDesk, agent);
  }

  agent.targetDesk = null;
  agent.targetSlot = null;
  agent.targetX = null;
  agent.targetY = null;
}

function scheduleTargetRetry(agent) {
  clearAgentTarget(agent);
  agent.targetRetryTimer = TARGET_RETRY_DELAY;
  agent.wanderTimer = 0;
  agent.stateTimer = 0;
  agent.animationFrame = 0;
  agent.animationTimer = 0;
  agent.state = 'idle';
}

function setRandomWanderTarget(agent) {
  agent.targetDesk = null;
  agent.targetSlot = null;
  agent.targetX = randomInRange(24, canvas.width - 24);
  agent.targetY = randomInRange(24, canvas.height - 24);
  agent.wanderTimer = WANDER_TARGET_INTERVAL;
}

function claimNextTask(desk) {
  if (desk.paused) {
    return desk.currentTask;
  }

  if (desk.currentTask || desk.queue.length === 0) {
    return desk.currentTask;
  }

  const nextTask = desk.queue.shift();
  nextTask.status = 'processing';
  syncTaskStart(nextTask);
  desk.currentTask = nextTask;
  console.log('[TASK]', 'started', nextTask.type, nextTask.title);
  emitEvent('TASK_STARTED', {
    taskId: nextTask.id,
    taskType: nextTask.type,
    deskIndex: desks.indexOf(desk),
    workflowId: nextTask.workflowId || null
  });
  return nextTask;
}

function observeAgentStateChanges() {
  for (const agent of agents) {
    const previousState = agentStateTracker.get(agent.id);
    if (previousState !== agent.state) {
      emitEvent('AGENT_STATE_CHANGED', {
        agentId: agent.id,
        previousState: previousState || null,
        state: agent.state
      });
      agentStateTracker.set(agent.id, agent.state);
    }
  }
}

function findNearestAvailableDesk(agent, { requireTasks = false } = {}) {
  let nearest = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const desk of desks) {
    if (!isDeskAvailableForAgent(desk, agent)) {
      continue;
    }

    if (requireTasks && !desk.currentTask && desk.queue.length === 0) {
      continue;
    }

    const seatPosition = getDeskSlotPosition(desk, 'seat');
    const dx = seatPosition.x - agent.x;
    const dy = seatPosition.y - agent.y;
    const distance = Math.hypot(dx, dy);

    if (distance < bestDistance) {
      bestDistance = distance;
      nearest = desk;
    }
  }

  return nearest;
}

function trySit(agent) {
  const desk = agent.targetDesk;
  if (!desk || desk.occupant !== agent) {
    scheduleTargetRetry(agent);
    return false;
  }

  const seatPosition = getDeskSlotPosition(desk, 'seat');
  const distance = Math.hypot(agent.x - seatPosition.x, agent.y - seatPosition.y);
  if (distance > 3) {
    return false;
  }

  agent.x = seatPosition.x;
  agent.y = seatPosition.y;
  agent.state = 'sitting';
  agent.stateTimer = 0;
  agent.animationFrame = 0;
  agent.animationTimer = 0;
  return true;
}

function assignAgentTarget(agent) {
  const desk = findNearestAvailableDesk(agent, { requireTasks: true });
  if (desk) {
    desk.occupied = true;
    desk.occupant = agent;
    agent.targetDesk = desk;
    agent.targetSlot = desk.slots.seat;

    const seatPosition = getDeskSlotPosition(desk, 'seat');
    agent.targetX = seatPosition.x;
    agent.targetY = seatPosition.y;
    agent.state = 'moving';
    agent.stateTimer = 0;
    agent.wanderTimer = 0;
    agent.targetRetryTimer = 0;
    return true;
  }

  const anyTasks = hasAnyDeskTasks();
  if (anyTasks) {
    agent.targetRetryTimer = TARGET_RETRY_DELAY;
    agent.state = 'idle';
    return false;
  }

  scheduleTargetRetry(agent);
  return false;
}

class AssetLoader {
  constructor() {
    this.assets = {};
  }

  loadImage(path) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load: ${path}`));
      img.src = path;
    });
  }

  async loadAll(paths) {
    for (const path of paths) {
      const filename = path.split('/').pop();
      const image = await this.loadImage(path);
      this.assets[filename] = image;
      console.log(`Loaded asset: ${filename}`);
    }

    return this.assets;
  }
}

const assetPaths = [
  'assets/free-office-pixel-art/Chair.png',
  'assets/free-office-pixel-art/Julia-Idle.png',
  'assets/free-office-pixel-art/Julia.png',
  'assets/free-office-pixel-art/Julia_Drinking_Coffee.png',
  'assets/free-office-pixel-art/Julia_PC.png',
  'assets/free-office-pixel-art/Julia_walk_Foward.png',
  'assets/free-office-pixel-art/Julia_walk_Left.png',
  'assets/free-office-pixel-art/Julia_walk_Rigth.png',
  'assets/free-office-pixel-art/Julia_walk_Up.png',
  'assets/free-office-pixel-art/PC1.png',
  'assets/free-office-pixel-art/PC2.png',
  'assets/free-office-pixel-art/Trash.png',
  'assets/free-office-pixel-art/boss.png',
  'assets/free-office-pixel-art/cabinet.png',
  'assets/free-office-pixel-art/coffee-maker.png',
  'assets/free-office-pixel-art/desk-with-pc.png',
  'assets/free-office-pixel-art/desk.png',
  'assets/free-office-pixel-art/office-partitions-1.png',
  'assets/free-office-pixel-art/office-partitions-2.png',
  'assets/free-office-pixel-art/plant.png',
  'assets/free-office-pixel-art/printer.png',
  'assets/free-office-pixel-art/sink.png',
  'assets/free-office-pixel-art/stamping-table.png',
  'assets/free-office-pixel-art/water-cooler.png',
  'assets/free-office-pixel-art/worker1.png',
  'assets/free-office-pixel-art/worker2.png',
  'assets/free-office-pixel-art/worker4.png',
  'assets/free-office-pixel-art/writing-table.png'
];

const assetLoader = new AssetLoader();
const loadedAssets = {};
assetLoader
  .loadAll(assetPaths)
  .then((assets) => {
    Object.assign(loadedAssets, assets);
    console.log('Loaded asset filenames:', Object.keys(assets));
  })
  .catch((error) => {
    console.error('Asset loading failed:', error.message);
  });

// Dev-only initial tasks - disabled by default, enable with window.DEV_MODE = true
if (window.DEV_MODE) {
  addTaskToDesk({ id: 'discord-1', type: 'discord', title: 'Moderate alerts', required: 140, progress: 0, status: 'pending' });
  addTaskToDesk({ id: 'shopify-1', type: 'shopify', title: 'Sync order tags', required: 180, progress: 0, status: 'pending' });
  addTaskToDesk({ id: 'discord-2', type: 'discord', title: 'Ticket triage', required: 120, progress: 0, status: 'pending' });
}

// --- Update ---
function update() {
  for (const agent of agents) {
    if (agent.state === 'sitting') {
      const desk = agent.targetDesk;
      if (desk && desk.occupant === agent && !desk.currentTask) {
        claimNextTask(desk);
      }

      agent.animationFrame = 0;
      agent.animationTimer = 0;
      agent.stateTimer += 1;
      if (agent.stateTimer >= SITTING_TO_WORKING_DELAY) {
        agent.state = 'working';
        agent.stateTimer = 0;
      }
      continue;
    }

    if (agent.state === 'working') {
      const desk = agent.targetDesk;
      if (!desk || desk.occupant !== agent) {
        scheduleTargetRetry(agent);
        continue;
      }

      const activeTask = claimNextTask(desk);
      if (!activeTask) {
        scheduleTargetRetry(agent);
        continue;
      }

      const skill = agent.skills[activeTask.type] || 1;
      activeTask.progress += agent.productivity * skill;
      if (activeTask.progress >= activeTask.required) {
        activeTask.progress = activeTask.required;
        handleTaskExecutionResult(desk, activeTask);
      }

      agent.stateTimer += 1;
      agent.animationTimer += 1;
      if (agent.animationTimer >= 6) {
        agent.animationTimer = 0;
        agent.animationFrame = (agent.animationFrame + 1) % 4;
      }
      continue;
    }

    if (agent.state === 'idle') {
      agent.stateTimer += 1;
      if (agent.targetRetryTimer > 0) {
        agent.targetRetryTimer -= 1;
      }

      if (agent.wanderTimer > 0) {
        agent.wanderTimer -= 1;
      }

      if (agent.targetRetryTimer <= 0) {
        if (assignAgentTarget(agent)) {
          continue;
        }

        agent.targetRetryTimer = hasAnyDeskTasks() ? TARGET_RETRY_DELAY : IDLE_WANDER_REASSIGN_DELAY;
      }

      if (!hasAnyDeskTasks() && (agent.targetX === null || agent.targetY === null || agent.wanderTimer <= 0)) {
        setRandomWanderTarget(agent);
      }
    }

    if (agent.targetX === null || agent.targetY === null) {
      continue;
    }

    if (agent.state === 'moving' && (!agent.targetDesk || agent.targetDesk.occupant !== agent)) {
      scheduleTargetRetry(agent);
      continue;
    }

    const dx = agent.targetX - agent.x;
    const dy = agent.targetY - agent.y;
    const distance = Math.hypot(dx, dy);

    if (Math.abs(dx) > Math.abs(dy)) {
      agent.direction = dx > 0 ? 'right' : 'left';
    } else if (Math.abs(dy) > 0) {
      agent.direction = dy > 0 ? 'down' : 'up';
    }

    if (distance <= 2) {
      agent.x = agent.targetX;
      agent.y = agent.targetY;

      if (agent.state === 'moving') {
        trySit(agent);
      } else {
        agent.targetX = null;
        agent.targetY = null;
      }
      continue;
    }

    const nx = dx / distance;
    const ny = dy / distance;
    agent.x += nx * agent.speed;
    agent.y += ny * agent.speed;

    agent.animationTimer += 1;
    if (agent.animationTimer >= 8) {
      agent.animationTimer = 0;
      agent.animationFrame = (agent.animationFrame + 1) % 4;
    }
  }

  observeAgentStateChanges();
}

function getDeskPriorityColor(priority) {
  if (priority === 2) {
    return '#ff5f5f';
  }

  if (priority === 1) {
    return '#ffd45a';
  }

  return '#a8a8a8';
}

const uiFxState = {
  frame: 0,
  knownTasks: new Map(),
  creationPops: [],
  completionFlashes: [],
  particles: []
};

const debugConsoleState = {
  input: '',
  logs: ['Control console ready. Type commands and press Enter.'],
  maxLogs: 8
};

function pushDebugLog(message) {
  debugConsoleState.logs.push(String(message));
  if (debugConsoleState.logs.length > debugConsoleState.maxLogs) {
    debugConsoleState.logs.shift();
  }
}

function drawDebugConsole(ctx) {
  const panelWidth = 420;
  const panelHeight = 120;
  const x = 12;
  const y = canvas.height - panelHeight - 12;

  ctx.fillStyle = 'rgba(8, 12, 20, 0.86)';
  ctx.fillRect(x, y, panelWidth, panelHeight);
  ctx.strokeStyle = 'rgba(122, 180, 255, 0.45)';
  ctx.strokeRect(x, y, panelWidth, panelHeight);

  ctx.fillStyle = '#d8ecff';
  ctx.font = '11px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('DEBUG CONSOLE', x + 8, y + 14);

  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(x + 8, y + 22, panelWidth - 16, 16);
  ctx.strokeStyle = 'rgba(123, 223, 255, 0.35)';
  ctx.strokeRect(x + 8, y + 22, panelWidth - 16, 16);
  ctx.fillStyle = '#98e6ff';
  const visibleInput = debugConsoleState.input.slice(-58);
  ctx.fillText(`> ${visibleInput}${uiFxState.frame % 30 < 15 ? '_' : ''}`, x + 12, y + 34);

  ctx.fillStyle = '#bdd0e8';
  ctx.font = '10px monospace';
  const logs = debugConsoleState.logs.slice(-6);
  for (let i = 0; i < logs.length; i += 1) {
    const line = logs[i].slice(0, 62);
    ctx.fillText(line, x + 10, y + 52 + i * 11);
  }
}

window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && (event.key === 'l' || event.key === 'L')) {
    debugConsoleState.logs = [];
    pushDebugLog('Console cleared.');
    event.preventDefault();
    return;
  }

  if (event.key === 'Enter') {
    const commandText = debugConsoleState.input.trim();
    if (commandText) {
      const result = dispatchCommand(commandText);
      pushDebugLog(`> ${commandText}`);
      pushDebugLog(JSON.stringify(result));
      debugConsoleState.input = '';
    }
    event.preventDefault();
    return;
  }

  if (event.key === 'Backspace') {
    debugConsoleState.input = debugConsoleState.input.slice(0, -1);
    event.preventDefault();
    return;
  }

  if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    debugConsoleState.input += event.key;
    if (debugConsoleState.input.length > 200) {
      debugConsoleState.input = debugConsoleState.input.slice(-200);
    }
    event.preventDefault();
  }
});

function getTaskIcon(taskType) {
  if (taskType === 'discord') {
    return 'D';
  }

  if (taskType === 'shopify') {
    return 'S';
  }

  return '?';
}

function getRoleTint(role) {
  if (role === 'researcher') {
    return 'rgba(120, 200, 255, 0.35)';
  }

  if (role === 'executor') {
    return 'rgba(120, 255, 170, 0.35)';
  }

  return 'rgba(255, 210, 120, 0.28)';
}

function getAgentStateLabel(agent) {
  if (agent.state === 'working') {
    return 'WORK';
  }

  if (agent.state === 'moving') {
    return 'MOVE';
  }

  if (agent.state === 'sitting') {
    return 'SEAT';
  }

  if (agent.targetDesk && agent.targetDesk.lastFailedTask) {
    return 'FAIL';
  }

  return 'IDLE';
}

function getTaskPriority(task) {
  if (!task || typeof task.priority !== 'number') {
    return 0;
  }

  return Math.max(0, Math.min(2, task.priority));
}

function drawDeskProcessingGlow(ctx, desk, pulse) {
  const task = desk.currentTask || desk.queue[0];
  if (!task) {
    return;
  }

  const priority = getTaskPriority(task);
  const intensity = 0.12 + priority * 0.08 + pulse * 0.08;
  const radius = 40 + priority * 8 + pulse * 6;
  const gradient = ctx.createRadialGradient(desk.x, desk.y, 8, desk.x, desk.y, radius);
  gradient.addColorStop(0, `rgba(255, 255, 255, ${intensity})`);
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(desk.x, desk.y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function drawDeskQueueStack(ctx, desk) {
  const queueCount = desk.queue.length;
  if (queueCount <= 0) {
    return;
  }

  const maxVisible = Math.min(queueCount, 5);
  for (let i = 0; i < maxVisible; i += 1) {
    const queuedTask = desk.queue[i];
    const offsetX = -26 + i * 4;
    const offsetY = 26 - i * 3;
    const priorityColor = getDeskPriorityColor(getTaskPriority(queuedTask));
    ctx.fillStyle = priorityColor;
    ctx.fillRect(desk.x + offsetX, desk.y + offsetY, 12, 5);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.strokeRect(desk.x + offsetX, desk.y + offsetY, 12, 5);
  }
}

function drawTaskFx(ctx) {
  for (let i = uiFxState.creationPops.length - 1; i >= 0; i -= 1) {
    const pop = uiFxState.creationPops[i];
    pop.life -= 1;
    const alpha = Math.max(0, pop.life / pop.maxLife);
    const size = 8 + (1 - alpha) * 12;

    ctx.fillStyle = `rgba(110, 198, 255, ${0.4 * alpha})`;
    ctx.beginPath();
    ctx.arc(pop.x, pop.y - (1 - alpha) * 10, size, 0, Math.PI * 2);
    ctx.fill();

    if (pop.life <= 0) {
      uiFxState.creationPops.splice(i, 1);
    }
  }

  for (let i = uiFxState.completionFlashes.length - 1; i >= 0; i -= 1) {
    const flash = uiFxState.completionFlashes[i];
    flash.life -= 1;
    const alpha = Math.max(0, flash.life / flash.maxLife);
    const width = 36 + (1 - alpha) * 28;
    const height = 20 + (1 - alpha) * 16;

    ctx.fillStyle = `rgba(255, 255, 255, ${0.35 * alpha})`;
    ctx.fillRect(flash.x - width / 2, flash.y - height / 2, width, height);

    if (flash.life <= 0) {
      uiFxState.completionFlashes.splice(i, 1);
    }
  }

  for (let i = uiFxState.particles.length - 1; i >= 0; i -= 1) {
    const particle = uiFxState.particles[i];
    particle.life -= 1;
    particle.x += particle.vx;
    particle.y += particle.vy;
    particle.vy += 0.02;

    const alpha = Math.max(0, particle.life / particle.maxLife);
    ctx.fillStyle = `rgba(255, 238, 168, ${0.75 * alpha})`;
    ctx.fillRect(particle.x, particle.y, 2, 2);

    if (particle.life <= 0) {
      uiFxState.particles.splice(i, 1);
    }
  }
}

function refreshTaskFxState() {
  const currentTasks = new Map();

  for (const desk of desks) {
    if (desk.currentTask) {
      currentTasks.set(desk.currentTask.id, {
        x: desk.x,
        y: desk.y,
        priority: getTaskPriority(desk.currentTask)
      });
    }

    for (const queuedTask of desk.queue) {
      currentTasks.set(queuedTask.id, {
        x: desk.x,
        y: desk.y,
        priority: getTaskPriority(queuedTask)
      });
    }
  }

  for (const [taskId, info] of currentTasks) {
    if (!uiFxState.knownTasks.has(taskId)) {
      uiFxState.creationPops.push({
        x: info.x,
        y: info.y - 30,
        life: 18,
        maxLife: 18
      });
    }
  }

  for (const [taskId, previousInfo] of uiFxState.knownTasks) {
    if (!currentTasks.has(taskId)) {
      uiFxState.completionFlashes.push({
        x: previousInfo.x,
        y: previousInfo.y - 16,
        life: 12,
        maxLife: 12
      });

      const particleCount = 8 + previousInfo.priority * 3;
      for (let i = 0; i < particleCount; i += 1) {
        const angle = (Math.PI * 2 * i) / particleCount;
        const speed = 0.6 + Math.random() * 1.1;
        uiFxState.particles.push({
          x: previousInfo.x,
          y: previousInfo.y - 16,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 0.3,
          life: 24,
          maxLife: 24
        });
      }
    }
  }

  uiFxState.knownTasks = currentTasks;
}

function drawAgentIdentityLayer(ctx, agent) {
  const tint = getRoleTint(agent.role);
  ctx.fillStyle = tint;
  ctx.beginPath();
  ctx.arc(agent.x, agent.y + 8, 12, 0, Math.PI * 2);
  ctx.fill();

  const stateLabel = getAgentStateLabel(agent);
  const stateX = agent.x;
  const stateY = agent.y - 36;
  ctx.fillStyle = 'rgba(18, 22, 34, 0.85)';
  ctx.fillRect(stateX - 15, stateY - 9, 30, 10);
  ctx.fillStyle = '#f7f4df';
  ctx.font = '8px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(stateLabel, stateX, stateY - 1);

  const activeTask = agent.targetDesk && agent.targetDesk.currentTask ? agent.targetDesk.currentTask : null;
  if (!activeTask) {
    return;
  }

  const icon = getTaskIcon(activeTask.type);
  const iconX = agent.x + 16;
  const iconY = agent.y - 24;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
  ctx.fillRect(iconX - 6, iconY - 8, 12, 12);
  ctx.fillStyle = activeTask.type === 'shopify' ? '#7ef7b3' : '#7ecfff';
  ctx.font = '9px monospace';
  ctx.fillText(icon, iconX, iconY + 1);
}

function drawGlobalHud(ctx) {
  let activeTasks = 0;
  let completedTasks = 0;
  let failedTasks = 0;

  for (const desk of desks) {
    activeTasks += desk.queue.length + (desk.currentTask ? 1 : 0);
    completedTasks += desk.completedTasks;
    failedTasks += desk.failedTasks;
  }

  let activeWorkflows = 0;
  for (const workflow of workflows.values()) {
    if (workflow.status === 'running') {
      activeWorkflows += 1;
    }
  }

  ctx.fillStyle = 'rgba(10, 14, 24, 0.78)';
  ctx.fillRect(12, 10, 330, 44);
  ctx.strokeStyle = 'rgba(148, 197, 255, 0.35)';
  ctx.strokeRect(12, 10, 330, 44);

  ctx.fillStyle = '#d5ebff';
  ctx.font = '12px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`Active: ${activeTasks}`, 20, 28);
  ctx.fillText(`Done: ${completedTasks}`, 110, 28);
  ctx.fillText(`Failed: ${failedTasks}`, 185, 28);
  ctx.fillText(`Workflows: ${activeWorkflows}`, 260, 28);

  ctx.fillStyle = '#8ea8c3';
  ctx.font = '10px monospace';
  ctx.fillText('Automation OS Runtime', 20, 44);
}

function drawWorkflowOverlay(ctx) {
  const activeWorkflowList = Array.from(workflows.values()).filter((workflow) => workflow.status === 'running');
  if (activeWorkflowList.length === 0) {
    return;
  }

  const baseX = canvas.width - 300;
  let baseY = 12;
  const maxCards = Math.min(activeWorkflowList.length, 4);

  for (let i = 0; i < maxCards; i += 1) {
    const workflow = activeWorkflowList[i];
    const cardHeight = 44;
    ctx.fillStyle = 'rgba(12, 16, 30, 0.82)';
    ctx.fillRect(baseX, baseY, 288, cardHeight);
    ctx.strokeStyle = 'rgba(140, 220, 255, 0.3)';
    ctx.strokeRect(baseX, baseY, 288, cardHeight);

    ctx.fillStyle = '#d7f0ff';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(workflow.id.slice(0, 34), baseX + 8, baseY + 12);

    const stepY = baseY + 28;
    const maxSteps = Math.min(workflow.steps.length, 6);
    for (let stepIndex = 0; stepIndex < maxSteps; stepIndex += 1) {
      const x = baseX + 10 + stepIndex * 44;
      const status = workflow.stepStatuses[stepIndex] || 'pending';
      let fill = 'rgba(112, 132, 158, 0.6)';
      if (status === 'done') {
        fill = 'rgba(126, 247, 179, 0.95)';
      } else if (status === 'running') {
        fill = 'rgba(127, 207, 255, 0.95)';
      } else if (status === 'failed') {
        fill = 'rgba(255, 120, 120, 0.95)';
      }

      ctx.fillStyle = fill;
      ctx.fillRect(x, stepY, 16, 6);
      ctx.strokeStyle = 'rgba(8, 10, 16, 0.65)';
      ctx.strokeRect(x, stepY, 16, 6);

      if (stepIndex < maxSteps - 1) {
        ctx.strokeStyle = 'rgba(180, 220, 245, 0.45)';
        ctx.beginPath();
        ctx.moveTo(x + 16, stepY + 3);
        ctx.lineTo(x + 26, stepY + 3);
        ctx.stroke();
      }
    }

    baseY += 50;
  }
}

function drawPendingWorkflowsOverlay(ctx) {
  const pendingWorkflowList = Array.from(workflows.values()).filter((workflow) => workflow.status === 'pending_approval');
  if (pendingWorkflowList.length === 0) {
    return;
  }

  // Draw a centered modal for each pending workflow (max 1 visible at a time)
  const workflow = pendingWorkflowList[0];
  const windowWidth = canvas.width;
  const windowHeight = canvas.height;
  const cardWidth = 500;
  const headerHeight = 40;
  const stepHeight = 50;
  const footerHeight = 50;
  const cardHeight = headerHeight + Math.min(workflow.steps.length, 4) * stepHeight + footerHeight;
  const cardX = (windowWidth - cardWidth) / 2;
  const cardY = (windowHeight - cardHeight) / 2;

  // Semi-transparent backdrop
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(0, 0, windowWidth, windowHeight);

  // Card background
  ctx.fillStyle = 'rgba(20, 25, 40, 0.95)';
  ctx.fillRect(cardX, cardY, cardWidth, cardHeight);

  // Card border - glowing cyan
  ctx.strokeStyle = 'rgba(100, 200, 255, 0.6)';
  ctx.lineWidth = 2;
  ctx.strokeRect(cardX, cardY, cardWidth, cardHeight);

  // Header
  ctx.fillStyle = 'rgba(50, 80, 120, 0.8)';
  ctx.fillRect(cardX, cardY, cardWidth, headerHeight);
  ctx.fillStyle = '#d7f0ff';
  ctx.font = 'bold 14px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('⧗ WORKFLOW PENDING APPROVAL', cardX + 12, cardY + 26);

  // Workflow ID
  ctx.fillStyle = '#a0d0ff';
  ctx.font = '10px monospace';
  ctx.fillText(`ID: ${workflow.id}`, cardX + 12, cardY + headerHeight + 16);

  // Steps list
  const stepsToShow = Math.min(workflow.steps.length, 4);
  for (let i = 0; i < stepsToShow; i += 1) {
    const step = workflow.steps[i];
    const plan = workflow.plan && workflow.plan[i] ? workflow.plan[i] : {};
    const stepY = cardY + headerHeight + 20 + i * stepHeight;

    // Step number and title
    ctx.fillStyle = '#7ff0ff';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${i + 1}. ${step.title || `Step ${i + 1}`}`, cardX + 20, stepY + 12);

    // Complexity badge
    const complexityColor = plan.complexity === 'high' ? '#ff8888' : plan.complexity === 'low' ? '#88ff88' : '#ffaa66';
    ctx.fillStyle = complexityColor;
    ctx.font = '9px monospace';
    ctx.fillText(`[${plan.complexity || 'med'}]`, cardX + 20, stepY + 26);

    // Role preference
    ctx.fillStyle = '#b0c8ff';
    ctx.font = '9px monospace';
    ctx.fillText(`Role: ${plan.rolePreference || 'any'}`, cardX + 120, stepY + 26);

    // Description
    ctx.fillStyle = '#80a8ff';
    ctx.font = '9px monospace';
    const desc = plan.description || step.description || '';
    const descShort = desc.length > 45 ? desc.slice(0, 42) + '...' : desc;
    ctx.fillText(descShort, cardX + 20, stepY + 40);
  }

  if (workflow.steps.length > stepsToShow) {
    ctx.fillStyle = '#8080a0';
    ctx.font = '9px monospace';
    ctx.fillText(`... and ${workflow.steps.length - stepsToShow} more steps`, cardX + 20, cardY + headerHeight + 20 + stepsToShow * stepHeight);
  }

  // Footer with approve/reject buttons
  const footerY = cardY + cardHeight - footerHeight;
  ctx.fillStyle = 'rgba(40, 50, 70, 0.8)';
  ctx.fillRect(cardX, footerY, cardWidth, footerHeight);

  // Draw as text instructions (buttons would need mouse tracking which is complex in canvas)
  ctx.fillStyle = '#90ff90';
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('[APPROVE: approve workflow ' + workflow.id.slice(0, 12) + ']', cardX + cardWidth / 2, footerY + 18);

  ctx.fillStyle = '#ff9090';
  ctx.font = 'bold 12px monospace';
  ctx.fillText('[REJECT: reject workflow ' + workflow.id.slice(0, 12) + ']', cardX + cardWidth / 2, footerY + 36);

  // Show count of pending workflows if multiple
  if (pendingWorkflowList.length > 1) {
    ctx.fillStyle = '#ffaa66';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`(${pendingWorkflowList.length - 1} more pending)`, cardX + cardWidth / 2, footerY - 8);
  }
}

function drawDeskTaskOverlay(ctx, desk) {
  const labelY = desk.y - spriteConfigs.desk.height / 2 - 10;
  const queueText = `${desk.queue.length}`;
  const activePriority = desk.currentTask ? desk.currentTask.priority : (desk.queue[0] ? desk.queue[0].priority : null);

  if (activePriority !== null) {
    ctx.fillStyle = getDeskPriorityColor(activePriority);
    ctx.fillRect(desk.x - 20, labelY - 10, 40, 6);
  }

  ctx.fillStyle = '#f7f4df';
  ctx.font = '12px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(queueText, desk.x, labelY);

  if (desk.lastFailedTask) {
    ctx.fillStyle = '#ff5f5f';
    ctx.fillText(`FAILED ${desk.failedTasks}`, desk.x, labelY - 14);
  }

  if (!desk.currentTask) {
    return;
  }

  const barWidth = 64;
  const barHeight = 6;
  const progressRatio = Math.max(0, Math.min(1, desk.currentTask.progress / desk.currentTask.required));
  const barX = desk.x - barWidth / 2;
  const barY = labelY + 6;
  const pulse = 0.5 + 0.5 * Math.sin(uiFxState.frame * 0.16);

  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(barX, barY, barWidth, barHeight);
  const barGradient = ctx.createLinearGradient(barX, barY, barX + barWidth, barY + barHeight);
  if (desk.currentTask.type === 'shopify') {
    barGradient.addColorStop(0, '#2f8e68');
    barGradient.addColorStop(0.5, '#50d890');
    barGradient.addColorStop(1, '#95ffe8');
  } else {
    barGradient.addColorStop(0, '#387bb5');
    barGradient.addColorStop(0.5, '#6ec6ff');
    barGradient.addColorStop(1, '#b1e9ff');
  }
  ctx.fillStyle = barGradient;
  ctx.fillRect(barX, barY, barWidth * progressRatio, barHeight);

  // Energy scanline to make progress feel live.
  const scanX = barX + (barWidth * ((uiFxState.frame % 48) / 48));
  ctx.fillStyle = `rgba(255, 255, 255, ${0.16 + pulse * 0.1})`;
  ctx.fillRect(scanX, barY, 2, barHeight);

  ctx.strokeStyle = '#ffffff';
  ctx.strokeRect(barX, barY, barWidth, barHeight);
}

// --- Render ---
function render() {
  uiFxState.frame += 1;
  refreshTaskFxState();

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  const bgGradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  bgGradient.addColorStop(0, '#111a2b');
  bgGradient.addColorStop(1, '#111827');
  ctx.fillStyle = bgGradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = 'rgba(130, 180, 255, 0.04)';
  for (let y = 0; y < canvas.height; y += 24) {
    ctx.fillRect(0, y, canvas.width, 1);
  }

  const deskImage = loadedAssets['desk.png'];
  const computerImage = loadedAssets['PC1.png'];
  const pulse = 0.5 + 0.5 * Math.sin(uiFxState.frame * 0.14);

  for (const desk of desks) {
    drawDeskProcessingGlow(ctx, desk, pulse);
    drawSprite(ctx, deskImage, desk.x, desk.y, spriteConfigs.desk);
    drawDeskQueueStack(ctx, desk);
    drawDeskTaskOverlay(ctx, desk);
    drawLogicalPoint(ctx, desk.x, desk.y);
  }

  for (const desk of desks) {
    const computerPosition = getDeskSlotPosition(desk, 'computer');
    drawSprite(ctx, computerImage, computerPosition.x, computerPosition.y, spriteConfigs.computer);
    drawLogicalPoint(ctx, computerPosition.x, computerPosition.y);
  }

  const walkSprites = {
    up: loadedAssets['Julia_walk_Up.png'],
    down: loadedAssets['Julia_walk_Foward.png'],
    left: loadedAssets['Julia_walk_Left.png'],
    right: loadedAssets['Julia_walk_Rigth.png']
  };
  const idleSprite = loadedAssets['Julia-Idle.png'];

  function drawAnimatedSprite(image, frame, x, y) {
    if (!image) {
      return;
    }

    const hasFourFrames = image.width >= 4 && image.width % 4 === 0;
    if (hasFourFrames) {
      const frameWidth = image.width / 4;
      const frameX = (frame % 4) * frameWidth;
      drawSprite(ctx, image, x, y, {
        ...spriteConfigs.agent,
        sourceX: frameX,
        sourceY: 0,
        sourceWidth: frameWidth,
        sourceHeight: image.height
      });
      return;
    }

    drawSprite(ctx, image, x, y, spriteConfigs.agent);
  }

  for (const agent of agents) {
    const isMoving = agent.state === 'moving' || agent.state === 'idle';
    const isSitting = agent.state === 'sitting';
    const sprite = isMoving ? walkSprites[agent.direction] : idleSprite;
    const frame = isMoving ? agent.animationFrame : 0;
    const renderX = isSitting ? agent.x + SITTING_OFFSET.x : agent.x;
    const renderY = isSitting ? agent.y + SITTING_OFFSET.y : agent.y;
    drawAnimatedSprite(sprite, frame, renderX, renderY);
    drawAgentIdentityLayer(ctx, agent);
    drawLogicalPoint(ctx, agent.x, agent.y);
  }

  drawTaskFx(ctx);
  drawGlobalHud(ctx);
  drawPendingWorkflowsOverlay(ctx);
  drawWorkflowOverlay(ctx);
  drawDebugConsole(ctx);
}

// --- Game Loop ---
function loop() {
  update();
  render();
  requestAnimationFrame(loop);
}

loop();
startBridgePolling();