import { controlAPI, dispatchCommand } from './control-api.js';
import { getRawEvents } from '../core/world/eventStore.js';
import { deriveWorldState } from '../core/world/deriveWorldState.js';

async function createTestProduct(options = {}) {
  const promptText = typeof options === 'string'
    ? options.trim()
    : (options && typeof options.promptText === 'string' ? options.promptText.trim() : '');

  if (!promptText) {
    throw new Error('missing_prompt');
  }

  const productId = `product_${Date.now()}`;
  const designIntent = {
    product_name: promptText,
    style: (options && options.style) || 'modern scandinavian',
    mood: (options && options.mood) || 'cozy ambient lighting',
    colors: Array.isArray(options && options.colors) && options.colors.length > 0
      ? options.colors
      : ['warm white', 'soft beige'],
    composition: (options && options.composition) || 'studio product shot',
    camera: (options && options.camera) || '85mm lens',
    background: (options && options.background) || 'neutral gradient',
    prompt: promptText,
    prompt_hint: promptText
  };

  const result = await controlAPI.injectTask({
    type: 'image_render',
    title: 'Generate Product Image',
    productId,
    provider: 'openai',
    designIntent,
    payload: {
      source: 'create_product_button',
      productId,
      provider: 'openai',
      designIntent
    }
  });

  return {
    productId,
    promptText,
    designIntent,
    result
  };
}

export function exposeWindowAPI() {
  window.controlAPI = controlAPI;
  window.dispatchCommand = dispatchCommand;
  window.createTestProduct = createTestProduct;

  window.getRawEvents = () => getRawEvents();
  window.getDerivedWorldState = () => deriveWorldState(getRawEvents());
}
