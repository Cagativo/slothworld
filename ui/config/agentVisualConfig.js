export const agentVisualConfig = {
  operator: {
    baseSprite: 'julia_idle.png',
    animations: {
      idle: 'julia_idle',
      moving: 'julia_walk',
      working: 'julia_typing',
      delivering: 'julia_walk',
      error: 'julia_error'
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
  const animationKey = (visualByRole && visualByRole.animations && visualByRole.animations[stateKey])
    || (visualByRole && visualByRole.animations && visualByRole.animations.idle)
    || null;

  const spriteFilename = animationKey ? (agentAnimationSprites[animationKey] || null) : null;

  return {
    role: roleKey,
    state: stateKey,
    baseSprite: visualByRole ? visualByRole.baseSprite : null,
    animation: animationKey,
    spriteFilename
  };
}
