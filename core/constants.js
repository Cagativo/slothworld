export const DEBUG_RENDER_POINTS = false;
export const TARGET_RETRY_DELAY = 30;
export const SITTING_TO_WORKING_DELAY = 45;
export const IDLE_WANDER_REASSIGN_DELAY = 150;
export const WANDER_TARGET_INTERVAL = 75;
export const TASK_EXECUTION_FAILURE_CHANCE = 0.05;
export const BRIDGE_POLL_INTERVAL_MS = 1500;
export const DEFAULT_WORKFLOW_STEP_MAX_RETRIES = 2;

export const ACTION_TOOL_MAP = {
  reply_to_message: 'discord.reply',
  fetch_order: 'shopify.process_order',
  refund_order: 'shopify.process_order',
  process_order: 'shopify.process_order',
  research_product: 'research.query',
  generate_design_prompt: 'shopify.generate_design_prompt',
  render_product_image: 'render.route',
  create_product_listing: 'shopify.create_product_listing'
};

export const SITTING_OFFSET = {
  x: 0,
  y: 0
};

export const spriteConfigs = {
  desk: { width: 96, height: 64 },
  computer: { width: 28, height: 24 },
  agent: { width: 48, height: 48 }
};
