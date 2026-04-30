import { generateId, randomInRange, cloneContext, isPlainObject, sanitizeJsonValue } from './utils.js';
import {
  DEFAULT_WORKFLOW_STEP_MAX_RETRIES,
  TASK_TYPE_DISCORD,
  TASK_TYPE_SHOPIFY,
  TASK_TYPE_IMAGE_RENDER,
  ACTION_REPLY_TO_MESSAGE,
  ACTION_RENDER_PRODUCT_IMAGE,
  TASK_STATUS_PENDING,
  TASK_STATUS_DONE,
  TASK_STATUS_FAILED,
  WORKFLOW_STATUS_PENDING_APPROVAL,
  WORKFLOW_STATUS_RUNNING,
  TASK_REQUIRED_DISCORD_MIN,
  TASK_REQUIRED_DISCORD_MAX
} from './constants.js';
import { workflows, emitEvent } from './app-state.js';
// Circular with task-handling — safe: these are only called at runtime, never at module init.
import { addTaskToDesk, sendTaskAck, executeDiscordTask } from './task-handling.js';

export function validateWorkflowContextEntry(entry) {
  const sanitizedEntry = sanitizeJsonValue(entry);
  if (!isPlainObject(sanitizedEntry)) {
    return null;
  }

  return sanitizedEntry;
}

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

export function createWorkflow(workflowInput) {
  const shouldPlan = workflowInput.shouldPlan !== false;
  const plan = shouldPlan ? buildWorkflowPlan(workflowInput.steps || [], workflowInput.context && workflowInput.context.keyword) : null;

  const workflow = {
    id: workflowInput.id || `workflow-${generateId()}`,
    context: cloneContext(workflowInput.context),
    steps: Array.isArray(workflowInput.steps) ? workflowInput.steps.slice() : [],
    stepStatuses: Array.isArray(workflowInput.steps) ? workflowInput.steps.map(() => TASK_STATUS_PENDING) : [],
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

export function getWorkflowStepName(workflow, stepIndex) {
  if (!workflow || !Array.isArray(workflow.steps) || stepIndex < 0 || stepIndex >= workflow.steps.length) {
    return `step_${stepIndex}`;
  }

  const step = workflow.steps[stepIndex] || {};
  return step.action || step.title || `step_${stepIndex}`;
}

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

export function buildWorkflowSnapshot(workflow) {
  if (!workflow) {
    return null;
  }

  const currentStepName = getWorkflowStepName(workflow, workflow.currentStepIndex);
  const currentStepStatus = workflow.stepStatuses[workflow.currentStepIndex] || TASK_STATUS_PENDING;
  const completedSteps = workflow.steps
    .map((step, index) => ({
      index,
      name: step.action || step.title || `step_${index}`,
      status: workflow.stepStatuses[index] || TASK_STATUS_PENDING
    }))
    .filter((step) => step.status === TASK_STATUS_DONE);

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

export function getWorkflow(id) {
  if (!id) {
    return null;
  }

  return buildWorkflowSnapshot(workflows.get(id));
}

export function listWorkflows() {
  return Array.from(workflows.values()).map((workflow) => buildWorkflowSnapshot(workflow));
}

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
    status: TASK_STATUS_PENDING
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
  const stepStatus = isFailedStep ? TASK_STATUS_FAILED : TASK_STATUS_DONE;
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
    workflow.status = TASK_STATUS_DONE;
    workflow.completedAt = Date.now();
    return;
  }

  enqueueWorkflowStep(workflow.id, nextStepIndex);
}

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
    status: TASK_STATUS_DONE,
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

export function getWorkflowsControl() {
  return listWorkflows();
}
