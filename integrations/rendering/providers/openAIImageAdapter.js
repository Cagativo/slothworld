import { generateImage } from '../../../core/image-generation.js';
import { warnLegacyExecutionPath } from '../../../core/execution-pipeline.js';

export const openAIImageAdapter = {
  id: 'openai',
  async render(task, prompt) {
    // LEGACY: adapter path is frozen for compatibility.
    // New execution should flow through canonical task pipeline.
    warnLegacyExecutionPath('integrations/rendering/providers/openAIImageAdapter.render', {
      reason: 'legacy_adapter_execution',
      disabled: true
    });

    void task;
    void prompt;
    throw new Error('legacy_execution_disabled:openAIImageAdapter.render');
  }
};