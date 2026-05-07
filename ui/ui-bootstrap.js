import { initOperatorControlPanel } from './operator-control-panel.js';
import { initRaccoonFeederPanel } from './raccoon-feeder-panel.js';
import { initTaskCreatorPanel } from './task-creator-panel.js';
import { initTrendResearchAgentReactions } from '../core/trendResearchAgentBridge.js';
import { agents } from '../core/app-state.js';

export function initUI() {
  initOperatorControlPanel();
  initRaccoonFeederPanel();
  initTaskCreatorPanel();
  initTrendResearchAgentReactions(agents);
  console.log('[bootstrap] trendResearchAgentReactions initialised');
}
