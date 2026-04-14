import { emitEvent } from '../../core/app-state.js';
import { executeRenderRoute, normalizeRenderTask } from './render-router.js';
import {
  getRenderQueueSnapshot,
  logRenderEvent,
  registerRenderTaskSnapshot,
  recordRenderCompletion,
  recordRenderFailure,
  registerReplayEnqueueHandler,
  updateRenderState,
  updateWorkerUtilization
} from './render-stability.js';

const DEFAULT_WORKER_COUNT = 2;
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 800;
const SOFT_BACKPRESSURE_THRESHOLD = 6;
const HARD_QUEUE_LIMIT = 20;
const IDLE_POLL_MS = 120;
const BACKPRESSURE_POLL_MS = 400;

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function cloneTaskSnapshot(task) {
  const cloned = JSON.parse(JSON.stringify(task || {}));
  cloned.status = cloned.status || 'pending';
  return cloned;
}

function computeRetryDelay(attempt) {
  return BASE_RETRY_DELAY_MS * (2 ** Math.max(0, attempt - 1));
}

class RenderQueue {
  constructor() {
    this.entries = [];
    this.workerCount = DEFAULT_WORKER_COUNT;
    this.running = false;
    this.workerPromises = [];
    this.sequence = 0;
    this.activeWorkerIds = new Set();
  }

  setWorkerCount(workerCount) {
    this.workerCount = Math.max(1, Number(workerCount) || DEFAULT_WORKER_COUNT);
  }

  removeEntry(entryId) {
    this.entries = this.entries.filter((entry) => entry.id !== entryId);
  }

  getSize() {
    return this.entries.filter((entry) => entry.status !== 'completed' && entry.status !== 'failed').length;
  }

  getReadyEntry() {
    const now = Date.now();
    const readyEntries = this.entries
      .filter((entry) => entry.status === 'queued' && entry.nextRunAt <= now)
      .sort((left, right) => {
        if (right.priority !== left.priority) {
          return right.priority - left.priority;
        }

        if (left.nextRunAt !== right.nextRunAt) {
          return left.nextRunAt - right.nextRunAt;
        }

        return left.sequence - right.sequence;
      });

    return readyEntries[0] || null;
  }

  async enqueue(taskInput) {
    if (this.getSize() >= HARD_QUEUE_LIMIT) {
      throw new Error('render_queue_backpressure');
    }

    const task = normalizeRenderTask(taskInput);
    const entry = {
      id: `render-queue-${task.id}`,
      sequence: this.sequence += 1,
      task: cloneTaskSnapshot(task),
      attempts: 0,
      nextRunAt: Date.now(),
      priority: typeof task.priority === 'number' ? task.priority : 1,
      status: 'queued',
      resolve: null,
      reject: null
    };

    entry.task.status = 'queued';

    const promise = new Promise((resolve, reject) => {
      entry.resolve = resolve;
      entry.reject = reject;
    });

    this.entries.push(entry);
    registerRenderTaskSnapshot(entry.task, 'queued');
    logRenderEvent(entry.task.renderId || entry.task.id, 'RENDER_ENQUEUED', {
      taskId: entry.task.id,
      provider: entry.task.provider,
      productId: entry.task.productId,
      queueSize: this.getSize()
    });
    emitEvent('RENDER_ENQUEUED', {
      taskId: entry.task.id,
      renderId: entry.task.renderId || entry.task.id,
      productId: entry.task.productId,
      provider: entry.task.provider,
      queueSize: this.getSize()
    });

    return promise;
  }

  async processEntry(entry) {
    entry.status = 'processing';
    entry.task.status = 'processing';
    entry.attempts += 1;
    updateRenderState(entry.task.renderId || entry.task.id, {
      status: 'processing',
      retryCount: entry.attempts,
      task: entry.task
    });
    logRenderEvent(entry.task.renderId || entry.task.id, 'RENDER_DEQUEUED', {
      taskId: entry.task.id,
      provider: entry.task.provider,
      productId: entry.task.productId,
      attempt: entry.attempts,
      queueSize: this.getSize()
    });

    emitEvent('RENDER_DEQUEUED', {
      taskId: entry.task.id,
      renderId: entry.task.renderId || entry.task.id,
      productId: entry.task.productId,
      provider: entry.task.provider,
      attempt: entry.attempts,
      queueSize: this.getSize()
    });

    emitEvent('RENDER_STARTED', {
      taskId: entry.task.id,
      renderId: entry.task.renderId || entry.task.id,
      productId: entry.task.productId,
      provider: entry.task.provider,
      attempt: entry.attempts
    });
    logRenderEvent(entry.task.renderId || entry.task.id, 'RENDER_STARTED', {
      taskId: entry.task.id,
      provider: entry.task.provider,
      productId: entry.task.productId,
      attempt: entry.attempts
    });

    try {
      const result = await executeRenderRoute(entry.task);
      if (!result.success) {
        throw new Error(result.error || 'render_failed');
      }

      entry.status = 'completed';
      entry.task.status = 'completed';
      updateRenderState(entry.task.renderId || entry.task.id, {
        status: 'completed',
        task: entry.task
      });

      emitEvent('RENDER_COMPLETED', {
        taskId: entry.task.id,
        renderId: entry.task.renderId || entry.task.id,
        productId: entry.task.productId,
        provider: result.provider,
        assetId: result.asset.assetId,
        url: result.asset.url,
        attempt: entry.attempts
      });

      emitEvent('RENDER_COMPLETE', {
        taskId: entry.task.id,
        renderId: entry.task.renderId || entry.task.id,
        productId: entry.task.productId,
        provider: result.provider,
        assetId: result.asset.assetId,
        url: result.asset.url,
        attempt: entry.attempts
      });

      logRenderEvent(entry.task.renderId || entry.task.id, 'RENDER_COMPLETED', {
        taskId: entry.task.id,
        provider: result.provider,
        productId: entry.task.productId,
        assetId: result.asset && result.asset.assetId ? result.asset.assetId : null,
        url: result.asset && result.asset.url ? result.asset.url : null,
        attempt: entry.attempts
      });
      recordRenderCompletion(entry.task.renderId || entry.task.id, result);

      entry.resolve(result);
      this.removeEntry(entry.id);
      return;
    } catch (error) {
      const errorMessage = error && error.message ? error.message : 'render_failed';

      if (entry.attempts < MAX_RETRIES) {
        entry.status = 'queued';
        entry.task.status = 'retrying';
        entry.nextRunAt = Date.now() + computeRetryDelay(entry.attempts);
        updateRenderState(entry.task.renderId || entry.task.id, {
          status: 'retrying',
          retryCount: entry.attempts,
          lastError: errorMessage,
          task: entry.task
        });
        logRenderEvent(entry.task.renderId || entry.task.id, 'RENDER_RETRYING', {
          taskId: entry.task.id,
          provider: entry.task.provider,
          productId: entry.task.productId,
          attempt: entry.attempts,
          nextRunAt: entry.nextRunAt,
          error: errorMessage
        });

        emitEvent('RENDER_RETRYING', {
          taskId: entry.task.id,
          renderId: entry.task.renderId || entry.task.id,
          productId: entry.task.productId,
          provider: entry.task.provider,
          attempt: entry.attempts,
          nextRunAt: entry.nextRunAt,
          error: errorMessage
        });
        return;
      }

      entry.status = 'failed';
      entry.task.status = 'failed';
      updateRenderState(entry.task.renderId || entry.task.id, {
        status: 'failed',
        retryCount: entry.attempts,
        lastError: errorMessage,
        task: entry.task
      });
      logRenderEvent(entry.task.renderId || entry.task.id, 'RENDER_FAILED', {
        taskId: entry.task.id,
        provider: entry.task.provider,
        productId: entry.task.productId,
        attempt: entry.attempts,
        error: errorMessage
      });
      recordRenderFailure(entry.task.renderId || entry.task.id, {
        error: errorMessage,
        attempt: entry.attempts
      });

      emitEvent('RENDER_FAILED', {
        taskId: entry.task.id,
        renderId: entry.task.renderId || entry.task.id,
        productId: entry.task.productId,
        provider: entry.task.provider,
        attempt: entry.attempts,
        error: errorMessage
      });

      entry.reject(new Error(errorMessage));
      this.removeEntry(entry.id);
    }
  }

  async workerLoop(workerId) {
    while (this.running) {
      const queueSize = this.getSize();
      const delayMs = queueSize > SOFT_BACKPRESSURE_THRESHOLD ? BACKPRESSURE_POLL_MS : IDLE_POLL_MS;
      const entry = this.getReadyEntry();
      updateWorkerUtilization({
        workerCount: this.workerCount,
        midjourneyWorkerCount: 0,
        activeWorkers: this.activeWorkerIds.size,
        queueSize
      });

      if (!entry) {
        await sleep(delayMs);
        continue;
      }

      this.activeWorkerIds.add(String(workerId));
      updateWorkerUtilization({
        workerCount: this.workerCount,
        midjourneyWorkerCount: 0,
        activeWorkers: this.activeWorkerIds.size,
        queueSize: this.getSize()
      });

      try {
        await this.processEntry(entry);
      } finally {
        this.activeWorkerIds.delete(String(workerId));
        updateWorkerUtilization({
          workerCount: this.workerCount,
          midjourneyWorkerCount: 0,
          activeWorkers: this.activeWorkerIds.size,
          queueSize: this.getSize()
        });
      }
    }
  }

  start(options = {}) {
    if (this.running) {
      return;
    }

    this.setWorkerCount(options.workerCount);
    this.running = true;
    this.workerPromises = [];

    for (let index = 0; index < this.workerCount; index += 1) {
      this.workerPromises.push(this.workerLoop(`generic-${index}`));
    }
  }
}

export const renderQueue = new RenderQueue();

export function startRenderWorkers(options = {}) {
  renderQueue.start(options);
}

export function enqueueRenderTask(task) {
  return renderQueue.enqueue(task);
}

registerReplayEnqueueHandler((task) => enqueueRenderTask(task));

export function getRenderQueueStats() {
  const snapshot = getRenderQueueSnapshot();
  return {
    queueSize: snapshot.queueSize,
    workerCount: renderQueue.workerCount,
    midjourneyWorkerCount: 0,
    running: renderQueue.running,
    utilization: snapshot.workerUtilization
  };
}
