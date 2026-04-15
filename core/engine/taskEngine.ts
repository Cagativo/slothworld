export type TaskStatus =
  | 'created'
  | 'queued'
  | 'claimed'
  | 'executing'
  | 'awaiting_ack'
  | 'acknowledged'
  | 'failed';

export interface EngineTask {
  id: string;
  type: string;
  payload?: Record<string, unknown>;
  maxRetries?: number;
  createdAt?: number;
}

export interface TaskResult {
  success: boolean;
  output?: Record<string, unknown>;
  error?: string;
  retryable?: boolean;
}

export interface StoredTask extends EngineTask {
  status: TaskStatus;
  createdAt: number;
  claimedAt?: number;
  executedAt?: number;
  acknowledgedAt?: number;
  attempts: number;
  maxRetries: number;
  lastResult?: TaskResult;
  executionRecord?: {
    completedAt: number;
    attempt: number;
    result: TaskResult;
  };
}

export type TaskEngineEventName =
  | 'TASK_CREATED'
  | 'TASK_ENQUEUED'
  | 'TASK_CLAIMED'
  | 'TASK_EXECUTE_STARTED'
  | 'TASK_EXECUTE_SKIPPED_IDEMPOTENT'
  | 'TASK_EXECUTE_FINISHED'
  | 'TASK_ACKED'
  | 'TASK_REQUEUED';

export interface TaskEngineEvent {
  event: TaskEngineEventName;
  timestamp: number;
  taskId: string;
  payload?: Record<string, unknown>;
}

export interface TaskEngineOptions {
  emitEvent?: (event: TaskEngineEvent) => void;
  log?: (message: string, fields: Record<string, unknown>) => void;
  now?: () => number;
  executor?: (task: StoredTask) => Promise<TaskResult> | TaskResult;
}

export interface TaskEngine {
  createTask: (task: EngineTask) => StoredTask;
  enqueueTask: (task: EngineTask | string) => StoredTask;
  claimTask: (taskId?: string) => StoredTask | null;
  executeTask: (task: EngineTask | string) => Promise<TaskResult>;
<<<<<<< HEAD
  ackTask: (taskId: string) => StoredTask;
=======
  ackTask: (taskId: string, result: TaskResult) => StoredTask;
>>>>>>> 1a6ddc9 (docs: enforce TaskEngine execution model and invariants)
  getTask: (taskId: string) => StoredTask | null;
  getQueueSnapshot: () => string[];
}

export function createTaskEngine(options: TaskEngineOptions = {}): TaskEngine {
  const tasks = new Map<string, StoredTask>();
  const queue: string[] = [];
  const running = new Map<string, Promise<TaskResult>>();

  const now = options.now || (() => Date.now());
  const executor = options.executor || ((task: StoredTask) => Promise.resolve({
    success: true,
    output: {
      taskId: task.id,
      status: 'executed'
    }
  }));

  const log = options.log || ((message: string, fields: Record<string, unknown>) => {
    console.log(message, fields);
  });

  function emit(event: TaskEngineEventName, taskId: string, payload?: Record<string, unknown>): void {
    const taskEvent: TaskEngineEvent = {
      event,
      timestamp: now(),
      taskId,
      payload
    };

    if (options.emitEvent) {
      options.emitEvent(taskEvent);
    }

    log('[TASK_ENGINE]', {
      event,
      taskId,
      ...(payload || {})
    });
  }

  function resolveTask(taskOrId: EngineTask | string): StoredTask {
    const taskId = typeof taskOrId === 'string' ? taskOrId : taskOrId.id;
    const task = tasks.get(taskId);
    if (!task) {
      throw new Error(`task_not_found:${taskId}`);
    }

    return task;
  }

  function queueContains(taskId: string): boolean {
    return queue.includes(taskId);
  }

  function removeFromQueue(taskId: string): void {
    const index = queue.indexOf(taskId);
    if (index >= 0) {
      queue.splice(index, 1);
    }
  }

  function canRetry(task: StoredTask, result: TaskResult): boolean {
    const retryable = result.retryable === true;
    return retryable && task.attempts < task.maxRetries;
  }

  function createTask(task: EngineTask): StoredTask {
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

    const stored: StoredTask = {
      ...task,
      status: 'created',
      attempts: 0,
      maxRetries: typeof task.maxRetries === 'number' ? Math.max(0, task.maxRetries) : 3,
      createdAt: typeof task.createdAt === 'number' ? task.createdAt : now()
    };

    tasks.set(stored.id, stored);
    emit('TASK_CREATED', stored.id, {
      status: stored.status,
      type: stored.type
    });
    return stored;
  }

  function enqueueTask(taskOrId: EngineTask | string): StoredTask {
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

  function claimTask(taskId?: string): StoredTask | null {
    let claimed: StoredTask | null = null;

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

  async function executeTask(taskOrId: EngineTask | string): Promise<TaskResult> {
    const task = typeof taskOrId === 'string'
      ? resolveTask(taskOrId)
      : createTask(taskOrId);

    if (task.status === 'acknowledged' || task.status === 'failed') {
      const result: TaskResult = task.lastResult || {
        success: task.status === 'acknowledged',
        error: task.status === 'failed' ? 'already_failed' : undefined
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

    const executionPromise = Promise.resolve(executor(task))
      .then((result) => {
<<<<<<< HEAD
        task.lastResult = {
          success: result && result.success === true,
          output: result && result.output ? result.output : undefined,
          error: result && result.error ? result.error : undefined,
          retryable: result && result.retryable === true
        };
        task.executionRecord = {
          completedAt: now(),
          attempt: task.attempts,
          result: task.lastResult
        };

        const shouldRetry = !task.lastResult.success && canRetry(task, task.lastResult);
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
          return task.lastResult;
        }

        task.status = 'awaiting_ack';
        emit('TASK_EXECUTE_FINISHED', task.id, {
          success: task.lastResult.success,
          retryable: task.lastResult.retryable === true,
          status: task.status
        });
        return task.lastResult;
=======
        emit('TASK_EXECUTE_FINISHED', task.id, {
          success: result.success,
          retryable: result.retryable === true
        });
        return ackTask(task.id, result).lastResult || result;
>>>>>>> 1a6ddc9 (docs: enforce TaskEngine execution model and invariants)
      })
      .catch((error: unknown) => {
        const failure: TaskResult = {
          success: false,
          error: error instanceof Error ? error.message : 'execution_failed',
          retryable: false
        };
<<<<<<< HEAD
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
=======
        emit('TASK_EXECUTE_FINISHED', task.id, {
          success: false,
          error: failure.error
        });
        return ackTask(task.id, failure).lastResult || failure;
>>>>>>> 1a6ddc9 (docs: enforce TaskEngine execution model and invariants)
      })
      .finally(() => {
        running.delete(task.id);
      });

    running.set(task.id, executionPromise);
    return executionPromise;
  }

<<<<<<< HEAD
  function ackTask(taskId: string): StoredTask {
    const task = resolveTask(taskId);

    if (task.status !== 'awaiting_ack') {
      throw new Error('ack_requires_awaiting_ack_status');
    }

    if (!task.executionRecord || !task.executionRecord.result) {
      throw new Error('ack_requires_execution_record');
    }

    task.lastResult = task.executionRecord.result;
=======
  function ackTask(taskId: string, result: TaskResult): StoredTask {
    const task = resolveTask(taskId);

    if (task.status === 'acknowledged' || task.status === 'failed') {
      emit('TASK_ACKED', task.id, {
        deduplicated: true,
        status: task.status
      });
      return task;
    }

    task.lastResult = {
      success: result && result.success === true,
      output: result && result.output ? result.output : undefined,
      error: result && result.error ? result.error : undefined,
      retryable: result && result.retryable === true
    };

    const shouldRetry = !task.lastResult.success && canRetry(task, task.lastResult);

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
      return task;
    }

>>>>>>> 1a6ddc9 (docs: enforce TaskEngine execution model and invariants)
    task.status = task.lastResult.success ? 'acknowledged' : 'failed';
    task.acknowledgedAt = now();
    emit('TASK_ACKED', task.id, {
      status: task.status,
      attempts: task.attempts,
      success: task.lastResult.success
    });

    return task;
  }

  function getTask(taskId: string): StoredTask | null {
    return tasks.get(taskId) || null;
  }

  function getQueueSnapshot(): string[] {
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
