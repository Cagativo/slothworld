/**
 * Metrics aggregation endpoint handlers.
 *
 * Handles:
 *   GET /health   — server liveness + basic event/task counts
 *
 * Factory receives a context object so the module is independently testable.
 */

/**
 * @param {{
 *   eventLog: Array,
 *   taskStore: object,
 *   writeJson: function,
 * }} ctx
 * @returns {{ handle(req: object, res: object): boolean }}
 */
export function createMetricsRoutes(ctx) {
  const { eventLog, taskStore, writeJson } = ctx;

  function handle(req, res) {
    if (req.method === 'GET' && req.url === '/health') {
      writeJson(res, 200, { ok: true, events: eventLog.length, tasks: Object.keys(taskStore).length });
      return true;
    }

    return false;
  }

  return { handle };
}
