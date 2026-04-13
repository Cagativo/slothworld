export function initTaskCreatorPanel() {
  const FIXED_DISCORD_CHANNEL_ID = '1491500223288184964';

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
      </form>
      <div id="tcp-status" class="tcp-status"></div>
    </div>
  `;

  document.body.appendChild(panel);

  const form = panel.querySelector('#tcp-form');
  const typeSelect = panel.querySelector('#tcp-type');
  const titleInput = panel.querySelector('#tcp-title');
  const contentInput = panel.querySelector('#tcp-content');
  const channelIdInput = panel.querySelector('#tcp-channel-id');
  const statusDiv = panel.querySelector('#tcp-status');
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

      const result = window.controlAPI.injectTask(taskPayload);

      if (result && result.success) {
        statusDiv.textContent = `✓ Task created: ${result.data.id}`;
        statusDiv.className = 'tcp-status tcp-success';
        form.reset();
        channelIdInput.value = FIXED_DISCORD_CHANNEL_ID;
        setTimeout(() => {
          statusDiv.textContent = '';
        }, 3000);
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
