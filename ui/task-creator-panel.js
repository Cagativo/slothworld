import { subscribeEventStream } from '../core/world/eventStore.js';
import { getTaskStatus } from './selectors/taskSelectors.js';

export function initTaskCreatorPanel() {
    function getIndexedWorldSnapshot() {
      if (window.controlAPI && typeof window.controlAPI.getWorldState === 'function') {
        return window.controlAPI.getWorldState();
      }

      return {
        events: [],
        eventsByTaskId: new Map(),
        eventsByWorkerId: new Map()
      };
    }

  const FIXED_DISCORD_CHANNEL_ID = '1491500223288184964';

  const panelRuntime = {
    pendingTaskId: null,
    waitingForCreated: false,
    observedLifecycleByTaskId: new Map()
  };

  function lifecycleFromStatus(status) {
    if (status === 'created') {
      return { code: 'created', label: 'created' };
    }
    if (status === 'queued') {
      return { code: 'queued', label: 'queued' };
    }
    if (status === 'claimed') {
      return { code: 'claimed', label: 'claimed' };
    }
    if (status === 'executing') {
      return { code: 'executing', label: 'executing' };
    }
    if (status === 'awaiting_ack') {
      return { code: 'finished', label: 'finished' };
    }
    if (status === 'failed') {
      return { code: 'failed', label: 'failed' };
    }
    if (status === 'completed' || status === 'acknowledged') {
      return { code: 'completed', label: 'completed' };
    }

    return null;
  }

  function mountPanel() {
  const panel = document.createElement('div');
  panel.id = 'task-creator-panel';
  panel.innerHTML = `
    <div class="tcp-container">
      <h3>Task Creator</h3>
      <form id="tcp-form">
        <div class="tcp-group">
          <label>Task Type:</label>
          <select id="tcp-type" name="type">
            <option value="discord">Discord</option>
            <option value="shopify">Shopify</option>
          </select>
        </div>

        <div class="tcp-group">
          <label>Title:</label>
          <input type="text" id="tcp-title" name="title" placeholder="Task title" />
        </div>

        <div class="tcp-group" id="tcp-content-group">
          <label>Content/Message:</label>
          <textarea id="tcp-content" name="content" placeholder="Task content" rows="3"></textarea>
        </div>

        <div class="tcp-group" id="tcp-channel-group">
          <label>Channel ID:</label>
          <input type="text" id="tcp-channel-id" name="channelId" placeholder="Discord channel snowflake" />
        </div>

        <button type="submit" class="tcp-submit">Create Task</button>

        <div class="tcp-group" id="tcp-product-prompt-group">
          <label>Product Prompt:</label>
          <textarea id="tcp-product-prompt" name="productPrompt" placeholder="e.g. minimalist wooden desk lamp, soft lighting, product photo" rows="3"></textarea>
        </div>

        <button type="button" id="tcp-create-product" class="tcp-create-product">Create Product</button>
      </form>
      <div id="tcp-status" class="tcp-status"></div>
    </div>
  `;

  const panelStack = document.getElementById('control-panels-stack');
  if (panelStack) {
    panelStack.appendChild(panel);
  } else {
    document.body.appendChild(panel);
  }

  const form = panel.querySelector('#tcp-form');
  const typeSelect = panel.querySelector('#tcp-type');
  const titleInput = panel.querySelector('#tcp-title');
  const contentInput = panel.querySelector('#tcp-content');
  const channelIdInput = panel.querySelector('#tcp-channel-id');
  const statusDiv = panel.querySelector('#tcp-status');
    function renderLifecycleStatus(taskId) {
      const lifecycle = panelRuntime.observedLifecycleByTaskId.get(taskId);
      if (!lifecycle) {
        return;
      }

      statusDiv.textContent = `Task ${taskId}: ${lifecycle.label}`;
      if (lifecycle.code === 'failed') {
        statusDiv.className = 'tcp-status tcp-error';
        return;
      }

      statusDiv.className = 'tcp-status tcp-success';
    }

    function observeLifecycleEvents() {
      const indexedWorld = getIndexedWorldSnapshot();
      const pendingTaskId = panelRuntime.pendingTaskId;
      if (!pendingTaskId) {
        return;
      }

      const status = getTaskStatus(indexedWorld, pendingTaskId);
      const lifecycle = lifecycleFromStatus(status);
      if (!lifecycle) {
        return;
      }

      panelRuntime.observedLifecycleByTaskId.set(pendingTaskId, lifecycle);

      if (panelRuntime.waitingForCreated && lifecycle.code === 'created') {
        panelRuntime.waitingForCreated = false;
      }

      renderLifecycleStatus(pendingTaskId);
    }

    observeLifecycleEvents();
    subscribeEventStream(() => {
      observeLifecycleEvents();
    });

  const createProductButton = panel.querySelector('#tcp-create-product');
  const productPromptInput = panel.querySelector('#tcp-product-prompt');
  const contentGroup = panel.querySelector('#tcp-content-group');
  const channelGroup = panel.querySelector('#tcp-channel-group');

  // Lock Discord channel destination for all UI-created Discord tasks.
  channelIdInput.value = FIXED_DISCORD_CHANNEL_ID;
  channelIdInput.readOnly = true;

  // Toggle content field visibility based on task type
  typeSelect.addEventListener('change', (e) => {
    if (e.target.value === 'discord') {
      contentGroup.style.display = 'block';
      channelGroup.style.display = 'block';
    } else {
      contentGroup.style.display = 'none';
      channelGroup.style.display = 'none';
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const type = typeSelect.value;
    const title = titleInput.value.trim();
    const content = contentInput.value.trim();
    const channelId = FIXED_DISCORD_CHANNEL_ID;

    if (!title) {
      statusDiv.textContent = 'Error: Title is required';
      statusDiv.className = 'tcp-status tcp-error';
      return;
    }

    if (type === 'discord' && !channelId) {
      statusDiv.textContent = 'Error: Channel ID is required for Discord tasks';
      statusDiv.className = 'tcp-status tcp-error';
      return;
    }

    try {
      statusDiv.textContent = 'sending...';
      statusDiv.className = 'tcp-status';

      const taskPayload = {
        type,
        title,
        payload: {}
      };

      if (type === 'discord') {
        taskPayload.action = 'reply_to_message';
        taskPayload.payload = {
          channelId,
          content: content || 'Task created from UI'
        };
      } else if (type === 'shopify') {
        taskPayload.action = 'process_order';
        taskPayload.payload = {
          note: content
        };
      }

      console.log('UI TASK PAYLOAD:', taskPayload);

      const result = await window.controlAPI.injectTask(taskPayload);

      if (result && result.success) {
        const taskId = result && result.data && result.data.id ? String(result.data.id) : null;
        panelRuntime.pendingTaskId = taskId;
        panelRuntime.waitingForCreated = true;

        statusDiv.textContent = taskId
          ? `waiting for engine... task ${taskId}`
          : 'waiting for engine...';
        statusDiv.className = 'tcp-status';

        form.reset();
        channelIdInput.value = FIXED_DISCORD_CHANNEL_ID;

        if (taskId) {
          renderLifecycleStatus(taskId);
        }
      } else {
        statusDiv.textContent = `Error: ${result.error || 'Task creation failed'}`;
        statusDiv.className = 'tcp-status tcp-error';
      }
    } catch (error) {
      statusDiv.textContent = `Error: ${error.message}`;
      statusDiv.className = 'tcp-status tcp-error';
    }
  });

  createProductButton.addEventListener('click', async () => {
    if (!window.createTestProduct || typeof window.createTestProduct !== 'function') {
      statusDiv.textContent = 'Error: createTestProduct is unavailable';
      statusDiv.className = 'tcp-status tcp-error';
      return;
    }

    try {
      const promptText = productPromptInput && typeof productPromptInput.value === 'string'
        ? productPromptInput.value.trim()
        : '';

      if (!promptText) {
        console.error('[CreateProduct] missing_prompt');
        statusDiv.textContent = 'Error: Product Prompt is required';
        statusDiv.className = 'tcp-status tcp-error';
        return;
      }

      const result = await window.createTestProduct({ promptText });
      if (result && result.result && result.result.success) {
        statusDiv.textContent = `✓ Product render task created: ${result.productId}`;
        statusDiv.className = 'tcp-status tcp-success';
      } else {
        statusDiv.textContent = 'Error: Failed to create product render task';
        statusDiv.className = 'tcp-status tcp-error';
      }
    } catch (error) {
      statusDiv.textContent = `Error: ${error.message}`;
      statusDiv.className = 'tcp-status tcp-error';
    }
  });

  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountPanel, { once: true });
    return;
  }

  mountPanel();
}
