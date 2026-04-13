import { debugConsoleState, pushDebugLog } from './debug-console.js';
import { dispatchCommand } from './control-api.js';

export function bindKeyboard() {
  window.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && (event.key === 'l' || event.key === 'L')) {
      debugConsoleState.logs = [];
      pushDebugLog('Console cleared.');
      event.preventDefault();
      return;
    }

    if (event.key === 'Enter') {
      const commandText = debugConsoleState.input.trim();
      if (commandText) {
        const result = dispatchCommand(commandText);
        pushDebugLog(`> ${commandText}`);
        pushDebugLog(JSON.stringify(result));
        debugConsoleState.input = '';
      }
      event.preventDefault();
      return;
    }

    if (event.key === 'Backspace') {
      debugConsoleState.input = debugConsoleState.input.slice(0, -1);
      event.preventDefault();
      return;
    }

    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      debugConsoleState.input += event.key;
      if (debugConsoleState.input.length > 200) {
        debugConsoleState.input = debugConsoleState.input.slice(-200);
      }
      event.preventDefault();
    }
  });
}
