import { registerTaskEngineCallerKey, runInTaskEngineExecutionContext } from './enforcementRuntime.js';
const DEFAULT_NOW = () => Date.now();

const TASK_ENGINE_CALLER_KEY = Symbol('TASK_ENGINE_CALLER_KEY');
registerTaskEngineCallerKey(TASK_ENGINE_CALLER_KEY);

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
    const taskEvent = {
      event,
      timestamp: now(),
      taskId,
      payload
    };

    if (typeof options.emitEvent === 'function') {
      options.emitEvent(taskEvent);
    }

    log('[TASK_ENGINE]', {
      event,
      taskId,
      ...(payload || {})
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

  function claimTask(taskId) {
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

    claimed.status = 'claimed';
    claimed.claimedAt = now();
    emit('TASK_CLAIMED', claimed.id, {
      queueSize: queue.length,
      attempts: claimed.attempts
    });

    return claimed;
  }

  async function executeTask(taskOrId) {
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
      claimTask(task.id);
    }

    task.status = 'executing';
    task.attempts += 1;
    task.executedAt = now();
    emit('TASK_EXECUTE_STARTED', task.id, {
      attempts: task.attempts,
      maxRetries: task.maxRetries
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
          status: task.status
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
          status: task.status
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

    task.lastResult = task.executionRecord.result;
    task.status = task.lastResult.success ? 'acknowledged' : 'failed';
    task.acknowledgedAt = now();
    emit('TASK_ACKED', task.id, {
      status: task.status,
      attempts: task.attempts,
      success: task.lastResult.success
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
