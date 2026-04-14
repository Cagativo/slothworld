import { generateImage } from '../../../core/image-generation.js';

export const openAIImageAdapter = {
  id: 'openai',
  async render(task, prompt) {
    const result = await generateImage('openai', prompt);

    return {
      provider: this.id,
      prompt,
      contentBase64: result.imageBase64 || null,
      extension: 'png',
      mimeType: result.mimeType || 'image/png',
      metadata: {
        apiFamily: 'images',
        mode: 'openai_api',
        model: result.model || 'gpt-image-1',
        imageBytesApprox: result.imageBase64
          ? Math.floor((result.imageBase64.length * 3) / 4)
          : 0
      }
    };
  }
};