export const DEBUG_RENDER_POINTS = false;
export const TARGET_RETRY_DELAY = 30;
export const SITTING_TO_WORKING_DELAY = 45;
export const IDLE_WANDER_REASSIGN_DELAY = 150;
export const WANDER_TARGET_INTERVAL = 75;
export const TASK_EXECUTION_FAILURE_CHANCE = 0.05;
export const BRIDGE_POLL_INTERVAL_MS = 1500;
export const DEFAULT_WORKFLOW_STEP_MAX_RETRIES = 2;

// Task types
export const TASK_TYPE_DISCORD = 'discord';
export const TASK_TYPE_SHOPIFY = 'shopify';
export const TASK_TYPE_IMAGE_RENDER = 'image_render';

// Task actions
export const ACTION_REPLY_TO_MESSAGE = 'reply_to_message';
export const ACTION_PROCESS_ORDER = 'process_order';
export const ACTION_START_PRODUCT_WORKFLOW = 'start_product_workflow';
export const ACTION_SEND_CHANNEL_MESSAGE = 'send_channel_message';
export const ACTION_RENDER_PRODUCT_IMAGE = 'render_product_image';

// Task statuses
export const TASK_STATUS_FAILED = 'failed';
export const TASK_STATUS_AWAITING_ACK = 'awaiting_ack';

// Workflow statuses
export const WORKFLOW_STATUS_PENDING_APPROVAL = 'pending_approval';
export const WORKFLOW_STATUS_RUNNING = 'running';

// Agent visual states
export const AGENT_STATE_IDLE = 'idle';
export const AGENT_STATE_MOVING = 'moving';
export const AGENT_STATE_SITTING = 'sitting';
export const AGENT_STATE_WORKING = 'working';

// Progress thresholds
export const TASK_PROGRESS_ACK_THRESHOLD = 0.95;

// Task required-work ranges (ticks)
export const TASK_REQUIRED_DISCORD_MIN = 80;
export const TASK_REQUIRED_DISCORD_MAX = 200;
export const TASK_REQUIRED_SHOPIFY_MIN = 120;
export const TASK_REQUIRED_SHOPIFY_MAX = 260;

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
  agent: { width: 62, height: 54 }
};
