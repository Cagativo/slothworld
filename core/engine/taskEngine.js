/**
 * 🚨 ARCHITECTURE LOCK
 *
 * This module participates in the event-sourced execution model.
 *
 * DO NOT:
 * - Infer lifecycle state
 * - Introduce fallback transitions
 * - Derive failure outside TASK_ACKED
 * - Treat any event other than TASK_ACKED as terminal authority
 *
 * ONLY TaskEngine defines lifecycle.
 * TASK_ACKED is the ONLY terminal authority.
 * ONLY events define truth.
 *
 * If something is missing -> FIX EVENT EMISSION, not derivation.
 */

import { registerTaskEngineCallerKey, runInTaskEngineExecutionContext } from './enforcementRuntime.js';
const DEFAULT_NOW = () => Date.now();

const TASK_ENGINE_CALLER_KEY = Symbol('TASK_ENGINE_CALLER_KEY');
registerTaskEngineCallerKey(TASK_ENGINE_CALLER_KEY);

const TREND_RESEARCH_TASK_TYPE = 'TREND_RESEARCH';

function resolveAssignedAgentId(task) {
  if (!task || typeof task !== 'object') {
    return null;
  }

  const payload = task.payload && typeof task.payload === 'object' ? task.payload : {};
  const candidates = [
    task.assignedAgentId,
    task.agentId,
    task.workerId,
    payload.assignedAgentId,
    payload.agentId,
    payload.workerId
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

export function createTaskEngine(options = {}) {
  const tasks = new Map();
  const queue = [];
  const running = new Map();

  const now = typeof options.now === 'function' ? options.now : DEFAULT_NOW;
  const executor = typeof options.executor === 'function'
    ? options.executor
    : async (task) => ({
      success: true,
      output: {
        taskId: task.id,
        status: 'executed'
      }
    });

  const log = typeof options.log === 'function'
    ? options.log
    : () => {};

  function emit(event, taskId, payload) {
    if (typeof event !== 'string' || event.trim().length === 0) {
      throw new Error('EVENT_SCHEMA_VIOLATION:event_required');
    }

    if (typeof taskId !== 'string' || taskId.trim().length === 0) {
      throw new Error('EVENT_SCHEMA_VIOLATION:taskId_required');
    }

    const timestamp = now();
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      throw new Error('EVENT_SCHEMA_VIOLATION:timestamp_required');
    }

    const taskEvent = {
      event,
      timestamp,
      taskId,
      payload: payload && typeof payload === 'object' ? payload : {}
    };

    if (typeof options.emitEvent === 'function') {
      options.emitEvent(taskEvent);
    }

    log('[TASK_ENGINE]', {
      event,
      taskId,
      ...(taskEvent.payload || {})
    });
  }

  function resolveTask(taskOrId) {
    const taskId = typeof taskOrId === 'string' ? taskOrId : taskOrId.id;
    const task = tasks.get(taskId);
    if (!task) {
      throw new Error(`task_not_found:${taskId}`);
    }

    return task;
  }

  function queueContains(taskId) {
    return queue.includes(taskId);
  }

  function removeFromQueue(taskId) {
    const index = queue.indexOf(taskId);
    if (index >= 0) {
      queue.splice(index, 1);
    }
  }

  function canRetry(task, result) {
    const retryable = result.retryable === true;
    return retryable && task.attempts < task.maxRetries;
  }

  function createTask(task) {
    if (!task || typeof task !== 'object' || !task.id) {
      throw new Error('invalid_task');
    }

    const existing = tasks.get(task.id);
    if (existing) {
      emit('TASK_CREATED', task.id, {
        deduplicated: true,
        status: existing.status
      });
      return existing;
    }

    const stored = {
      ...task,
      assignedAgentId: resolveAssignedAgentId(task),
      status: 'created',
      attempts: 0,
      maxRetries: typeof task.maxRetries === 'number' ? Math.max(0, task.maxRetries) : 3,
      createdAt: typeof task.createdAt === 'number' ? task.createdAt : now(),
      executionRecord: null
    };

    tasks.set(stored.id, stored);
    emit('TASK_CREATED', stored.id, {
      status: stored.status,
      type: stored.type
    });
    return stored;
  }

  function enqueueTask(taskOrId) {
    const task = typeof taskOrId === 'string'
      ? resolveTask(taskOrId)
      : createTask(taskOrId);

    if (task.status === 'acknowledged' || task.status === 'failed') {
      return task;
    }

    if (!queueContains(task.id)) {
      queue.push(task.id);
    }

    task.status = 'queued';
    emit('TASK_ENQUEUED', task.id, {
      queueSize: queue.length,
      attempts: task.attempts
    });

    return task;
  }

  function claimTask(taskId, workerId) {
    let claimed = null;

    if (typeof taskId === 'string') {
      const task = resolveTask(taskId);
      if (task.status !== 'queued') {
        return null;
      }
      removeFromQueue(task.id);
      claimed = task;
    } else {
      while (queue.length > 0) {
        const nextId = queue.shift();
        if (!nextId) {
          continue;
        }

        const nextTask = tasks.get(nextId);
        if (nextTask && nextTask.status === 'queued') {
          claimed = nextTask;
          break;
        }
      }
    }

    if (!claimed) {
      return null;
    }

      // Ownership is set at TASK_CLAIMED. The explicit workerId from the claimer
      // is authoritative. Fall back to resolveAssignedAgentId only when no
      // claimer workerId was provided (e.g. direct claimTask calls in tests).
      claimed.assignedAgentId =
        (typeof workerId === 'string' && workerId.trim() ? workerId.trim() : null)
        || resolveAssignedAgentId(claimed);

    claimed.status = 'claimed';
    claimed.claimedAt = now();
    emit('TASK_CLAIMED', claimed.id, {
      queueSize: queue.length,
      attempts: claimed.attempts,
      assignedAgentId: claimed.assignedAgentId,
      workerId: claimed.assignedAgentId
    });

    return claimed;
  }

  async function executeTask(taskOrId, options = {}) {
    const task = typeof taskOrId === 'string'
      ? resolveTask(taskOrId)
      : createTask(taskOrId);

    if (task.status === 'acknowledged' || task.status === 'failed') {
      const result = task.lastResult || {
        success: task.status === 'acknowledged',
        error: task.status === 'failed' ? 'already_failed' : undefined
      };
      emit('TASK_EXECUTE_SKIPPED_IDEMPOTENT', task.id, {
        status: task.status
      });
      return result;
    }

    if (task.status === 'awaiting_ack') {
      const result = task.lastResult || {
        success: false,
        error: 'awaiting_ack'
      };
      emit('TASK_EXECUTE_SKIPPED_IDEMPOTENT', task.id, {
        status: task.status
      });
      return result;
    }

    const activeExecution = running.get(task.id);
    if (activeExecution) {
      emit('TASK_EXECUTE_SKIPPED_IDEMPOTENT', task.id, {
        reason: 'already_executing'
      });
      return activeExecution;
    }

    if (task.status === 'created') {
      enqueueTask(task.id);
    }

    if (task.status === 'queued') {
      claimTask(task.id, options.workerId);
    }

    task.status = 'executing';
    task.attempts += 1;
    task.executedAt = now();
      // Preserve ownership set at TASK_CLAIMED; only re-resolve if still unset.
      task.assignedAgentId = task.assignedAgentId || resolveAssignedAgentId(task);

    emit('TASK_EXECUTE_STARTED', task.id, {
      attempts: task.attempts,
      maxRetries: task.maxRetries,
      assignedAgentId: task.assignedAgentId,
      workerId: task.assignedAgentId
    });

    const executionPromise = runInTaskEngineExecutionContext(task.id, TASK_ENGINE_CALLER_KEY, () => Promise.resolve(executor(task)))
      .then((rawResult) => {
        const result = {
          success: rawResult && rawResult.success === true,
          output: rawResult && rawResult.output ? rawResult.output : undefined,
          error: rawResult && rawResult.error ? rawResult.error : undefined,
          retryable: rawResult && rawResult.retryable === true
        };

        task.lastResult = result;
        task.executionRecord = {
          completedAt: now(),
          attempt: task.attempts,
          result
        };

        const shouldRetry = !result.success && canRetry(task, result);
        if (shouldRetry) {
          task.status = 'queued';
          if (!queueContains(task.id)) {
            queue.push(task.id);
          }
          emit('TASK_REQUEUED', task.id, {
            attempts: task.attempts,
            maxRetries: task.maxRetries,
            queueSize: queue.length
          });
          return result;
        }

        task.status = 'awaiting_ack';

        emit('TASK_EXECUTE_FINISHED', task.id, {
          success: result.success,
          retryable: result.retryable === true,
          status: task.status,
          assignedAgentId: task.assignedAgentId,
          workerId: task.assignedAgentId
        });

        return result;
      })
      .catch((error) => {
        const failure = {
          success: false,
          error: error instanceof Error ? error.message : 'execution_failed',
          retryable: false
        };

        task.lastResult = failure;
        task.executionRecord = {
          completedAt: now(),
          attempt: task.attempts,
          result: failure
        };
        task.status = 'awaiting_ack';

        emit('TASK_EXECUTE_FINISHED', task.id, {
          success: false,
          error: failure.error,
          status: task.status,
          assignedAgentId: task.assignedAgentId,
          workerId: task.assignedAgentId
        });

        return failure;
      })
      .finally(() => {
        running.delete(task.id);
      });

    running.set(task.id, executionPromise);
    return executionPromise;
  }

  async function ackTask(taskId) {
    const task = resolveTask(taskId);

    if (task.status !== 'awaiting_ack') {
      throw new Error('ENGINE_ENFORCEMENT_VIOLATION');
    }

    if (!task.executionRecord || !task.executionRecord.result) {
      throw new Error('ENGINE_ENFORCEMENT_VIOLATION');
    }

    task.assignedAgentId = resolveAssignedAgentId(task);

    task.lastResult = task.executionRecord.result;

    if (task.type === TREND_RESEARCH_TASK_TYPE && !task.assignedAgentId) {
      throw new Error('ENGINE_VIOLATION: missing assignedAgentId at completion');
    }

    task.status = task.lastResult.success ? 'acknowledged' : 'failed';
    task.acknowledgedAt = now();
    emit('TASK_ACKED', task.id, {
      status: task.status,
      attempts: task.attempts,
      success: task.lastResult.success,
      error: task.lastResult.success ? undefined : task.lastResult.error,
      assignedAgentId: task.assignedAgentId,
      workerId: task.assignedAgentId
    });

    if (typeof options.onTaskAcked === 'function') {
      try {
        await runInTaskEngineExecutionContext(task.id, TASK_ENGINE_CALLER_KEY, () => Promise.resolve(options.onTaskAcked(task)));
      } catch (error) {
        emit('TASK_ACK_SIDE_EFFECT_FAILED', task.id, {
          error: error instanceof Error ? error.message : 'ack_side_effect_failed'
        });
      }
    }

    return task;
  }

  function getTask(taskId) {
    return tasks.get(taskId) || null;
  }

  function getQueueSnapshot() {
    return [...queue];
  }

  return {
    createTask,
    enqueueTask,
    claimTask,
    executeTask,
    ackTask,
    getTask,
    getQueueSnapshot
  };
}
