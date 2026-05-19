import { getGraphSnapshot } from './graph-snapshot.js';

const LOCAL_BRAIN_DEFAULT_PROMPT = 'Reply with a short friendly hello from the local Slothworld brain.';
const LOCAL_BRAIN_SYSTEM_PROMPT = 'You are a concise local assistant running inside Slothworld.';
const IMAGE_RENDER_DEFAULTS = Object.freeze({
  provider: 'comfyui',
  width: 512,
  height: 512,
  steps: 20,
  cfg: 8,
  sampler: 'euler',
  scheduler: 'normal',
  negativePrompt: 'text, watermark, blurry, low quality, distorted'
});

function finiteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function finiteInteger(value, fallback) {
  return Math.max(1, Math.floor(finiteNumber(value, fallback)));
}

export function buildLocalBrainTaskPayload({ title = '', prompt = '' } = {}) {
  const normalizedTitle = typeof title === 'string' ? title.trim() : '';
  const normalizedPrompt = typeof prompt === 'string' && prompt.trim()
    ? prompt.trim()
    : LOCAL_BRAIN_DEFAULT_PROMPT;

  return {
    type: 'local_llm',
    title: normalizedTitle || 'Local Brain Test',
    payload: {
      source: 'task_creator_panel',
      prompt: normalizedPrompt,
      system: LOCAL_BRAIN_SYSTEM_PROMPT,
      model: ''
    }
  };
}

export function buildImageRenderTaskPayload({
  title = '',
  prompt = '',
  negativePrompt = IMAGE_RENDER_DEFAULTS.negativePrompt,
  width = IMAGE_RENDER_DEFAULTS.width,
  height = IMAGE_RENDER_DEFAULTS.height,
  steps = IMAGE_RENDER_DEFAULTS.steps,
  cfg = IMAGE_RENDER_DEFAULTS.cfg,
  sampler = IMAGE_RENDER_DEFAULTS.sampler,
  scheduler = IMAGE_RENDER_DEFAULTS.scheduler
} = {}) {
  const normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
  const normalizedTitle = typeof title === 'string' && title.trim()
    ? title.trim()
    : 'Generate Image Render';
  const options = {
    width: finiteInteger(width, IMAGE_RENDER_DEFAULTS.width),
    height: finiteInteger(height, IMAGE_RENDER_DEFAULTS.height),
    steps: finiteInteger(steps, IMAGE_RENDER_DEFAULTS.steps),
    cfg: finiteNumber(cfg, IMAGE_RENDER_DEFAULTS.cfg),
    sampler: typeof sampler === 'string' && sampler.trim() ? sampler.trim() : IMAGE_RENDER_DEFAULTS.sampler,
    scheduler: typeof scheduler === 'string' && scheduler.trim() ? scheduler.trim() : IMAGE_RENDER_DEFAULTS.scheduler,
    negativePrompt: typeof negativePrompt === 'string' && negativePrompt.trim()
      ? negativePrompt.trim()
      : IMAGE_RENDER_DEFAULTS.negativePrompt
  };

  return {
    type: 'image_render',
    action: 'render_product_image',
    title: normalizedTitle,
    payload: {
      source: 'task_creator_panel',
      provider: IMAGE_RENDER_DEFAULTS.provider,
      prompt: normalizedPrompt,
      designIntent: {
        prompt: normalizedPrompt
      },
      context: {
        metadata: options
      }
    }
  };
}

export function initTaskCreatorPanel() {
  const FIXED_DISCORD_CHANNEL_ID = '1491500223288184964';

  const panelRuntime = {
    pendingTaskId: null
  };

  function buildPanelMarkup() {
    return `
    <div class="tcp-frame">
      <div class="tcp-plaque">
        <h2 class="tcp-plaque-text">Create Task</h2>
      </div>
      <div class="tcp-body">
        <form id="tcp-form" class="tcp-form" autocomplete="off">
          <div class="tcp-field tcp-field-type">
            <label for="tcp-type" class="tcp-label">Task Type</label>
            <div class="tcp-select-wrap" data-type="discord">
              <select id="tcp-type" name="type">
                <option value="discord">Discord</option>
                <option value="shopify">Shopify</option>
                <option value="trendresearch">TrendResearch</option>
                <option value="image_render">Image Render</option>
                <option value="local_llm">Local Brain Test</option>
              </select>
              <span class="tcp-chevron" aria-hidden="true">&#9662;</span>
            </div>
          </div>

          <div class="tcp-field tcp-field-title">
            <label for="tcp-title" class="tcp-label">Task Title</label>
            <input type="text" id="tcp-title" name="title" placeholder="name this task&hellip;" />
          </div>

          <div class="tcp-field tcp-field-content" id="tcp-content-group">
            <label for="tcp-content" class="tcp-label">Message</label>
            <textarea id="tcp-content" name="content" placeholder="write message content&hellip;" rows="4"></textarea>
          </div>

          <div class="tcp-field tcp-field-channel" id="tcp-channel-group">
            <label for="tcp-channel-id" class="tcp-label">Channel ID</label>
            <input type="text" id="tcp-channel-id" name="channelId" />
          </div>

          <div class="tcp-image-options" id="tcp-image-options" hidden>
            <div class="tcp-field">
              <label for="tcp-negative-prompt" class="tcp-label">Negative Prompt</label>
              <textarea id="tcp-negative-prompt" name="negativePrompt" rows="2"></textarea>
            </div>
            <div class="tcp-compact-grid">
              <div class="tcp-field">
                <label for="tcp-image-width" class="tcp-label">Width</label>
                <input type="number" id="tcp-image-width" name="width" min="64" step="64" />
              </div>
              <div class="tcp-field">
                <label for="tcp-image-height" class="tcp-label">Height</label>
                <input type="number" id="tcp-image-height" name="height" min="64" step="64" />
              </div>
              <div class="tcp-field">
                <label for="tcp-image-steps" class="tcp-label">Steps</label>
                <input type="number" id="tcp-image-steps" name="steps" min="1" step="1" />
              </div>
              <div class="tcp-field">
                <label for="tcp-image-cfg" class="tcp-label">CFG</label>
                <input type="number" id="tcp-image-cfg" name="cfg" min="1" step="0.5" />
              </div>
            </div>
          </div>

          <div class="tcp-actions">
            <button type="submit" class="tcp-submit">Create</button>
            <button type="button" id="tcp-cancel" class="tcp-cancel">Cancel</button>
          </div>
        </form>
        <div id="tcp-status" class="tcp-status" aria-live="polite"></div>
      </div>
    </div>
  `;
  }

  function bindTypeSelectUI(panel, typeSelect, contentGroup, channelGroup) {
    const selectWrap = typeSelect.closest('.tcp-select-wrap');
    const contentLabel = contentGroup.querySelector('label');
    const contentTextarea = contentGroup.querySelector('textarea');
    const imageOptions = panel.querySelector('#tcp-image-options');

    function applyType(type) {
      const isTrendResearch = type === 'trendresearch';
      const isLocalBrain = type === 'local_llm';
      const isImageRender = type === 'image_render';
      const isDiscord = type === 'discord';
      contentGroup.style.display = (isDiscord || isTrendResearch || isLocalBrain || isImageRender) ? '' : 'none';
      channelGroup.style.display = isDiscord ? '' : 'none';
      if (imageOptions) {
        imageOptions.hidden = !isImageRender;
      }
      if (selectWrap) {
        selectWrap.dataset.type = type;
      }
      if (contentLabel) {
        contentLabel.textContent = isTrendResearch ? 'Keyword' : ((isLocalBrain || isImageRender) ? 'Prompt' : 'Message');
      }
      if (contentTextarea) {
        contentTextarea.placeholder = isTrendResearch
          ? 'enter keyword e.g. fitness supplements\u2026'
          : (isLocalBrain
              ? LOCAL_BRAIN_DEFAULT_PROMPT
              : (isImageRender ? 'describe the product image to generate\u2026' : 'write message content\u2026'));
      }
    }

    typeSelect.addEventListener('change', (e) => {
      applyType(e.target.value);
    });

    applyType(typeSelect.value);
  }

  function mountPanel() {
    const panel = document.createElement('div');
    panel.id = 'task-creator-panel';
    panel.innerHTML = buildPanelMarkup();

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
    const cancelButton = panel.querySelector('#tcp-cancel');
    const contentGroup = panel.querySelector('#tcp-content-group');
    const channelGroup = panel.querySelector('#tcp-channel-group');
    const imageOptions = panel.querySelector('#tcp-image-options');
    const negativePromptInput = panel.querySelector('#tcp-negative-prompt');
    const widthInput = panel.querySelector('#tcp-image-width');
    const heightInput = panel.querySelector('#tcp-image-height');
    const stepsInput = panel.querySelector('#tcp-image-steps');
    const cfgInput = panel.querySelector('#tcp-image-cfg');

    if (!form || !typeSelect || !titleInput || !contentInput || !channelIdInput || !statusDiv || !cancelButton || !contentGroup || !channelGroup || !imageOptions || !negativePromptInput || !widthInput || !heightInput || !stepsInput || !cfgInput) {
      return;
    }

    function updatePendingTaskStatus() {
      const pendingTaskId = panelRuntime.pendingTaskId;
      if (!pendingTaskId) {
        return;
      }
      const graph = getGraphSnapshot();
      const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
      const node = nodes.find((n) => n && n.id === pendingTaskId);
      if (!node) {
        return;
      }
      statusDiv.textContent = `Task ${pendingTaskId}: ${node.status}`;
      if (node.status === 'failed') {
        statusDiv.className = 'tcp-status tcp-error';
      } else if (node.status === 'completed' || node.status === 'acknowledged') {
        statusDiv.className = 'tcp-status tcp-success';
      } else {
        statusDiv.className = 'tcp-status';
      }
    }

    updatePendingTaskStatus();
    window.addEventListener('slothworld:graph', () => {
      updatePendingTaskStatus();
    });

    function applyImageDefaults() {
      negativePromptInput.value = IMAGE_RENDER_DEFAULTS.negativePrompt;
      widthInput.value = String(IMAGE_RENDER_DEFAULTS.width);
      heightInput.value = String(IMAGE_RENDER_DEFAULTS.height);
      stepsInput.value = String(IMAGE_RENDER_DEFAULTS.steps);
      cfgInput.value = String(IMAGE_RENDER_DEFAULTS.cfg);
    }

    function resetFormToDiscord() {
      form.reset();
      typeSelect.value = 'discord';
      typeSelect.dispatchEvent(new Event('change', { bubbles: true }));
      channelIdInput.value = FIXED_DISCORD_CHANNEL_ID;
      applyImageDefaults();
    }

    channelIdInput.value = FIXED_DISCORD_CHANNEL_ID;
    channelIdInput.readOnly = true;
    applyImageDefaults();

    bindTypeSelectUI(panel, typeSelect, contentGroup, channelGroup);

    cancelButton.addEventListener('click', () => {
      resetFormToDiscord();
      statusDiv.textContent = '';
      statusDiv.className = 'tcp-status';
      panel.classList.remove('is-dropdown-open');
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const type = typeSelect.value;
      const title = titleInput.value.trim();
      const content = contentInput.value.trim();
      const channelId = FIXED_DISCORD_CHANNEL_ID;

      if (!title && type !== 'trendresearch' && type !== 'local_llm' && type !== 'image_render') {
        statusDiv.textContent = 'Error: Title is required';
        statusDiv.className = 'tcp-status tcp-error';
        return;
      }

      if (type === 'discord' && !channelId) {
        statusDiv.textContent = 'Error: Channel ID is required for Discord tasks';
        statusDiv.className = 'tcp-status tcp-error';
        return;
      }

      if (type === 'trendresearch') {
        const keyword = content;
        if (!keyword) {
          statusDiv.textContent = 'Error: Keyword is required';
          statusDiv.className = 'tcp-status tcp-error';
          return;
        }
        const requestId = crypto.randomUUID();
        statusDiv.textContent = 'sending...';
        statusDiv.className = 'tcp-status';

        const trendTaskPayload = {
          id: requestId,
          type: 'TREND_RESEARCH',
          title: title || `Trend research: ${keyword}`,
          payload: {
            source: 'task_creator_panel',
            requestId,
            keyword,
            channelId
          }
        };

        const trendResult = await window.controlAPI.injectTask(trendTaskPayload);
        if (trendResult && trendResult.success) {
          panelRuntime.pendingTaskId = requestId;

          statusDiv.textContent = `waiting for engine... task ${requestId}`;
          statusDiv.className = 'tcp-status';
          resetFormToDiscord();
          panel.classList.remove('is-dropdown-open');
          return;
        }

        statusDiv.textContent = `Error: ${trendResult && trendResult.error ? trendResult.error : 'Task creation failed'}`;
        statusDiv.className = 'tcp-status tcp-error';
        return;
      }

      if (type === 'image_render') {
        const prompt = content;
        if (!prompt) {
          statusDiv.textContent = 'Error: Prompt is required';
          statusDiv.className = 'tcp-status tcp-error';
          return;
        }

        try {
          statusDiv.textContent = 'sending...';
          statusDiv.className = 'tcp-status';

          const imageRenderResult = await window.controlAPI.injectTask(buildImageRenderTaskPayload({
            title,
            prompt,
            negativePrompt: negativePromptInput.value,
            width: widthInput.value,
            height: heightInput.value,
            steps: stepsInput.value,
            cfg: cfgInput.value
          }));

          if (imageRenderResult && imageRenderResult.success) {
            const taskId = imageRenderResult && imageRenderResult.data && imageRenderResult.data.id
              ? String(imageRenderResult.data.id)
              : null;
            panelRuntime.pendingTaskId = taskId;

            statusDiv.textContent = taskId
              ? `waiting for engine... task ${taskId}`
              : 'waiting for engine...';
            statusDiv.className = 'tcp-status';
            resetFormToDiscord();
            panel.classList.remove('is-dropdown-open');
            return;
          }

          statusDiv.textContent = `Error: ${imageRenderResult && imageRenderResult.error ? imageRenderResult.error : 'Task creation failed'}`;
          statusDiv.className = 'tcp-status tcp-error';
          return;
        } catch (error) {
          statusDiv.textContent = `Error: ${error.message}`;
          statusDiv.className = 'tcp-status tcp-error';
          return;
        }
      }

      if (type === 'local_llm') {
        try {
          statusDiv.textContent = 'sending...';
          statusDiv.className = 'tcp-status';

          const localBrainResult = await window.controlAPI.injectTask(
            buildLocalBrainTaskPayload({ title, prompt: content })
          );

          if (localBrainResult && localBrainResult.success) {
            const taskId = localBrainResult && localBrainResult.data && localBrainResult.data.id
              ? String(localBrainResult.data.id)
              : null;
            panelRuntime.pendingTaskId = taskId;

            statusDiv.textContent = taskId
              ? `waiting for engine... task ${taskId}`
              : 'waiting for engine...';
            statusDiv.className = 'tcp-status';
            resetFormToDiscord();
            panel.classList.remove('is-dropdown-open');
            return;
          }

          statusDiv.textContent = `Error: ${localBrainResult && localBrainResult.error ? localBrainResult.error : 'Task creation failed'}`;
          statusDiv.className = 'tcp-status tcp-error';
          return;
        } catch (error) {
          statusDiv.textContent = `Error: ${error.message}`;
          statusDiv.className = 'tcp-status tcp-error';
          return;
        }
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
          taskPayload.intent = 'discord_message';
          taskPayload.payload = {
            source: 'task_creator_panel',
            channelId,
            content
          };
        } else if (type === 'shopify') {
          taskPayload.intent = 'shopify_process_order';
          taskPayload.payload = {
            source: 'task_creator_panel',
            note: content
          };
        }

        console.log('UI TASK PAYLOAD:', taskPayload);

        const result = await window.controlAPI.injectTask(taskPayload);

        if (result && result.success) {
          const taskId = result && result.data && result.data.id ? String(result.data.id) : null;
          panelRuntime.pendingTaskId = taskId;

          statusDiv.textContent = taskId
            ? `waiting for engine... task ${taskId}`
            : 'waiting for engine...';
          statusDiv.className = 'tcp-status';

          resetFormToDiscord();
          panel.classList.remove('is-dropdown-open');
        } else {
          statusDiv.textContent = `Error: ${result.error || 'Task creation failed'}`;
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
