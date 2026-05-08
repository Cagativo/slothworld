import { initOperatorControlPanel } from './operator-control-panel.js';
import { initRaccoonFeederPanel } from './raccoon-feeder-panel.js';
import { initTaskCreatorPanel } from './task-creator-panel.js';

const LEFT_UI_MODE_EVENT = 'slothworld:ui-mode';

function applyLeftUiMode(mode, modeToggle) {
  const safeMode = mode === 'debug' ? 'debug' : 'normal';
  document.body.dataset.leftUiMode = safeMode;

  if (modeToggle) {
    const buttons = modeToggle.querySelectorAll('[data-ui-mode]');
    buttons.forEach((button) => {
      if (!(button instanceof HTMLButtonElement)) {
        return;
      }
      const isActive = button.dataset.uiMode === safeMode;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  window.dispatchEvent(new CustomEvent(LEFT_UI_MODE_EVENT, {
    detail: { mode: safeMode }
  }));
}

function initLeftUiModeToggle() {
  const sidebar = document.getElementById('left-sidebar');
  const panelHeader = document.getElementById('control-panels-header');
  if (!sidebar || !panelHeader) {
    document.body.dataset.leftUiMode = 'normal';
    return;
  }

  const modeToggle = document.createElement('div');
  modeToggle.id = 'left-ui-mode-toggle';
  modeToggle.innerHTML = `
    <span class="left-ui-mode-label">Mode</span>
    <div class="left-ui-mode-buttons" role="group" aria-label="Left UI mode toggle">
      <button type="button" class="left-ui-mode-button" data-ui-mode="normal" aria-pressed="true">Normal</button>
      <button type="button" class="left-ui-mode-button" data-ui-mode="debug" aria-pressed="false">Debug</button>
    </div>
  `;

  panelHeader.insertAdjacentElement('afterend', modeToggle);

  modeToggle.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const button = target.closest('[data-ui-mode]');
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    applyLeftUiMode(button.dataset.uiMode, modeToggle);
  });

  applyLeftUiMode('normal', modeToggle);
}

export function initUI() {
  initLeftUiModeToggle();
  initOperatorControlPanel();
  initRaccoonFeederPanel();
  initTaskCreatorPanel();
}
