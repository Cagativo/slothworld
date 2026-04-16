export const agentVisualConfig = {
  operator: {
    baseSprite: 'julia_idle.png',
    animations: {
      idle: {
        key: 'julia_idle',
        frameWidth: 32,
        frameHeight: 32,
        frameCount: 4,
        frameDurationMs: 220
      },
      moving: {
        key: 'julia_walk',
        frameWidth: 64,
        frameHeight: 64,
        frameCount: 4,
        frameDurationMs: 140
      },
      working: {
        key: 'julia_typing',
        frameWidth: 64,
        frameHeight: 64,
        frameCount: 6,
        frameDurationMs: 120
      },
      delivering: {
        key: 'julia_walk',
        frameWidth: 64,
        frameHeight: 64,
        frameCount: 4,
        frameDurationMs: 140
      },
      error: {
        key: 'julia_error',
        frameWidth: 32,
        frameHeight: 32,
        frameCount: 4,
        frameDurationMs: 180
      }
    }
  }
};

// UI-only sprite atlas aliases.
// Keys are animation identifiers referenced by the role config above.
export const agentAnimationSprites = {
  julia_idle: 'Julia-Idle.png',
  julia_typing: 'Julia_PC.png',
  julia_walk: 'Julia_walk_Foward.png',
  julia_error: 'Julia.png'
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
    spriteFilename,
    frameWidth: normalizedAnimation && Number.isFinite(normalizedAnimation.frameWidth) ? normalizedAnimation.frameWidth : null,
    frameHeight: normalizedAnimation && Number.isFinite(normalizedAnimation.frameHeight) ? normalizedAnimation.frameHeight : null,
    frameCount: normalizedAnimation && Number.isFinite(normalizedAnimation.frameCount) ? normalizedAnimation.frameCount : 1,
    frameDurationMs: normalizedAnimation && Number.isFinite(normalizedAnimation.frameDurationMs) ? normalizedAnimation.frameDurationMs : 200
  };
}
