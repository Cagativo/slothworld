import { uiFxState } from '../rendering/overlays.js';

export const debugConsoleState = {
  input: '',
  logs: ['Control console ready. Type commands and press Enter.'],
  maxLogs: 8
};

export function pushDebugLog(message) {
  debugConsoleState.logs.push(String(message));
  if (debugConsoleState.logs.length > debugConsoleState.maxLogs) {
    debugConsoleState.logs.shift();
  }
}

export function drawDebugConsole(ctx) {
  const panelWidth = 420;
  const panelHeight = 120;
  const x = 12;

  // canvas is accessed via the ctx's canvas property to avoid a circular import with app-state
  const canvasHeight = ctx.canvas.height;
  const y = canvasHeight - panelHeight - 12;

  ctx.fillStyle = 'rgba(8, 12, 20, 0.86)';
  ctx.fillRect(x, y, panelWidth, panelHeight);
  ctx.strokeStyle = 'rgba(122, 180, 255, 0.45)';
  ctx.strokeRect(x, y, panelWidth, panelHeight);

  ctx.fillStyle = '#d8ecff';
  ctx.font = '11px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('DEBUG CONSOLE', x + 8, y + 14);

  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(x + 8, y + 22, panelWidth - 16, 16);
  ctx.strokeStyle = 'rgba(123, 223, 255, 0.35)';
  ctx.strokeRect(x + 8, y + 22, panelWidth - 16, 16);
  ctx.fillStyle = '#98e6ff';
  const visibleInput = debugConsoleState.input.slice(-58);
  ctx.fillText(`> ${visibleInput}${uiFxState.frame % 30 < 15 ? '_' : ''}`, x + 12, y + 34);

  ctx.fillStyle = '#bdd0e8';
  ctx.font = '10px monospace';
  const logs = debugConsoleState.logs.slice(-6);
  for (let i = 0; i < logs.length; i += 1) {
    const line = logs[i].slice(0, 62);
    ctx.fillText(line, x + 10, y + 52 + i * 11);
  }
}
