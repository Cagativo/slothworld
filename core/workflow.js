import { generateId, randomInRange, cloneContext, isPlainObject, sanitizeJsonValue } from './utils.js';
import {
  DEFAULT_WORKFLOW_STEP_MAX_RETRIES,
  TASK_TYPE_DISCORD,
  TASK_TYPE_SHOPIFY,
  TASK_TYPE_IMAGE_RENDER,
  ACTION_REPLY_TO_MESSAGE,
  ACTION_RENDER_PRODUCT_IMAGE,
  TASK_STATUS_FAILED,
  WORKFLOW_STATUS_PENDING_APPROVAL,
  WORKFLOW_STATUS_RUNNING,
  TASK_REQUIRED_DISCORD_MIN,
  TASK_REQUIRED_DISCORD_MAX
} from './constants.js';
import { workflows, emitEvent } from './app-state.js';
// Circular with task-handling — safe: these are only called at runtime, never at module init.
import { addTaskToDesk, sendTaskAck, executeDiscordTask } from './task-handling.js';

/**
 * @typedef {Object} WorkflowStep
 * @description A single step definition within a workflow pipeline.
 * @property {string} [tool] - Dot-separated tool name (e.g. `'research.query'`).
 * @property {string} [action] - Action identifier for task routing.
 * @property {string} [contextKey] - Key under which step output is stored in the workflow context.
 * @property {string} [title] - Human-readable step title.
 * @property {string} [description] - Longer description of what the step does.
 * @property {string} [complexity='med'] - Complexity hint: `'low'`, `'med'`, or `'high'`.
 * @property {string} [rolePreference='any'] - Preferred agent role: `'researcher'`, `'executor'`, or `'any'`.
 * @property {string} [type] - Task type constant (TASK_TYPE_*).
 * @property {Object} [payload={}] - Static payload merged into the task payload at enqueue time.
 * @property {number} [priority=1] - Task priority: 0 (low), 1 (normal), or 2 (high).
 * @property {number} [required] - Required work ticks; defaults to a random range when omitted.
 * @property {number} [maxRetries] - Maximum retry attempts before the step is marked failed.
 */

/**
 * @typedef {Object} WorkflowPlanStep
 * @description A compiled, read-only plan step produced by {@link buildWorkflowPlan}.
 * @property {string} id - Step identifier in the format `step-{index}`.
 * @property {number} index - Zero-based position in the plan.
 * @property {string|null} tool - Resolved tool name, or null if not specified.
 * @property {string|null} action - Resolved action identifier, or null if not specified.
 * @property {string} type - Task type constant.
 * @property {string} title - Human-readable step title.
 * @property {string} description - Step description.
 * @property {string} complexity - Complexity hint.
 * @property {string} rolePreference - Preferred agent role.
 * @property {Object} payload - Static payload for the step.
 */

/**
 * @typedef {Object} WorkflowInput
 * @description Input object passed to {@link createWorkflow}.
 * @property {string} [id] - Optional workflow ID; auto-generated if omitted.
 * @property {Object} context - Initial workflow context key/value store.
 * @property {WorkflowStep[]} steps - Ordered list of pipeline steps.
 * @property {boolean} [shouldPlan=true] - When true, a plan is built and the workflow starts in `pending_approval` status.
 */

/**
 * @typedef {Object} Workflow
 * @description Internal workflow state object stored in the workflows map.
 * @property {string} id - Unique workflow identifier.
 * @property {Object} context - Mutable key/value store accumulating step outputs.
 * @property {WorkflowStep[]} steps - Original ordered step definitions.
 * @property {string[]} stepStatuses - Per-step status string (TASK_STATUS_* or WORKFLOW_STATUS_*).
 * @property {number[]} stepAttempts - Per-step attempt counter.
 * @property {number[]} stepMaxRetries - Per-step maximum retry limits.
 * @property {number} currentStepIndex - Zero-based index of the currently active step.
 * @property {string} status - Overall workflow status (WORKFLOW_STATUS_* or TASK_STATUS_*).
 * @property {WorkflowPlanStep[]|null} plan - Compiled plan, or null when `shouldPlan` is false.
 * @property {number} createdAt - Unix timestamp (ms) of workflow creation.
 * @property {number|null} approvedAt - Unix timestamp (ms) of approval, or null.
 * @property {number|null} completedAt - Unix timestamp (ms) of completion, or null.
 * @property {number|null} failedAt - Unix timestamp (ms) of failure, or null.
 */

/**
 * @typedef {Object} WorkflowContextEntry
 * @description Record written into the workflow context when a step finishes.
 * @property {string} taskId - ID of the task that executed this step.
 * @property {string} status - Final step status ('done' or 'failed').
 * @property {Object|null} input - Snapshot of context passed into the step.
 * @property {Object|null} output - Execution result returned by the tool.
 * @property {number} attempts - Number of attempts made (including the current one).
 * @property {number} maxRetries - Maximum retries allowed for this step.
 * @property {number} completedAt - Unix timestamp (ms) of step completion.
 */

/**
 * @typedef {Object} WorkflowSnapshot
 * @description Read-only public representation of a workflow returned by {@link buildWorkflowSnapshot}.
 * @property {string} id - Workflow identifier.
 * @property {string} status - Current overall workflow status.
 * @property {{ index: number, name: string, status: string }} currentStep - Summary of the active step.
 * @property {Array<{ index: number, name: string, status: string }>} completedSteps - All completed steps.
 * @property {Object} contextSnapshot - Immutable clone of the workflow context.
 * @property {number} createdAt - Unix timestamp (ms) of workflow creation.
 * @property {number|null} completedAt - Unix timestamp (ms) of completion, or null.
 * @property {number|null} failedAt - Unix timestamp (ms) of failure, or null.
 * @property {number} totalSteps - Total number of steps in the workflow.
 */

/**
 * @description Validates and sanitizes a raw workflow context entry, returning null if the result is not a plain object.
 * @param {*} entry - The raw entry to sanitize and validate.
 * @returns {Object|null} A sanitized plain object, or null if the entry is not valid.
 */
export function validateWorkflowContextEntry(entry) {
  const sanitizedEntry = sanitizeJsonValue(entry);
  if (!isPlainObject(sanitizedEntry)) {
    return null;
  }

  return sanitizedEntry;
}

/**
 * @description Infers a default numeric priority from a task's title and type.
 * @param {{ title?: string, type?: string }} task - The task to evaluate.
 * @returns {number} Priority level: 0 (low), 1 (normal), or 2 (high).
 */
export function inferDefaultPriority(task) {
  const title = (task.title || '').toLowerCase();

  if (title.includes('log') || title.includes('passive')) {
    return 0;
  }

  if (task.type === TASK_TYPE_DISCORD && (title.includes('mention') || title.includes('command'))) {
    return 2;
  }

  if (task.type === TASK_TYPE_SHOPIFY && title.includes('order')) {
    return 2;
  }

  return 1;
}

/**
 * @description Compiles an ordered array of {@link WorkflowPlanStep} objects from raw step definitions.
 * @param {WorkflowStep[]} steps - Raw step definitions from the workflow input.
 * @param {string} [keyword] - Optional keyword associated with the workflow (currently unused in plan output).
 * @returns {WorkflowPlanStep[]} Compiled plan with normalised defaults applied to every step.
 */
export function buildWorkflowPlan(steps, keyword) {
  return steps.map((step, index) => ({
    id: `step-${index}`,
    index,
    tool: step.tool || null,
    action: step.action || null,
    type: step.type || TASK_TYPE_DISCORD,
    title: step.title || `Step ${index + 1}`,
    description: step.description || step.title || `Unnamed step`,
    complexity: step.complexity || 'med',
    rolePreference: step.rolePreference || 'any',
    payload: step.payload || {}
  }));
}

/**
 * @description Creates and registers a new workflow, optionally building a plan and emitting a WORKFLOW_PLANNED event.
 * @param {WorkflowInput} workflowInput - The workflow definition including steps and context.
 * @returns {Workflow} The newly created and registered internal workflow object.
 */
export function createWorkflow(workflowInput) {
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
    status: shouldPlan ? WORKFLOW_STATUS_PENDING_APPROVAL : WORKFLOW_STATUS_RUNNING,
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

/**
 * @description Returns a human-readable name for the step at the given index.
 * @param {Workflow} workflow - The workflow whose step should be named.
 * @param {number} stepIndex - Zero-based step index.
 * @returns {string} The step action, title, or a fallback string of the form `step_{index}`.
 */
export function getWorkflowStepName(workflow, stepIndex) {
  if (!workflow || !Array.isArray(workflow.steps) || stepIndex < 0 || stepIndex >= workflow.steps.length) {
    return `step_${stepIndex}`;
  }

  const step = workflow.steps[stepIndex] || {};
  return step.action || step.title || `step_${stepIndex}`;
}

/**
 * @description Logs a step status transition and emits a WORKFLOW_STEP_CHANGED event.
 * @param {Workflow} workflow - The workflow containing the transitioning step.
 * @param {number} stepIndex - Zero-based index of the step being transitioned.
 * @param {string} toStatus - The new status being applied to the step.
 * @returns {void}
 */
export function logWorkflowStepTransition(workflow, stepIndex, toStatus) {
  const stepName = getWorkflowStepName(workflow, stepIndex);
  console.log(`[WORKFLOW][${workflow.id}][STEP] ${stepName} → ${toStatus}`);
  emitEvent('WORKFLOW_STEP_CHANGED', {
    workflowId: workflow.id,
    stepIndex,
    stepName,
    status: toStatus
  });
}

/**
 * @description Sends a Discord failure notification for a workflow step, using channel information from the workflow context or task payload.
 * @param {Workflow} workflow - The workflow that encountered the failure.
 * @param {import('./task-handling.js').Task} task - The task whose step failed.
 * @param {import('./task-handling.js').ExecutionResult} executionResult - The execution result describing the failure.
 * @returns {Promise<void>}
 */
export async function sendWorkflowFailureDiscordMessage(workflow, task, executionResult) {
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
    type: TASK_TYPE_DISCORD,
    internal: true,
    domain: 'system',
    correlationId: workflow.id,
    depth: 1,
    action: ACTION_REPLY_TO_MESSAGE,
    payload: {
      correlationId: workflow.id,
      depth: 1,
      channelId,
      messageId,
      content: `Workflow failed for "${keyword}" at step "${stepName}". Error: ${reason}`
    }
  });
}

/**
 * @description Builds a read-only snapshot of internal workflow state suitable for API responses and UI consumption.
 * @param {Workflow|null|undefined} workflow - The internal workflow object to snapshot.
 * @returns {WorkflowSnapshot|null} A snapshot object, or null if workflow is falsy.
 */
export function buildWorkflowSnapshot(workflow) {
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

/**
 * @description Returns a public snapshot of the workflow with the given ID.
 * @param {string} id - The workflow ID to look up.
 * @returns {WorkflowSnapshot|null} The workflow snapshot, or null if no workflow with that ID exists.
 */
export function getWorkflow(id) {
  if (!id) {
    return null;
  }

  return buildWorkflowSnapshot(workflows.get(id));
}

/**
 * @description Returns public snapshots for all registered workflows.
 * @returns {WorkflowSnapshot[]} Array of workflow snapshots, one per registered workflow.
 */
export function listWorkflows() {
  return Array.from(workflows.values()).map((workflow) => buildWorkflowSnapshot(workflow));
}

/**
 * @description Transitions a pending-approval workflow to running status and enqueues its first step.
 * @param {string} workflowId - The ID of the workflow to approve and start.
 * @returns {boolean} True if enqueuing succeeded; false if the workflow was not found or has no steps.
 */
export function enqueueAllWorkflowSteps(workflowId) {
  const workflow = workflows.get(workflowId);
  if (!workflow || !workflow.steps || workflow.steps.length === 0) {
    return false;
  }

  workflow.status = WORKFLOW_STATUS_RUNNING;
  workflow.approvedAt = Date.now();
  enqueueWorkflowStep(workflow.id, 0);
  return true;
}

/**
 * @description Creates a task for the specified workflow step and places it on the best available desk.
 * @param {string} workflowId - The ID of the workflow containing the step to enqueue.
 * @param {number} stepIndex - Zero-based index of the step to enqueue.
 * @returns {import('./task-handling.js').Task|null} The enqueued task, or null if preconditions were not met.
 */
export function enqueueWorkflowStep(workflowId, stepIndex) {
  const workflow = workflows.get(workflowId);
  if (!workflow || workflow.status !== WORKFLOW_STATUS_RUNNING || stepIndex < 0 || stepIndex >= workflow.steps.length) {
    return null;
  }

  const step = workflow.steps[stepIndex];
  const task = {
    id: `${workflow.id}-step-${stepIndex}`,
    type: step.type || TASK_TYPE_DISCORD,
    tool: step.tool || null,
    action: step.action || step.tool || ACTION_REPLY_TO_MESSAGE,
    title: step.title || `${workflow.id}:${step.tool || step.action || `step_${stepIndex}`}`,
    priority: step.priority ?? 1,
    required: step.required ?? randomInRange(TASK_REQUIRED_DISCORD_MIN, TASK_REQUIRED_DISCORD_MAX),
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
  workflow.stepStatuses[stepIndex] = WORKFLOW_STATUS_RUNNING;
  logWorkflowStepTransition(workflow, stepIndex, WORKFLOW_STATUS_RUNNING);
  return task;
}

/**
 * @description Processes the result of a completed workflow step task, advancing, retrying, or failing the workflow as appropriate.
 * @param {import('./task-handling.js').Task} task - The task that just finished executing.
 * @param {import('./task-handling.js').ExecutionResult} executionResult - The execution result from the task.
 * @returns {void}
 */
export function applyWorkflowTaskCompletion(task, executionResult) {
  if (!task || !task.workflowId) {
    return;
  }

  const workflow = workflows.get(task.workflowId);
  if (!workflow || workflow.status !== WORKFLOW_STATUS_RUNNING) {
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
  const stepStatus = isFailedStep ? TASK_STATUS_FAILED : 'done';
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
    workflow.stepStatuses[stepIndex] = TASK_STATUS_FAILED;
    workflow.status = TASK_STATUS_FAILED;
    workflow.failedAt = Date.now();
    logWorkflowStepTransition(workflow, stepIndex, TASK_STATUS_FAILED);
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

    workflow.status = TASK_STATUS_FAILED;
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

/**
 * @description Creates a five-step product workflow (research → design prompt → image render → listing → Discord reply) from a `start_product_workflow` command task.
 * @param {import('./task-handling.js').Task} task - The command task that triggered the product workflow.
 * @returns {Workflow} The newly created and registered product workflow object.
 */
export function createProductWorkflowFromTask(task) {
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
        type: TASK_TYPE_SHOPIFY
      },
      {
        tool: 'shopify.generate_design_prompt',
        contextKey: 'generate_design_prompt',
        title: `Generate design prompt: ${keyword}`,
        description: `Create a design brief based on research findings`,
        complexity: 'med',
        rolePreference: 'executor',
        type: TASK_TYPE_SHOPIFY
      },
      {
        action: ACTION_RENDER_PRODUCT_IMAGE,
        contextKey: 'render_product_image',
        title: `Render product image: ${keyword}`,
        description: `Render a product visual through the provider-agnostic image pipeline`,
        complexity: 'high',
        rolePreference: 'executor',
        type: TASK_TYPE_IMAGE_RENDER,
        payload: {
          productId: `product-${keyword.replace(/\s+/g, '-').toLowerCase()}`,
          provider: 'openai',
          designIntent: {
            product_name: keyword,
            style: 'ecommerce product illustration',
            mood: 'confident and commercial',
            colors: ['neutral', 'brand-accent'],
            composition: 'centered hero shot',
            camera: 'front-facing studio shot',
            background: 'clean marketplace backdrop'
          }
        }
      },
      {
        tool: 'shopify.create_product_listing',
        contextKey: 'create_product_listing',
        title: `Create listing: ${keyword}`,
        description: `Create Shopify product listing with all details`,
        complexity: 'med',
        rolePreference: 'executor',
        type: TASK_TYPE_SHOPIFY
      },
      {
        tool: 'discord.reply',
        contextKey: 'reply_to_message',
        title: `Reply with listing: ${keyword}`,
        description: `Send completion notice to Discord channel`,
        complexity: 'low',
        rolePreference: 'any',
        type: TASK_TYPE_DISCORD,
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
  sendTaskAck(task, {
    status: 'done',
    retries: task.retries || 0,
    executionResult: {
      success: true,
      workflowId: workflow.id,
      note: 'Converted command task into workflow'
    },
    payload: task.payload
  });

  return workflow;
}

/**
 * @description Approves a pending-approval workflow, starting execution of its first step.
 * @param {string} workflowId - The ID of the workflow to approve.
 * @returns {{ success: boolean, error?: string, data?: WorkflowSnapshot }} Result object indicating success or failure.
 */
export function approveWorkflow(workflowId) {
  const workflow = workflows.get(workflowId);
  if (!workflow) {
    return { success: false, error: 'workflow_not_found' };
  }

  if (workflow.status !== WORKFLOW_STATUS_PENDING_APPROVAL) {
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

/**
 * @description Rejects a pending-approval workflow, marking it as rejected and emitting a WORKFLOW_REJECTED event.
 * @param {string} workflowId - The ID of the workflow to reject.
 * @param {string} [reason='user_rejection'] - Human-readable rejection reason attached to the event payload.
 * @returns {{ success: boolean, error?: string, data?: WorkflowSnapshot }} Result object indicating success or failure.
 */
export function rejectWorkflow(workflowId, reason) {
  const workflow = workflows.get(workflowId);
  if (!workflow) {
    return { success: false, error: 'workflow_not_found' };
  }

  if (workflow.status !== WORKFLOW_STATUS_PENDING_APPROVAL) {
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

/**
 * @description Patches a step definition in a pending-approval workflow before execution begins.
 * @param {string} workflowId - The ID of the workflow containing the step.
 * @param {string} stepId - Step ID in the format `step-{index}`.
 * @param {Partial<WorkflowStep>} patch - Partial step properties to merge into the existing step.
 * @returns {{ success: boolean, error?: string, data?: { stepIndex: number, step: WorkflowStep } }} Result object.
 */
export function editWorkflowStep(workflowId, stepId, patch) {
  const workflow = workflows.get(workflowId);
  if (!workflow) {
    return { success: false, error: 'workflow_not_found' };
  }

  if (workflow.status !== WORKFLOW_STATUS_PENDING_APPROVAL) {
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

/**
 * @description Returns public snapshots of all workflows; alias for {@link listWorkflows} used by the control panel.
 * @returns {WorkflowSnapshot[]} Array of workflow snapshots.
 */
export function getWorkflowsControl() {
  return listWorkflows();
}
