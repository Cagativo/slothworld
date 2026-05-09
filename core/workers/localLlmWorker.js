import { ollamaProvider } from '../../integrations/llm/providers/ollamaProvider.js';
import { assertWorkerExecutionContext } from '../engine/enforcementRuntime.js';

function fail(error) {
  const message = error instanceof Error ? error.message : String(error || 'local_llm_worker_failed');

  return {
    success: false,
    result: {
      provider: 'ollama',
      code: error && typeof error === 'object' && error.code ? error.code : 'local_llm_worker_failed',
      status: error && typeof error === 'object' && Object.prototype.hasOwnProperty.call(error, 'status')
        ? error.status
        : null,
      detail: error && typeof error === 'object' && Object.prototype.hasOwnProperty.call(error, 'detail')
        ? error.detail
        : null,
      message
    },
    error: message
  };
}

function normalizePayload(task) {
  return task && task.payload && typeof task.payload === 'object' ? task.payload : {};
}

export async function runLocalLlmWorker(task) {
  assertWorkerExecutionContext();

  const payload = normalizePayload(task);

  try {
    const result = await ollamaProvider.generateText({
      prompt: payload.prompt,
      system: payload.system,
      model: payload.model,
      temperature: payload.temperature
    });

    return {
      success: true,
      result: {
        taskId: task && task.id ? task.id : null,
        provider: result.provider,
        text: result.text,
        createdAt: result.createdAt,
        metadata: {
          ...(result.metadata && typeof result.metadata === 'object' ? result.metadata : {}),
          promptLength: typeof payload.prompt === 'string' ? payload.prompt.trim().length : 0,
          hasSystem: typeof payload.system === 'string' && payload.system.trim().length > 0
        }
      }
    };
  } catch (error) {
    return fail(error);
  }
}
