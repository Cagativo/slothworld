import { generateImage } from '../../../core/image-generation.js';

export const openAIImageAdapter = {
  id: 'openai',
  async render(task, prompt) {
    const result = await generateImage({
      provider: 'openai',
      prompt,
      context: {
        taskId: task && task.id ? task.id : null,
        workflowId: task && task.renderId ? task.renderId : undefined,
        source: task && task.type === 'discord' ? 'discord' : 'api',
        retryCount: task && typeof task.retries === 'number' ? task.retries : 0,
        metadata: {
          productId: task && task.productId ? task.productId : null,
          provider: 'openai'
        }
      }
    });

    if (!result.contentBase64) {
      throw new Error('openai_invalid_response_missing_content_base64');
    }

    return {
      provider: this.id,
      prompt: result.prompt,
      contentBase64: result.contentBase64,
      extension: 'png',
      mimeType: result.mimeType || 'image/png',
      metadata: {
        apiFamily: 'images',
        mode: 'openai_api',
        model: result && result.metadata ? result.metadata.model || 'gpt-5' : 'gpt-5',
        imageBytesApprox: Math.floor((result.contentBase64.length * 3) / 4),
        path: result.path,
        createdAt: result.createdAt
      }
    };
  }
};