function joinList(values) {
  if (!Array.isArray(values)) {
    return '';
  }

  return values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(', ');
}

export function normalizeDesignIntent(rawIntent, context = {}) {
  const intent = rawIntent && typeof rawIntent === 'object' ? rawIntent : {};
  const generatedPrompt = context
    && context.generate_design_prompt
    && context.generate_design_prompt.output
    && typeof context.generate_design_prompt.output.prompt === 'string'
    ? context.generate_design_prompt.output.prompt
    : '';

  return {
    product_name: String(intent.product_name || context.keyword || 'Untitled product'),
    style: String(intent.style || 'clean ecommerce illustration'),
    mood: String(intent.mood || 'commercial'),
    colors: Array.isArray(intent.colors) ? intent.colors.map((value) => String(value)) : ['neutral'],
    composition: String(intent.composition || 'centered hero composition'),
    camera: String(intent.camera || 'front-facing studio shot'),
    background: String(intent.background || 'minimal plain backdrop'),
    prompt: String(intent.prompt || ''),
    prompt_hint: generatedPrompt || String(intent.prompt_hint || '')
  };
}

export function buildBaseRenderPrompt(designIntent) {
  const colors = joinList(designIntent.colors);
  const parts = [
    `Product: ${designIntent.product_name}`,
    `Style: ${designIntent.style}`,
    `Mood: ${designIntent.mood}`,
    `Composition: ${designIntent.composition}`,
    `Camera: ${designIntent.camera}`,
    `Background: ${designIntent.background}`
  ];

  if (colors) {
    parts.push(`Colors: ${colors}`);
  }

  if (designIntent.prompt) {
    parts.push(`Prompt: ${designIntent.prompt}`);
  }

  if (!designIntent.prompt && designIntent.prompt_hint) {
    parts.push(`Design brief: ${designIntent.prompt_hint}`);
  }

  return parts.join(' | ');
}

export function buildProviderPrompt(provider, designIntent) {
  const basePrompt = buildBaseRenderPrompt(designIntent);
  return `${basePrompt}. Generate a polished ecommerce-ready product image.`;
}