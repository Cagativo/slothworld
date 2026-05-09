import { getGraphSnapshot } from './graph-snapshot.js';

const LOCAL_BRAIN_DEFAULT_PROMPT = 'Reply with a short friendly hello from the local Slothworld brain.';
const LOCAL_BRAIN_SYSTEM_PROMPT = 'You are a concise local assistant running inside Slothworld.';

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

    function applyType(type) {
      const isTrendResearch = type === 'trendresearch';
      const isLocalBrain = type === 'local_llm';
      const isDiscord = type === 'discord';
      contentGroup.style.display = (isDiscord || isTrendResearch || isLocalBrain) ? '' : 'none';
      channelGroup.style.display = isDiscord ? '' : 'none';
      if (selectWrap) {
        selectWrap.dataset.type = type;
      }
      if (contentLabel) {
        contentLabel.textContent = isTrendResearch ? 'Keyword' : (isLocalBrain ? 'Prompt' : 'Message');
      }
      if (contentTextarea) {
        contentTextarea.placeholder = isTrendResearch
          ? 'enter keyword e.g. fitness supplements\u2026'
          : (isLocalBrain ? LOCAL_BRAIN_DEFAULT_PROMPT : 'write message content\u2026');
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

    if (!form || !typeSelect || !titleInput || !contentInput || !channelIdInput || !statusDiv || !cancelButton || !contentGroup || !channelGroup) {
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

    channelIdInput.value = FIXED_DISCORD_CHANNEL_ID;
    channelIdInput.readOnly = true;

    bindTypeSelectUI(panel, typeSelect, contentGroup, channelGroup);

    cancelButton.addEventListener('click', () => {
      form.reset();
      typeSelect.value = 'discord';
      typeSelect.dispatchEvent(new Event('change', { bubbles: true }));
      channelIdInput.value = FIXED_DISCORD_CHANNEL_ID;
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

      if (!title && type !== 'trendresearch' && type !== 'local_llm') {
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
          form.reset();
          typeSelect.value = 'discord';
          typeSelect.dispatchEvent(new Event('change', { bubbles: true }));
          channelIdInput.value = FIXED_DISCORD_CHANNEL_ID;
          panel.classList.remove('is-dropdown-open');
          return;
        }

        statusDiv.textContent = `Error: ${trendResult && trendResult.error ? trendResult.error : 'Task creation failed'}`;
        statusDiv.className = 'tcp-status tcp-error';
        return;
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
            form.reset();
            typeSelect.value = 'discord';
            typeSelect.dispatchEvent(new Event('change', { bubbles: true }));
            channelIdInput.value = FIXED_DISCORD_CHANNEL_ID;
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

          form.reset();
          typeSelect.value = 'discord';
          typeSelect.dispatchEvent(new Event('change', { bubbles: true }));
          channelIdInput.value = FIXED_DISCORD_CHANNEL_ID;
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
