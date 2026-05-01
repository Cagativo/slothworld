import { generateId, randomInRange, cloneContext } from './utils.js';
import {
  ACTION_TOOL_MAP,
  TASK_EXECUTION_FAILURE_CHANCE,
  BRIDGE_POLL_INTERVAL_MS,
  TASK_TYPE_DISCORD,
  TASK_TYPE_SHOPIFY,
  TASK_TYPE_IMAGE_RENDER,
  ACTION_REPLY_TO_MESSAGE,
  ACTION_PROCESS_ORDER,
  ACTION_START_PRODUCT_WORKFLOW,
  TASK_STATUS_PENDING,
  TASK_STATUS_DONE,
  TASK_STATUS_FAILED,
  TASK_STATUS_AWAITING_ACK,
  EVENT_TASK_COMPLETED,
  TASK_PROGRESS_ACK_THRESHOLD,
  TASK_REQUIRED_DISCORD_MIN,
  TASK_REQUIRED_DISCORD_MAX,
  TASK_REQUIRED_SHOPIFY_MIN,
  TASK_REQUIRED_SHOPIFY_MAX
} from './constants.js';
import { desks, emitEvent } from './app-state.js';
import { appendRawEvents } from './world/eventStore.js';
import { getCanonicalPipelineLabel, warnLegacyExecutionPath } from './execution-pipeline.js';
// Circular with workflow — safe: only called at runtime, never at module init.
import { applyWorkflowTaskCompletion, createProductWorkflowFromTask, inferDefaultPriority } from './workflow.js';

/**
 * @typedef {Object} Task
 * @description A normalized task object managed by the simulation engine.
 * @property {string} id - Unique task identifier.
 * @property {string} type - Task type constant (TASK_TYPE_*).
 * @property {string} title - Human-readable task title.
 * @property {number} priority - Priority level: 0 (low), 1 (normal), 2 (high).
 * @property {number} progress - Accumulated work ticks completed so far.
 * @property {number} required - Total work ticks required to finish the task.
 * @property {string} status - Lifecycle status constant (TASK_STATUS_*).
 * @property {string|null} action - Action identifier for tool routing.
 * @property {string|null} tool - Dot-separated tool name override (e.g. `'discord.reply'`).
 * @property {Object} payload - Task-type-specific payload data.
 * @property {number} retries - Number of execution retries performed so far.
 * @property {number} maxRetries - Maximum number of retries allowed.
 * @property {string|null} workflowId - Parent workflow ID, or null for standalone tasks.
 * @property {number|null} workflowStepIndex - Zero-based step index within the parent workflow, or null.
 * @property {Object|null} workflowContextInput - Workflow context snapshot passed in at enqueue time.
 * @property {Object} [meta] - Raw source event object attached at creation time.
 * @property {string} [renderId] - Render job identifier (image_render tasks only).
 * @property {string} [productId] - Product identifier (image_render tasks only).
 * @property {string} [provider] - Image provider name (image_render tasks only).
 * @property {Object} [designIntent] - Design parameters object (image_render tasks only).
 * @property {string} [runtimeStatus] - Transient status set by the simulation tick loop.
 * @property {string} [localLifecycleStatus] - Lifecycle status synced from the event stream.
 * @property {boolean} [_executionInFlight] - True while executeTask is awaiting a response.
 * @property {boolean} [_executionComplete] - True after executeTask resolves.
 * @property {boolean} [_startedSynced] - True after the /start sync request succeeds.
 * @property {boolean} [_startSyncInFlight] - True while the /start sync request is in progress.
 * @property {boolean} [_startSyncDisabled] - True when /start sync has been permanently disabled after retries.
 */

/**
 * @typedef {Object} ExecutionResult
 * @description Return value from task and tool execution functions.
 * @property {boolean} success - Whether the execution succeeded.
 * @property {string} [error] - Error message when `success` is false.
 * @property {Object} [result] - Structured result payload when `success` is true.
 * @property {boolean} [skipped] - True when execution was intentionally skipped (e.g. no Discord target).
 * @property {string} [note] - Human-readable note explaining a skip or partial result.
 */

/**
 * @typedef {Object} ToolResult
 * @description Normalized result produced by {@link normalizeToolResult}.
 * @property {boolean} success - Whether the tool call succeeded.
 * @property {*} [data] - Result data when `success` is true.
 * @property {string} [error] - Error description when `success` is false.
 */

/**
 * @typedef {Object} Desk
 * @description A work desk that manages agent assignment and the task queue.
 * @property {number} x - Canvas X coordinate of the desk centre.
 * @property {number} y - Canvas Y coordinate of the desk centre.
 * @property {string} type - Always `'desk'`.
 * @property {boolean} occupied - True when an agent is assigned to this desk.
 * @property {Object} slots - Named slot offsets (`{ seat, computer }`).
 * @property {Object|null} occupant - Currently assigned agent, or null.
 * @property {Task[]} queue - Pending tasks sorted by descending priority.
 * @property {Task|null} currentTask - Task currently being executed, or null.
 * @property {boolean} paused - When true, {@link claimNextTask} will not pop tasks from the queue.
 * @property {number} completedTasks - Total number of tasks completed at this desk.
 * @property {number} failedTasks - Total number of tasks that failed at this desk.
 * @property {Task|null} lastFailedTask - Most recent failed task, or null.
 */

/**
 * @typedef {Object} TaskSummary
 * @description A safe, read-only view of a task produced by {@link sanitizeTaskForView}.
 * @property {string} id - Task identifier.
 * @property {string} type - Task type constant.
 * @property {string} title - Task title.
 * @property {string} status - Lifecycle status.
 * @property {number} priority - Priority level.
 * @property {number} progress - Accumulated work ticks.
 * @property {number} required - Required work ticks.
 * @property {string|null} action - Action identifier, or null.
 * @property {string|null} tool - Tool name, or null.
 * @property {string|null} provider - Image provider, or null.
 * @property {string|null} productId - Product ID, or null.
 * @property {string|null} renderId - Render job ID, or null.
 * @property {string|null} workflowId - Parent workflow ID, or null.
 * @property {number|null} workflowStepIndex - Workflow step index, or null.
 */

// --- Task factory helpers ---
/**
 * @description Infers a numeric task priority from a Discord event's type and title fields.
 * @param {{ type?: string, title?: string }} event - The Discord source event.
 * @returns {number} Priority level: 0 (log/passive), 1 (default), or 2 (mention/command).
 */
export function inferPriorityFromDiscord(event) {
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

/**
 * @description Infers a numeric task priority from a Shopify event's type and title fields.
 * @param {{ type?: string, title?: string }} event - The Shopify source event.
 * @returns {number} Priority level: 0 (log/passive), 1 (default), or 2 (order).
 */
export function inferPriorityFromShopify(event) {
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

/**
 * @description Creates a new Discord task object from a raw Discord source event.
 * @param {{ title?: string, type?: string, channelId?: string, messageId?: string, content?: string, payload?: Object }} event - The raw Discord event data.
 * @returns {Task} A new Discord task ready to be ingested into the simulation.
 */
export function createDiscordTask(event) {
  console.log('[TASK][CREATE_DISCORD]', 'raw_input', event);

  const channelId =
    (event && typeof event.channelId === 'string' && event.channelId.trim()) ||
    (event && event.payload && typeof event.payload.channelId === 'string' && event.payload.channelId.trim()) ||
    null;
  const messageId =
    (event && typeof event.messageId === 'string' && event.messageId.trim()) ||
    (event && event.payload && typeof event.payload.messageId === 'string' && event.payload.messageId.trim()) ||
    null;
  const content =
    (event && typeof event.content === 'string' && event.content) ||
    (event && event.payload && typeof event.payload.content === 'string' && event.payload.content) ||
    'Automated response generated by simulation.';

  const createdTask = {
    id: generateId(),
    type: TASK_TYPE_DISCORD,
    title: event.title || 'Discord Event',
    priority: inferPriorityFromDiscord(event),
    progress: 0,
    required: randomInRange(TASK_REQUIRED_DISCORD_MIN, TASK_REQUIRED_DISCORD_MAX),
    status: TASK_STATUS_PENDING,
    action: ACTION_REPLY_TO_MESSAGE,
    payload: {
      channelId,
      messageId,
      content
    },
    meta: event
  };

  console.log('[TASK][CREATE_DISCORD]', 'created_task', createdTask);
  return createdTask;
}

/**
 * @description Creates a new Shopify task object from a raw Shopify source event.
 * @param {{ title?: string, type?: string, orderId?: string }} event - The raw Shopify event data.
 * @returns {Task} A new Shopify task ready to be ingested into the simulation.
 */
export function createShopifyTask(event) {
  return {
    id: generateId(),
    type: TASK_TYPE_SHOPIFY,
    title: event.title || 'Shopify Event',
    priority: inferPriorityFromShopify(event),
    progress: 0,
    required: randomInRange(TASK_REQUIRED_SHOPIFY_MIN, TASK_REQUIRED_SHOPIFY_MAX),
    status: TASK_STATUS_PENDING,
    action: ACTION_PROCESS_ORDER,
    payload: {
      orderId: event.orderId || `order-${generateId()}`
    },
    meta: event
  };
}

// --- Bridge executor (HTTP to bridge-server) ---
async function registerTaskInBridge(task) {
  console.log('[TASK]', 'before_bridge_send', task.id, {
    hasPayload: !!task.payload,
    channelId: task.payload && task.payload.channelId ? task.payload.channelId : null,
    content: task.payload && typeof task.payload.content === 'string' ? task.payload.content : null
  });

  const normalizedPayload = task && task.payload && typeof task.payload === 'object' ? task.payload : {};
  const bridgeTask = {
    id: task.id,
    type: task.type || TASK_TYPE_DISCORD,
    title: task.title || 'Injected task',
    status: TASK_STATUS_PENDING,
    correlationId: typeof task.correlationId === 'string' ? task.correlationId : undefined,
    depth: typeof task.depth === 'number' ? task.depth : undefined,
    internal: task.internal === true,
    domain: typeof task.domain === 'string' ? task.domain : undefined,
    payload: normalizedPayload,
    ...(typeof task.action === 'string' ? { action: task.action } : {}),
    ...([0, 1, 2].includes(task.priority) ? { priority: task.priority } : {}),
    ...(typeof task.productId === 'string' ? { productId: task.productId } : {}),
    ...(typeof task.provider === 'string' ? { provider: task.provider } : {}),
    ...(task.designIntent && typeof task.designIntent === 'object' ? { designIntent: task.designIntent } : {})
  };

  const response = await fetch('/task', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(bridgeTask)
  });

  if (!response.ok) {
    let detail = null;
    try {
      const data = await response.json();
      detail = data && data.error ? data.error : null;
    } catch (_error) {
      detail = null;
    }

    console.warn('[TASK]', 'bridge_register_non_ok', task.id, response.status, detail);
  }

  return response.ok;
}

function isDiscordSnowflake(value) {
  return typeof value === 'string' && /^\d{17,20}$/.test(value);
}

/**
 * @description Executes a Discord task via the canonical task pipeline, skipping silently when no valid Discord target is available.
 * @param {Task} task - The Discord task to execute.
 * @returns {Promise<ExecutionResult>} Resolves with a success result (possibly `skipped: true`) or a failure result.
 */
export async function executeDiscordTask(task) {
  if (!task || !task.id) {
    return { success: false, error: 'Missing task id' };
  }

  const payload = task.payload && typeof task.payload === 'object' ? task.payload : {};
  const hasValidTarget = isDiscordSnowflake(payload.channelId) && isDiscordSnowflake(payload.messageId);

  // Local/debug injections may not have a real Discord target to reply to.
  // Keep simulation deterministic by treating these as no-op success.
  if (!hasValidTarget) {
    return {
      success: true,
      skipped: true,
      note: 'discord_target_unavailable'
    };
  }

  try {
    return await executeTask(task);
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * @description Legacy helper that executes an image render task via the canonical task pipeline.
 * @deprecated Direct invocation bypasses the canonical TaskEngine lifecycle. Prefer task-driven execution.
 * @param {Task} task - The image render task to execute.
 * @returns {Promise<ExecutionResult>} Resolves with the execution result.
 */
export async function executeImageRenderTask(task) {
  // LEGACY helper: maintained for compatibility while canonical execution remains task-driven.
  warnLegacyExecutionPath('core/task-handling.executeImageRenderTask', {
    canonical: getCanonicalPipelineLabel()
  });

  if (!task || !task.id) {
    return { success: false, error: 'Missing task id' };
  }

  try {
    return await executeTask(task);
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// --- Tool registry ---
export const tools = {
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
        type: TASK_TYPE_DISCORD,
        action: ACTION_REPLY_TO_MESSAGE,
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
      const imageData = context && context.render_product_image && context.render_product_image.output;

      return {
        success: true,
        data: {
          listingId: `listing-${generateId()}`,
          title: `${keyword} - Automated Listing`,
          description: promptData ? promptData.prompt : `Automated listing for ${keyword}`,
          imageUrl: imageData ? (imageData.url || imageData.imageUrl || null) : null
        }
      };
    }
  },
  render: {
    async route(payload, context) {
      const task = {
        id: payload && payload.taskId ? payload.taskId : generateId(),
        renderId: payload && payload.renderId ? payload.renderId : null,
        type: TASK_TYPE_IMAGE_RENDER,
        productId: payload && payload.productId ? payload.productId : (context && context.keyword ? `product-${context.keyword}` : null),
        designIntent: payload && payload.designIntent ? payload.designIntent : {},
        provider: payload && payload.provider ? payload.provider : 'openai',
        payload: {
          ...payload,
          renderId: payload && payload.renderId ? payload.renderId : undefined,
          context
        },
        status: TASK_STATUS_PENDING,
        priority: typeof payload.priority === 'number' ? payload.priority : 1
      };

      const result = await executeImageRenderTask(task);
      if (!result.success) {
        return {
          success: false,
          error: result.error || 'image_render_failed',
          data: result
        };
      }

      return {
        success: true,
        data: {
          assetId: result.result && result.result.assetId ? result.result.assetId : null,
          productId: result.result && result.result.productId ? result.result.productId : null,
          url: result.result && result.result.url ? result.result.url : null,
          provider: result.result && result.result.provider ? result.result.provider : null,
          prompt: result.result && result.result.prompt ? result.result.prompt : null,
          createdAt: result.result && result.result.createdAt ? result.result.createdAt : null,
          manifestUrl: result.result && result.result.manifestUrl ? result.result.manifestUrl : null,
          imageUrl: result.result && (result.result.imageUrl || result.result.url)
            ? (result.result.imageUrl || result.result.url)
            : null
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

/**
 * @description Resolves a dot-separated tool path (e.g. `'discord.reply'`) to its handler function.
 * @param {string} toolName - Dot-separated tool path within the {@link tools} registry.
 * @returns {Function|null} The handler function, or null if the path does not resolve to a function.
 */
export function resolveTool(toolName) {
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

/**
 * @description Normalizes an arbitrary tool return value into a standard {@link ToolResult} shape.
 * @param {*} result - The raw value returned by a tool handler.
 * @returns {ToolResult} A normalized result with `success`, `data`, and `error` fields.
 */
export function normalizeToolResult(result) {
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

/**
 * @description Infers the dot-separated tool name to use for a task, consulting `task.tool`, the ACTION_TOOL_MAP, and the task type as fallbacks.
 * @param {Task} task - The task whose tool name should be resolved.
 * @returns {string|null} The tool name string, or null if no tool can be determined.
 */
export function inferToolNameForTask(task) {
  if (task && task.tool) {
    return task.tool;
  }

  if (task && task.action && ACTION_TOOL_MAP[task.action]) {
    return ACTION_TOOL_MAP[task.action];
  }

  if (task && task.type === TASK_TYPE_DISCORD) {
    return 'discord.reply';
  }

  if (task && task.type === TASK_TYPE_SHOPIFY) {
    return 'shopify.process_order';
  }

  if (task && task.type === TASK_TYPE_IMAGE_RENDER) {
    return 'render.route';
  }

  return null;
}

/**
 * @description Legacy direct tool execution path — permanently disabled in the canonical pipeline.
 * @deprecated Direct client-side tool execution bypasses the TaskEngine lifecycle. Always returns a failure result.
 * @param {string} toolName - Dot-separated tool path (ignored).
 * @param {Object} payload - Tool payload (ignored).
 * @param {Object} context - Workflow context (ignored).
 * @returns {Promise<ExecutionResult>} Always resolves with `{ success: false, error: 'legacy_execution_disabled:executeTool' }`.
 */
export async function executeTool(toolName, payload, context) {
  // LEGACY: direct client-side tool execution bypasses canonical TaskEngine lifecycle.
  warnLegacyExecutionPath('core/task-handling.executeTool', {
    canonical: getCanonicalPipelineLabel(),
    disabled: true
  });
  void toolName;
  void payload;
  void context;
  return { success: false, error: 'legacy_execution_disabled:executeTool' };
}

/**
 * @description Executes a task via the bridge server's `/task/{id}/execute` endpoint, registering the task first if needed.
 * @param {Task} task - The task to execute; must have a valid `type` field.
 * @returns {Promise<ExecutionResult>} Resolves with the execution result returned by the bridge server.
 */
export async function executeTask(task) {
  // Canonical pipeline step: createTask -> enqueueTask -> claimTask -> executeTask -> ackTask
  if (!task || !task.type) {
    return { success: false, error: 'Invalid task' };
  }

  try {
    console.log('[TASK_EXECUTE_REQUEST]', { taskId: task.id, type: task.type, action: task.action || null });
    let response = await fetch(`/task/${encodeURIComponent(task.id)}/execute`, {
      method: 'POST'
    });

    if (response.status === 404) {
      const synced = await registerTaskInBridge(task);
      if (synced) {
        response = await fetch(`/task/${encodeURIComponent(task.id)}/execute`, {
          method: 'POST'
        });
      }
    }

    if (!response.ok) {
      return { success: false, error: `execute_${response.status}` };
    }

    const data = await response.json();
    const execution = data && data.result ? data.result : null;
    if (!execution || typeof execution !== 'object') {
      return { success: false, error: 'Invalid execute response' };
    }

    if (execution.success !== true) {
      return {
        success: false,
        error: execution.error || 'tool_execution_failed'
      };
    }

    return execution;
  } catch (error) {
    return { success: false, error: error && error.message ? error.message : 'execute_request_failed' };
  }
}

// --- Desk/queue helpers ---
/**
 * @description Normalizes a raw priority value, falling back to {@link inferDefaultPriority} when the value is not 0, 1, or 2.
 * @param {*} priority - The priority value to normalize.
 * @param {Task} task - The task used for inferring default priority when the explicit value is invalid.
 * @returns {number} Normalized priority: 0, 1, or 2.
 */
export function normalizePriority(priority, task) {
  if (priority === 0 || priority === 1 || priority === 2) {
    return priority;
  }

  return inferDefaultPriority(task);
}

/**
 * @description Computes a load score for a desk equal to its queue length plus one if a task is currently active.
 * @param {Desk} desk - The desk to score.
 * @returns {number} Load score; lower is less loaded.
 */
export function getDeskLoadScore(desk) {
  return desk.queue.length + (desk.currentTask ? 1 : 0);
}

/**
 * @description Selects the least-loaded desk for a given task, preferring desks already processing the same task type.
 * @param {Task} task - The task that needs a desk assignment.
 * @returns {Desk|null} The best available desk, or null if no desks exist.
 */
export function findBestDeskForTask(task) {
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

/**
 * @description Normalizes a raw task object, applying type-specific defaults and validating required fields.
 * @param {Partial<Task>} task - The raw task object to normalize.
 * @returns {Task} A fully normalized task with all required fields set.
 * @throws {Error} Throws `'missing_prompt'` when normalizing an `image_render` task that has no design prompt.
 */
export function normalizeTask(task) {
  const payload = task.payload && typeof task.payload === 'object' ? { ...task.payload } : {};
  const fixedRenderChannelId = '1491500223288184964';

  if (task.workflowContextInput && payload.context === undefined) {
    payload.context = cloneContext(task.workflowContextInput);
  }

  const normalizedTask = {
    id: task.id ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: task.type ?? TASK_TYPE_DISCORD,
    tool: task.tool ?? null,
    title: task.title ?? 'Untitled task',
    progress: task.progress ?? 0,
    required: task.required ?? 100,
    priority: normalizePriority(task.priority, task),
    status: task.status ?? TASK_STATUS_PENDING,
    action: task.action ?? null,
    payload,
    retries: task.retries ?? 0,
    maxRetries: task.maxRetries ?? 3,
    workflowId: task.workflowId ?? null,
    workflowStepIndex: typeof task.workflowStepIndex === 'number' ? task.workflowStepIndex : null,
    workflowContextInput: task.workflowContextInput ? cloneContext(task.workflowContextInput) : null
  };

  if (normalizedTask.type === TASK_TYPE_DISCORD) {
    normalizedTask.payload = {
      channelId: normalizedTask.payload && normalizedTask.payload.channelId ? normalizedTask.payload.channelId : null,
      content: normalizedTask.payload && typeof normalizedTask.payload.content === 'string' ? normalizedTask.payload.content : '',
      ...normalizedTask.payload
    };

    if (!normalizedTask.payload.channelId) {
      console.warn('Missing channelId for Discord task', {
        taskId: normalizedTask.id,
        type: normalizedTask.type,
        payload: normalizedTask.payload
      });
    }
  }

  if (normalizedTask.type === TASK_TYPE_IMAGE_RENDER) {
    normalizedTask.renderId = task.renderId ?? payload.renderId ?? normalizedTask.id;
    normalizedTask.productId = task.productId ?? payload.productId ?? normalizedTask.id;
    normalizedTask.provider = task.provider ?? payload.provider ?? 'openai';
    normalizedTask.designIntent = task.designIntent && typeof task.designIntent === 'object'
      ? { ...task.designIntent }
      : (payload.designIntent && typeof payload.designIntent === 'object' ? { ...payload.designIntent } : {});

    normalizedTask.designIntent = {
      ...normalizedTask.designIntent,
      prompt: typeof normalizedTask.designIntent.prompt === 'string'
        ? normalizedTask.designIntent.prompt.trim()
        : ''
    };

    normalizedTask.payload = {
      ...normalizedTask.payload,
      renderId: normalizedTask.renderId,
      productId: normalizedTask.productId,
      provider: normalizedTask.provider,
      designIntent: normalizedTask.designIntent
    };

    normalizedTask.content = normalizedTask.designIntent.prompt || normalizedTask.content || '';
    normalizedTask.channelId = fixedRenderChannelId;
    normalizedTask.payload.content = normalizedTask.content;
    normalizedTask.payload.channelId = fixedRenderChannelId;

    console.log('[Normalize image_render]', normalizedTask);

    if (!normalizedTask.content) {
      throw new Error('missing_prompt');
    }
  }

  return normalizedTask;
}

/**
 * @description Sends a task acknowledgement to the bridge server, completing the canonical `execute → ack` lifecycle step.
 * Accepts two calling conventions: `(taskObject, ackObject)` or `(taskId, status, retries, executionResult, payload)`.
 * @param {Task|string} taskOrId - The task object or its string ID.
 * @param {{ status: string, retries: number, executionResult: ExecutionResult|null, payload?: Object }|string} statusOrAck - An ack object when `taskOrId` is a Task, or a status string when `taskOrId` is a string ID.
 * @param {number} [retries] - Retry count (only used in the string-ID calling convention).
 * @param {ExecutionResult} [executionResult] - Execution result (only used in the string-ID calling convention).
 * @param {Object} [payload] - Task payload (only used in the string-ID calling convention).
 * @returns {Promise<void>}
 */
export async function sendTaskAck(taskOrId, statusOrAck, retries, executionResult, payload) {
  let task = null;
  let taskId = null;
  let ack = null;

  if (taskOrId && typeof taskOrId === 'object') {
    task = taskOrId;
    taskId = task.id || null;
    if (statusOrAck && typeof statusOrAck === 'object') {
      ack = {
        status: statusOrAck.status,
        retries: typeof statusOrAck.retries === 'number' ? statusOrAck.retries : task.retries,
        executionResult: statusOrAck.executionResult,
        payload: statusOrAck.payload && typeof statusOrAck.payload === 'object' ? statusOrAck.payload : task.payload
      };
    }
  } else {
    taskId = taskOrId;
    ack = {
      status: statusOrAck,
      retries,
      executionResult,
      payload: payload && typeof payload === 'object' ? payload : undefined
    };
  }

  if (!taskId || !ack || (ack.status !== TASK_STATUS_DONE && ack.status !== TASK_STATUS_FAILED)) {
    return;
  }

  if (task && task._executionInFlight === true && task._executionComplete !== true) {
    console.error('[ACK_BEFORE_EXECUTION_COMPLETE]', {
      taskId,
      status: ack.status
    });
    throw new Error('ACK_BEFORE_EXECUTION_COMPLETE');
  }

  if (task) {
    await registerTaskInBridge({
      ...task,
      payload: task.payload && typeof task.payload === 'object' ? task.payload : {}
    });
  }

  console.log('[TASK]', 'before_ack', taskId, {
    status: ack.status,
    retries: ack.retries,
    hasPayload: !!ack.payload,
    channelId: ack.payload && ack.payload.channelId ? ack.payload.channelId : null
  });

  try {
    let response = await fetch(`/task/${encodeURIComponent(taskId)}/ack`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });

    // UI/manual tasks can occasionally race bridge persistence and ACK.
    // If ACK misses a task record, sync once and retry ACK.
    if (response.status === 404 && task) {
      const synced = await registerTaskInBridge({
        ...task,
        payload: task.payload && typeof task.payload === 'object' ? task.payload : {}
      });

      if (synced) {
        response = await fetch(`/task/${encodeURIComponent(taskId)}/ack`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({})
        });
      }
    }

    if (!response.ok) {
      console.warn('[TASK]', 'ack_non_ok', taskId, response.status);
    }
  } catch (error) {
    console.warn('[TASK]', 'ack_error', taskId, error && error.message);
  }
}

function inferCompletionSource(task) {
  if (!task || typeof task !== 'object') {
    return 'unknown';
  }

  if (task.workflowId) {
    return 'workflow';
  }

  if (task.meta && task.meta.source === 'discord-message') {
    return 'discord';
  }

  if (typeof task.id === 'string' && task.id.startsWith('manual-')) {
    return 'ui';
  }

  return 'system';
}

function completeTaskThroughAck(task, ackStatus, executionResult) {
  if (!task || task._executionComplete !== true) {
    console.error('[ACK_BEFORE_EXECUTION_COMPLETE]', {
      taskId: task && task.id ? task.id : null,
      ackStatus
    });
    throw new Error('ACK_BEFORE_EXECUTION_COMPLETE');
  }

  const source = inferCompletionSource(task);
  console.log('[TASK COMPLETE FLOW]', task.id, 'via', source);
  return sendTaskAck(task, {
    status: ackStatus,
    retries: task.retries,
    executionResult,
    payload: task.payload
  });
}

/**
 * @description Fires the `/task/{id}/start` bridge request to mark a task as started, with automatic retry on transient failures.
 * Start sync is observability-only; failures are logged but do not block task execution.
 * @param {Task} task - The task whose start should be synced to the bridge server.
 * @param {number} [attempt=0] - Current retry attempt count (used internally for exponential back-off).
 * @returns {void}
 */
export function syncTaskStart(task, attempt = 0) {
  if (!task || !task.id || task._startedSynced || task._startSyncInFlight || task._startSyncDisabled) {
    return;
  }

  task._startSyncInFlight = true;

  (async () => {
    try {
      if (task.type === TASK_TYPE_IMAGE_RENDER || (typeof task.id === 'string' && task.id.startsWith('manual-'))) {
        await registerTaskInBridge(task);
      }

      let response = await fetch(`/task/${encodeURIComponent(task.id)}/start`, {
        method: 'POST'
      });

      // Manual/UI tasks may not exist in bridge yet when start sync runs.
      // Register once and retry start.
      if (response.status === 404) {
        const synced = await registerTaskInBridge(task);
        if (synced) {
          response = await fetch(`/task/${encodeURIComponent(task.id)}/start`, {
            method: 'POST'
          });
        }
      }

      if (!response.ok) {
        throw new Error(`start_sync_${response.status}`);
      }

      task._startedSynced = true;
    } catch (error) {
      task._startedSynced = false;
      console.warn('[TASK]', 'start_sync_error', task.id, error && error.message);

      if (attempt < 2) {
        window.setTimeout(() => {
          syncTaskStart(task, attempt + 1);
        }, 500 * (attempt + 1));
      } else {
        // Start sync is observability only; avoid endless frame-level spam.
        task._startSyncDisabled = true;
      }
    } finally {
      task._startSyncInFlight = false;
    }
  })();
}

/**
 * @description Checks whether a task with the given ID is currently active or queued at any desk.
 * @param {string} taskId - The task ID to search for.
 * @returns {boolean} True if the task is found in any desk's current task or queue; false otherwise.
 */
export function hasTaskInSimulation(taskId) {
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

/**
 * @description Triggers asynchronous execution and ACK for a completed task, emitting TASK_COMPLETED and applying workflow completion logic.
 * Clears the desk's current task slot immediately so the next task can be claimed.
 * @param {Desk} desk - The desk at which the task was completed.
 * @param {Task} task - The task that finished its required work ticks.
 * @returns {void}
 */
export function handleTaskExecutionResult(desk, task) {
  console.log('[TASK]', 'completed', task.type, task.title);
  console.log('[TASK]', 'before_execution', task.id, {
    hasPayload: !!task.payload,
    channelId: task.payload && task.payload.channelId ? task.payload.channelId : null
  });

  task._executionInFlight = true;
  task._executionComplete = false;

  (async () => {
    try {
      const executionResult = await executeTask(task);
      task._executionComplete = true;
      console.log('[TASK_EXECUTE_FINISHED]', {
        taskId: task.id,
        success: !(executionResult && executionResult.success === false)
      });

      emitEvent(EVENT_TASK_COMPLETED, {
        taskId: task.id,
        taskType: task.type,
        deskIndex: desks.indexOf(desk),
        success: !(executionResult && executionResult.success === false),
        error: executionResult && executionResult.success === false ? executionResult.error : null,
        channelId: task.payload && task.payload.channelId ? task.payload.channelId : null,
        content: task.payload && typeof task.payload.content === 'string' ? task.payload.content : null
      });
      applyWorkflowTaskCompletion(task, executionResult);
      const ackStatus = executionResult && executionResult.success === false ? TASK_STATUS_FAILED : TASK_STATUS_DONE;
      task.localLifecycleStatus = ackStatus;
      await completeTaskThroughAck(task, ackStatus, executionResult || { success: false, error: 'Missing execution result' });
      desk.completedTasks += 1;
    } catch (error) {
      emitEvent(EVENT_TASK_COMPLETED, {
        taskId: task.id,
        taskType: task.type,
        deskIndex: desks.indexOf(desk),
        success: false,
        error: error && error.message ? error.message : 'Execution failed',
        channelId: task.payload && task.payload.channelId ? task.payload.channelId : null,
        content: task.payload && typeof task.payload.content === 'string' ? task.payload.content : null
      });

      // If execution never completed, ACK is blocked by guard and we keep lifecycle non-authoritative in UI.
      if (task && task._executionComplete !== true) {
        task.localLifecycleStatus = TASK_STATUS_AWAITING_ACK;
        console.error('[TASK]', 'execution_incomplete_ack_blocked', {
          taskId: task.id,
          error: error && error.message ? error.message : 'Execution failed'
        });
        return;
      }

      const failureResult = { success: false, error: error && error.message ? error.message : 'Execution failed' };
      applyWorkflowTaskCompletion(task, failureResult);
      task.localLifecycleStatus = TASK_STATUS_FAILED;
      await completeTaskThroughAck(task, TASK_STATUS_FAILED, failureResult);
      desk.completedTasks += 1;
    } finally {
      task._executionInFlight = false;
    }
  })();

  desk.currentTask = null;
}

/**
 * @description Normalizes and places a task onto the best available desk, emitting TASK_CREATED (and RENDER_TASK_CREATED for image renders).
 * @param {Partial<Task>} task - The raw task object to enqueue.
 * @returns {Desk|null} The desk the task was added to, or null if the task is a duplicate or no desk is available.
 * @throws {Error} Throws `'missing_prompt'` if the task is an `image_render` type with no design prompt.
 */
export function addTaskToDesk(task) {
  const normalizedTask = normalizeTask(task);
  if (normalizedTask.type === TASK_TYPE_IMAGE_RENDER && !normalizedTask.content) {
    throw new Error('missing_prompt');
  }

  if (hasTaskInSimulation(normalizedTask.id)) {
    return null;
  }

  const desk = findBestDeskForTask(normalizedTask);
  if (!desk) {
    return null;
  }

  const queuedTask = {
    ...normalizedTask,
    status: TASK_STATUS_PENDING,
    payload: normalizedTask && typeof normalizedTask.payload === 'object' && normalizedTask.payload !== null
      ? { ...normalizedTask.payload }
      : {}
  };

  desk.queue.push(queuedTask);
  desk.queue.sort((a, b) => b.priority - a.priority);
  console.log('[TASK]', 'added', queuedTask.type, queuedTask.title);
  console.log('[TASK][QUEUE]', queuedTask);
  console.log('[TASK]', 'task_creation', queuedTask.id, {
    hasPayload: !!queuedTask.payload,
    channelId: queuedTask.payload && queuedTask.payload.channelId ? queuedTask.payload.channelId : null,
    content: queuedTask.payload && typeof queuedTask.payload.content === 'string' ? queuedTask.payload.content : null
  });
  console.log('[TASK]', 'after_creation', queuedTask.id, {
    hasPayload: !!queuedTask.payload,
    channelId: queuedTask.payload && queuedTask.payload.channelId ? queuedTask.payload.channelId : null
  });
  emitEvent('TASK_CREATED', {
    taskId: queuedTask.id,
    taskType: queuedTask.type,
    deskIndex: desks.indexOf(desk),
    priority: queuedTask.priority,
    workflowId: queuedTask.workflowId || null
  });
  if (queuedTask.type === TASK_TYPE_IMAGE_RENDER) {
    emitEvent('RENDER_TASK_CREATED', {
      taskId: queuedTask.id,
      productId: queuedTask.productId || (queuedTask.payload && queuedTask.payload.productId) || queuedTask.id,
      renderId: queuedTask.renderId || (queuedTask.payload && queuedTask.payload.renderId) || queuedTask.id,
      provider: queuedTask.provider || (queuedTask.payload && queuedTask.payload.provider) || 'openai',
      workflowId: queuedTask.workflowId || null
    });
  }
  return desk;
}

/**
 * @description Routes an incoming task to the correct handler: starts a product workflow for `start_product_workflow` actions, or enqueues the task directly.
 * @param {Partial<Task>} task - The task to route and ingest; silently ignored if falsy or missing a type.
 * @returns {void}
 */
export function ingestTask(task) {
  if (!task || !task.type) {
    return;
  }

  if (task.type === TASK_TYPE_DISCORD && task.action === ACTION_START_PRODUCT_WORKFLOW) {
    createProductWorkflowFromTask(task);
    return;
  }

  addTaskToDesk(task);
}

/**
 * @description Randomly injects synthetic Discord and Shopify tasks into the simulation; only active in DEV_MODE.
 * @returns {void}
 */
export function simulateIncomingTasks() {
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

/**
 * @description Returns a safe, read-only summary of a task, omitting internal lifecycle fields.
 * @param {Task|null|undefined} task - The task to sanitize.
 * @returns {TaskSummary|null} A sanitized view object, or null if the task is falsy.
 */
export function sanitizeTaskForView(task) {
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
    provider: task.provider || null,
    productId: task.productId || null,
    renderId: task.renderId || null,
    workflowId: task.workflowId || null,
    workflowStepIndex: typeof task.workflowStepIndex === 'number' ? task.workflowStepIndex : null
  };
}

// --- Bridge polling ---
let bridgeLastEventId = 0;
let bridgePollingStarted = false;

/**
 * @description Polls the bridge server for new events and appends them to the event store.
 * Silently ignores network errors to avoid disrupting the simulation loop.
 * @returns {Promise<void>}
 */
export async function pollBridgeTasks() {
  try {
    const response = await fetch(`/events?after=${bridgeLastEventId}`);
    if (!response.ok) {
      return;
    }

    const data = await response.json();
    if (!data || !Array.isArray(data.events)) {
      return;
    }

    appendRawEvents(data.events);

    for (const event of data.events) {
      if (typeof event.id === 'number') {
        bridgeLastEventId = Math.max(bridgeLastEventId, event.id);
      }
    }
  } catch (error) {
    console.warn('[BRIDGE]', 'poll_error', error && error.message);
  }
}

/**
 * @description Starts the recurring bridge polling interval; safe to call multiple times (idempotent).
 * @returns {void}
 */
export function startBridgePolling() {
  if (bridgePollingStarted) {
    return;
  }

  bridgePollingStarted = true;
  pollBridgeTasks();
  window.setInterval(pollBridgeTasks, BRIDGE_POLL_INTERVAL_MS);
}
