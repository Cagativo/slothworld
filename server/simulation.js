/**
 * Simulation start/stop/status control handlers.
 *
 * Handles:
 *   POST /task/:id/start    — mark task as started, ensure it is in the engine
 *   POST /task/:id/execute  — execute a task through the engine
 *   POST /task/:id/ack      — acknowledge a completed execution
 *
 * Factory receives a context object so the module is independently testable.
 */

/**
 * @param {{
 *   taskStore: object,
 *   taskEngine: object,
 *   ensureTaskInEngine: function,
 *   mapTaskResultToExecution: function,
 *   mapEngineStatusToPublic: function,
 *   projectTaskForRead: function,
 *   logTaskStatus: function,
 *   saveStore: function,
 *   TASK_STATUS_AWAITING_ACK: string,
 *   TASK_STATUS_DONE: string,
 *   TASK_STATUS_FAILED: string,
 *   TASK_STATUS_PROCESSING: string,
 *   writeJson: function,
 *   readJsonBody: function,
 * }} ctx
 * @returns {{ handle(req: object, res: object): Promise<boolean> }}
 */
export function createSimulationRoutes(ctx) {
  const {
    taskStore,
    taskEngine,
    ensureTaskInEngine,
    mapTaskResultToExecution,
    mapEngineStatusToPublic,
    projectTaskForRead,
    logTaskStatus,
    saveStore,
    TASK_STATUS_AWAITING_ACK,
    TASK_STATUS_DONE,
    TASK_STATUS_FAILED,
    TASK_STATUS_PROCESSING,
    writeJson,
    readJsonBody
  } = ctx;

  async function handle(req, res) {
    if (req.method === 'POST' && /^\/task\/[^/]+\/start$/.test(req.url)) {
      try {
        const requestUrl = new URL(req.url, `http://${req.headers.host}`);
        const parts = requestUrl.pathname.split('/');
        const taskId = decodeURIComponent(parts[2]);

        const existing = taskStore[taskId];
        if (!existing) {
          writeJson(res, 404, { error: 'Task not found' });
          return true;
        }

        const engineTask = ensureTaskInEngine(existing);
        if (!engineTask) {
          writeJson(res, 404, { error: 'Task not found' });
          return true;
        }

        if (engineTask.status === 'executing' || engineTask.status === 'acknowledged' || engineTask.status === TASK_STATUS_FAILED) {
          writeJson(res, 200, { ok: true, ignored: true, task: projectTaskForRead(existing) });
          return true;
        }

        existing.startedAt = existing.startedAt || Date.now();

        saveStore();
        logTaskStatus(taskId, TASK_STATUS_PROCESSING);
        writeJson(res, 200, { ok: true, task: projectTaskForRead(existing) });
      } catch (error) {
        writeJson(res, 400, { error: error.message || 'Request failed' });
      }

      return true;
    }

    if (req.method === 'POST' && /^\/task\/[^/]+\/ack$/.test(req.url)) {
      try {
        const requestUrl = new URL(req.url, `http://${req.headers.host}`);
        const parts = requestUrl.pathname.split('/');
        const taskId = decodeURIComponent(parts[2]);
        const body = await readJsonBody(req);

        if (body && typeof body === 'object') {
          if (
            Object.prototype.hasOwnProperty.call(body, 'executionResult')
            || Object.prototype.hasOwnProperty.call(body, 'status')
            || Object.prototype.hasOwnProperty.call(body, 'payload')
            || Object.prototype.hasOwnProperty.call(body, 'retries')
          ) {
            throw new Error('ENGINE_ENFORCEMENT_VIOLATION');
          }
        }

        const existing = taskStore[taskId];
        if (!existing) {
          writeJson(res, 404, { error: 'Task not found' });
          return true;
        }

        const engineTaskBeforeAck = taskEngine.getTask(taskId);
        if (!engineTaskBeforeAck || engineTaskBeforeAck.status !== TASK_STATUS_AWAITING_ACK || !engineTaskBeforeAck.executionRecord) {
          console.error('[ACK_WITHOUT_EXECUTION]', {
            taskId,
            phase: 'pre_ack_validation',
            hasEngineTask: !!engineTaskBeforeAck,
            engineStatus: engineTaskBeforeAck ? engineTaskBeforeAck.status : null,
            hasExecutionRecord: !!(engineTaskBeforeAck && engineTaskBeforeAck.executionRecord)
          });
          throw new Error('ENGINE_ENFORCEMENT_VIOLATION');
        }

        try {
          await taskEngine.ackTask(taskId);
        } catch (error) {
          throw new Error('ENGINE_ENFORCEMENT_VIOLATION');
        }

        const engineTask = taskEngine.getTask(taskId);
        if (!engineTask || !engineTask.executionRecord || (engineTask.status !== 'acknowledged' && engineTask.status !== TASK_STATUS_FAILED)) {
          console.error('[ACK_WITHOUT_EXECUTION]', {
            taskId,
            phase: 'post_ack_validation',
            hasEngineTask: !!engineTask,
            engineStatus: engineTask ? engineTask.status : null,
            hasExecutionRecord: !!(engineTask && engineTask.executionRecord)
          });
          throw new Error('ENGINE_ENFORCEMENT_VIOLATION');
        }

        const resolvedStatus = mapEngineStatusToPublic(engineTask.status);
        const engineExecutionResult = mapTaskResultToExecution(engineTask.executionRecord.result);

        const now = Date.now();
        const completedAt = resolvedStatus === TASK_STATUS_DONE ? now : existing.completedAt;
        const failedAt = resolvedStatus === TASK_STATUS_FAILED ? now : existing.failedAt;
        const finishedAt = resolvedStatus === TASK_STATUS_DONE ? completedAt : failedAt;
        const durationMs = existing.startedAt && finishedAt ? Math.max(0, finishedAt - existing.startedAt) : existing.durationMs;
        const task = existing;
        task.executionResult = engineExecutionResult;
        task.startedAt = task.startedAt || now;
        task.completedAt = completedAt;
        task.failedAt = failedAt;
        task.durationMs = durationMs;
        task.lastError = task.executionResult && task.executionResult.error ? task.executionResult.error : task.lastError;

        console.log('[ACK DEBUG]', task.id, task.payload);

        saveStore();
        logTaskStatus(taskId, resolvedStatus, {
          durationMs: task.durationMs,
          error: task.lastError || null,
          hasPayload: !!task.payload,
          channelId: task.payload && task.payload.channelId ? task.payload.channelId : null
        });
        writeJson(res, 200, { ok: true, task: projectTaskForRead(task) });
      } catch (error) {
        if (error && error.message === 'ENGINE_ENFORCEMENT_VIOLATION') {
          writeJson(res, 409, { error: 'ENGINE_ENFORCEMENT_VIOLATION' });
          return true;
        }

        writeJson(res, 400, { error: error.message || 'Request failed' });
      }

      return true;
    }

    if (req.method === 'POST' && /^\/task\/[^/]+\/execute$/.test(req.url)) {
      try {
        const requestUrl = new URL(req.url, `http://${req.headers.host}`);
        const parts = requestUrl.pathname.split('/');
        const taskId = decodeURIComponent(parts[2]);
        console.log('[TASK_EXECUTE_ENDPOINT_HIT]', { taskId });

        const existing = taskStore[taskId];
        if (!existing) {
          writeJson(res, 404, { error: 'Task not found' });
          return true;
        }

        const executionStartedAt = Date.now();
        ensureTaskInEngine(existing);
        const taskResult = await taskEngine.executeTask(existing.id);
        const execution = mapTaskResultToExecution(taskResult);
        const executionCompletedAt = Date.now();
        existing.executionResult = execution;
        existing.executionStartedAt = executionStartedAt;
        existing.executionCompletedAt = executionCompletedAt;
        existing.executionDurationMs = executionCompletedAt - executionStartedAt;
        existing.lastError = execution && execution.error ? execution.error : existing.lastError;

        saveStore();
        logTaskStatus(taskId, execution && execution.success ? 'executed' : 'execute_failed', {
          durationMs: existing.executionDurationMs,
          error: existing.lastError || null
        });
        writeJson(res, 200, {
          ok: true,
          result: execution,
          durationMs: existing.executionDurationMs,
          task: projectTaskForRead(existing)
        });
      } catch (error) {
        if (error && error.message === 'ENGINE_ENFORCEMENT_VIOLATION') {
          console.error('[EXECUTE_ENFORCEMENT_VIOLATION]', { taskId: req.url });
          writeJson(res, 409, { error: 'ENGINE_ENFORCEMENT_VIOLATION' });
          return true;
        }

        writeJson(res, 400, { error: error.message || 'Request failed' });
      }

      return true;
    }

    return false;
  }

  return { handle };
}
