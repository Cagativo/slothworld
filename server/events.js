/**
 * Event routing and dispatch handlers.
 *
 * Handles:
 *   GET /events       — list all non-internal lifecycle events
 *   GET /events?after=N  — list events with id > N
 *
 * Factory receives a context object so the module is independently testable.
 */

/**
 * @param {{
 *   eventLog: Array,
 *   taskStore: object,
 *   isValidEventType: function,
 *   isInternalTaskShape: function,
 *   writeJson: function,
 * }} ctx
 * @returns {{ handle(req: object, res: object): boolean }}
 */
export function createEventsRoutes(ctx) {
  const {
    eventLog,
    taskStore,
    isValidEventType,
    isInternalTaskShape,
    writeJson
  } = ctx;

  function handle(req, res) {
    if (req.method === 'GET' && req.url.startsWith('/events')) {
      const requestUrl = new URL(req.url, `http://${req.headers.host}`);
      const afterRaw = requestUrl.searchParams.get('after');
      const after = Number(afterRaw || 0);
      const scopedEvents = Number.isFinite(after)
        ? eventLog.filter((event) => event.id > after)
        : eventLog;

      const events = scopedEvents
        .map((event) => {
          // Strict event schema contract: only typed lifecycle events are exposed.
          if (!isValidEventType(event.type)) {
            return null;
          }

          const rawTask = taskStore[event.taskId];
          if (rawTask && isInternalTaskShape(rawTask)) {
            return null;
          }

          return {
            id: event.id,
            type: event.type,
            taskId: event.taskId,
            timestamp: event.timestamp,
            payload: event.payload || {}
          };
        })
        .filter(Boolean);

      writeJson(res, 200, { ok: true, events });
      return true;
    }

    return false;
  }

  return { handle };
}
