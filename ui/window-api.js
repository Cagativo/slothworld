import { controlAPI, dispatchCommand } from './control-api.js';

const FIXED_DISCORD_CHANNEL_ID = '1491500223288184964';

async function createTestProduct(options = {}) {
  const promptText = typeof options === 'string'
    ? options.trim()
    : (options && typeof options.promptText === 'string' ? options.promptText.trim() : '');
  const channelId = options && typeof options.channelId === 'string' && options.channelId.trim()
    ? options.channelId.trim()
    : FIXED_DISCORD_CHANNEL_ID;

  if (!promptText) {
    throw new Error('missing_prompt');
  }

  const result = await controlAPI.injectTask({
    type: 'image_render',
    title: 'Generate Product Image',
    intent: 'render_product_image',
    payload: {
      source: 'create_product_button',
      prompt: promptText,
      channelId
    }
  });

  return {
    promptText,
    productId: result && result.data && result.data.productId ? result.data.productId : null,
    result
  };
}

export function exposeWindowAPI() {
  window.controlAPI = controlAPI;
  window.dispatchCommand = dispatchCommand;
  window.createTestProduct = createTestProduct;

  window.getIndexedWorldState = () => controlAPI.getWorldState();
  window.getTaskView = () => controlAPI.getTasks();
  window.getAgentView = () => controlAPI.getAgents();
  window.getDeskView = () => controlAPI.getDeskState();
  window.getEventView = (limit) => controlAPI.getEventView(limit);
}
