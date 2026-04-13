import { canvas, ctx, agents, desks, getDeskSlotPosition } from '../core/app-state.js';
import { spriteConfigs, SITTING_OFFSET, DEBUG_RENDER_POINTS } from '../core/constants.js';
import { loadedAssets } from './assets.js';
import {
  uiFxState,
  refreshTaskFxState,
  drawDeskProcessingGlow,
  drawDeskQueueStack,
  drawDeskTaskOverlay,
  drawTaskFx,
  drawAgentIdentityLayer,
  drawGlobalHud,
  drawPendingWorkflowsOverlay,
  drawWorkflowOverlay
} from './overlays.js';

// --- Low-level sprite helpers ---
function drawSprite(ctx, image, x, y, config) {
  if (!image) {
    return;
  }

  const drawX = x - config.width / 2;
  const drawY = y - config.height / 2;

  if (
    config.sourceWidth !== undefined &&
    config.sourceHeight !== undefined &&
    config.sourceX !== undefined &&
    config.sourceY !== undefined
  ) {
    ctx.drawImage(
      image,
      config.sourceX,
      config.sourceY,
      config.sourceWidth,
      config.sourceHeight,
      drawX,
      drawY,
      config.width,
      config.height
    );
    return;
  }

  ctx.drawImage(image, drawX, drawY, config.width, config.height);
}

function drawLogicalPoint(ctx, x, y) {
  if (!DEBUG_RENDER_POINTS) {
    return;
  }

  ctx.fillStyle = '#ff2b2b';
  ctx.beginPath();
  ctx.arc(x, y, 2, 0, Math.PI * 2);
  ctx.fill();
}

// --- Main render function ---
export function render() {
  uiFxState.frame += 1;
  refreshTaskFxState();

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  const bgGradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  bgGradient.addColorStop(0, '#111a2b');
  bgGradient.addColorStop(1, '#111827');
  ctx.fillStyle = bgGradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = 'rgba(130, 180, 255, 0.04)';
  for (let y = 0; y < canvas.height; y += 24) {
    ctx.fillRect(0, y, canvas.width, 1);
  }

  const deskImage = loadedAssets['desk.png'];
  const computerImage = loadedAssets['PC1.png'];
  const pulse = 0.5 + 0.5 * Math.sin(uiFxState.frame * 0.14);

  for (const desk of desks) {
    drawDeskProcessingGlow(ctx, desk, pulse);
    drawSprite(ctx, deskImage, desk.x, desk.y, spriteConfigs.desk);
    drawDeskQueueStack(ctx, desk);
    drawDeskTaskOverlay(ctx, desk);
    drawLogicalPoint(ctx, desk.x, desk.y);
  }

  for (const desk of desks) {
    const computerPosition = getDeskSlotPosition(desk, 'computer');
    drawSprite(ctx, computerImage, computerPosition.x, computerPosition.y, spriteConfigs.computer);
    drawLogicalPoint(ctx, computerPosition.x, computerPosition.y);
  }

  const walkSprites = {
    up: loadedAssets['Julia_walk_Up.png'],
    down: loadedAssets['Julia_walk_Foward.png'],
    left: loadedAssets['Julia_walk_Left.png'],
    right: loadedAssets['Julia_walk_Rigth.png']
  };
  const idleSprite = loadedAssets['Julia-Idle.png'];

  function drawAnimatedSprite(image, frame, x, y) {
    if (!image) {
      return;
    }

    const hasFourFrames = image.width >= 4 && image.width % 4 === 0;
    if (hasFourFrames) {
      const frameWidth = image.width / 4;
      const frameX = (frame % 4) * frameWidth;
      drawSprite(ctx, image, x, y, {
        ...spriteConfigs.agent,
        sourceX: frameX,
        sourceY: 0,
        sourceWidth: frameWidth,
        sourceHeight: image.height
      });
      return;
    }

    drawSprite(ctx, image, x, y, spriteConfigs.agent);
  }

  for (const agent of agents) {
    const isMoving = agent.state === 'moving' || agent.state === 'idle';
    const isSitting = agent.state === 'sitting';
    const sprite = isMoving ? walkSprites[agent.direction] : idleSprite;
    const frame = isMoving ? agent.animationFrame : 0;
    const renderX = isSitting ? agent.x + SITTING_OFFSET.x : agent.x;
    const renderY = isSitting ? agent.y + SITTING_OFFSET.y : agent.y;
    drawAnimatedSprite(sprite, frame, renderX, renderY);
    drawAgentIdentityLayer(ctx, agent);
    drawLogicalPoint(ctx, agent.x, agent.y);
  }

  drawTaskFx(ctx);
  drawGlobalHud(ctx);
  drawPendingWorkflowsOverlay(ctx);
  drawWorkflowOverlay(ctx);
}
