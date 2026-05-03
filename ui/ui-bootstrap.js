import { bindKeyboard } from './keyboard-input.js';
import { initOperatorControlPanel } from './operator-control-panel.js';
import { initRaccoonFeederPanel } from './raccoon-feeder-panel.js';
import { initTaskCreatorPanel } from './task-creator-panel.js';
import { initTrendResearchBridge, eventBus } from '../core/engine/trendResearchBridge.js';

export function initUI() {
  bindKeyboard();
  initOperatorControlPanel();
  initRaccoonFeederPanel();
  initTaskCreatorPanel();
  initTrendResearchBridge(eventBus);
}
