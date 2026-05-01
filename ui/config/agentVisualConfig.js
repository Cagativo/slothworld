export const agentVisualConfig = {
  operator: {
    baseSprite: 'sloth_idle.png',
    animations: {
      idle: {
        key: 'sloth_idle',
        sprite: 'sloth_idle.png',
        frameWidth: 32,
        frameHeight: 32,
        frameCount: 4,
        fps: 5,
        loop: true
      },
      queued: {
        key: 'sloth_idle',
        sprite: 'sloth_idle.png',
        frameWidth: 32,
        frameHeight: 32,
        frameCount: 4,
        fps: 4,
        loop: true
      },
      working: {
        key: 'sloth_working',
        sprite: 'sloth_working.png',
        frameWidth: 64,
        frameHeight: 64,
        frameCount: 6,
        fps: 9,
        loop: true
      },
      awaiting_ack: {
        key: 'sloth_working',
        sprite: 'sloth_working.png',
        frameWidth: 64,
        frameHeight: 64,
        frameCount: 6,
        fps: 5,
        loop: true
      },
      error: {
        key: 'sloth_error',
        sprite: 'sloth_error.png',
        frameWidth: 32,
        frameHeight: 32,
        frameCount: 4,
        fps: 7,
        loop: true
      },
      acknowledged: {
        key: 'sloth_idle',
        sprite: 'sloth_idle.png',
        frameWidth: 32,
        frameHeight: 32,
        frameCount: 4,
        fps: 5,
        loop: true
      }
    }
  }
};

// UI-only sprite atlas aliases.
// Keys are animation identifiers referenced by the role config above.
export const agentAnimationSprites = {
  sloth_idle: 'sloth_idle.png',
  sloth_working: 'sloth_working.png',
  sloth_error: 'sloth_error.png'
};

export function resolveAgentVisual(role, state) {
  const roleKey = typeof role === 'string' && role.trim() ? role : 'operator';
  const stateKey = typeof state === 'string' && state.trim() ? state : 'idle';

  const visualByRole = agentVisualConfig[roleKey] || agentVisualConfig.operator;
  const animationDef = (visualByRole && visualByRole.animations && visualByRole.animations[stateKey])
    || (visualByRole && visualByRole.animations && visualByRole.animations.idle)
    || null;
  const normalizedAnimation = typeof animationDef === 'string'
    ? { key: animationDef }
    : animationDef;
  const animationKey = normalizedAnimation && normalizedAnimation.key ? normalizedAnimation.key : null;

  const spriteFilename = animationKey ? (agentAnimationSprites[animationKey] || null) : null;

  return {
    role: roleKey,
    state: stateKey,
    baseSprite: visualByRole ? visualByRole.baseSprite : null,
    animation: animationKey,
    spriteFilename: normalizedAnimation && normalizedAnimation.sprite ? normalizedAnimation.sprite : spriteFilename,
    frameWidth: normalizedAnimation && Number.isFinite(normalizedAnimation.frameWidth) ? normalizedAnimation.frameWidth : null,
    frameHeight: normalizedAnimation && Number.isFinite(normalizedAnimation.frameHeight) ? normalizedAnimation.frameHeight : null,
    frameCount: normalizedAnimation && Number.isFinite(normalizedAnimation.frameCount) ? normalizedAnimation.frameCount : 1,
    fps: normalizedAnimation && Number.isFinite(normalizedAnimation.fps) ? normalizedAnimation.fps : 5,
    loop: normalizedAnimation && typeof normalizedAnimation.loop === 'boolean' ? normalizedAnimation.loop : true,
    frameDurationMs: normalizedAnimation && Number.isFinite(normalizedAnimation.fps) && normalizedAnimation.fps > 0
      ? Math.round(1000 / normalizedAnimation.fps)
      : 200
  };
}
