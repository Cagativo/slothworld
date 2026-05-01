/**
 * Task intake route handlers.
 *
 * Handles:
 *   POST /task              — normalise, guard, persist and register a new task
 *   GET  /tasks             — list all non-internal tasks
 *   POST /asset-store/render          — legacy disabled (410)
 *   POST /render/openai/generate      — legacy disabled (410)
 *   POST /render/generate             — legacy disabled (410)
 *   POST /debug/test-openai-image     — legacy disabled (410)
 *
 * Factory receives a context object so the module is independently testable.
 */

import { getCanonicalPipelineLabel, warnLegacyExecutionPath } from '../core/execution-pipeline.js';

/**
 * @param {{
 *   taskStore: object,
 *   taskEngine: object,
 *   validateTaskInput: function,
 *   ingestNormalizedTask: function,
 *   isInternalTaskShape: function,
 *   projectTaskForRead: function,
 *   autoExecuteAndAck: function,
 *   writeJson: function,
 *   readJsonBody: function,
 * }} ctx
 * @returns {{ handle(req: object, res: object): Promise<boolean> }}
 */
export function createIntakeRoutes(ctx) {
  const {
    taskStore,
    taskEngine,
    validateTaskInput,
    ingestNormalizedTask,
    isInternalTaskShape,
    projectTaskForRead,
    autoExecuteAndAck,
    writeJson,
    readJsonBody
  } = ctx;

  async function handle(req, res) {
    if (req.method === 'POST' && req.url === '/task') {
      try {
        const body = await readJsonBody(req);
        const validationError = validateTaskInput(body);
        if (validationError) {
          writeJson(res, 400, { error: validationError });
          return true;
        }

        const { task: storedTask, isNew, event, ignored, reason } = ingestNormalizedTask(body, { source: 'http' });
        if (!storedTask) {
          const statusCode = reason === 'task_circuit_breaker_open' ? 429 : 409;
          writeJson(res, statusCode, { ok: false, ignored: true, reason: reason || 'guarded_intake' });
          return true;
        }

        writeJson(res, isNew ? 201 : 200, {
          ok: true,
          eventId: event ? event.id : null,
          task: storedTask,
          deduplicated: !isNew
        });

        console.log('[POST_TASK_ACCEPTED]', {
          taskId: storedTask && storedTask.id ? storedTask.id : null,
          type: storedTask && storedTask.type ? storedTask.type : null,
          action: storedTask && storedTask.action ? storedTask.action : null,
          source: storedTask && storedTask.payload && typeof storedTask.payload.source === 'string'
            ? storedTask.payload.source
            : 'unknown',
          isNew,
          engineStatus: taskEngine.getTask(storedTask.id) ? taskEngine.getTask(storedTask.id).status : null
        });

        // Engine owns the full lifecycle — fire execute+ack asynchronously after response.
        if (isNew && storedTask && storedTask.id) {
          console.log('[POST_TASK_AUTO_EXEC_SCHEDULED]', {
            taskId: storedTask.id,
            type: storedTask.type,
            action: storedTask.action,
            source: storedTask && storedTask.payload && typeof storedTask.payload.source === 'string'
              ? storedTask.payload.source
              : 'unknown',
            engineStatus: taskEngine.getTask(storedTask.id) ? taskEngine.getTask(storedTask.id).status : null
          });
          setImmediate(() => {
            autoExecuteAndAck(storedTask.id).catch((err) => {
              console.error('[POST_TASK_AUTO_EXEC]', storedTask.id, err && err.message ? err.message : err);
            });
          });
        }
      } catch (error) {
        writeJson(res, 400, { error: error.message || 'Request failed' });
      }

      return true;
    }

    if (req.method === 'POST' && req.url === '/asset-store/render') {
      // LEGACY endpoint intentionally disabled to prevent side effects outside TaskEngine-driven workers.
      warnLegacyExecutionPath('bridge-server.POST_/asset-store/render', {
        canonical: getCanonicalPipelineLabel(),
        disabled: true
      });
      writeJson(res, 410, {
        error: 'legacy_execution_disabled',
        detail: 'Asset persistence is worker-owned and only reachable through task lifecycle execution.'
      });

      return true;
    }

    if (req.method === 'POST' && req.url === '/render/openai/generate') {
      // LEGACY endpoint intentionally disabled to prevent duplicate execution systems.
      warnLegacyExecutionPath('bridge-server.POST_/render/openai/generate', {
        canonical: getCanonicalPipelineLabel(),
        disabled: true
      });
      writeJson(res, 410, {
        error: 'legacy_execution_disabled',
        detail: 'Use /task lifecycle endpoints for task execution.'
      });

      return true;
    }

    if (req.method === 'POST' && req.url === '/render/generate') {
      // LEGACY endpoint intentionally disabled to prevent duplicate execution systems.
      warnLegacyExecutionPath('bridge-server.POST_/render/generate', {
        canonical: getCanonicalPipelineLabel(),
        disabled: true
      });
      writeJson(res, 410, {
        error: 'legacy_execution_disabled',
        detail: 'Use /task lifecycle endpoints for task execution.'
      });

      return true;
    }

    if (req.method === 'POST' && req.url === '/debug/test-openai-image') {
      // LEGACY endpoint intentionally disabled to enforce canonical task lifecycle entry points only.
      warnLegacyExecutionPath('bridge-server.POST_/debug/test-openai-image', {
        canonical: getCanonicalPipelineLabel(),
        disabled: true
      });
      writeJson(res, 410, {
        error: 'legacy_execution_disabled',
        detail: 'Use POST /task followed by task lifecycle endpoints.'
      });

      return true;
    }

    if (req.method === 'GET' && req.url === '/tasks') {
      const tasks = Object.values(taskStore)
        .filter((task) => !isInternalTaskShape(task))
        .map((task) => projectTaskForRead(task))
        .sort((a, b) => b.createdAt - a.createdAt);
      writeJson(res, 200, { ok: true, tasks });
      return true;
    }

    return false;
  }

  return { handle };
}
