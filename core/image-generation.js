export async function generateImage(provider = 'openai', prompt = '') {
  const selectedProvider = String(provider || 'openai').toLowerCase();
  const normalizedPrompt = String(prompt || '').trim();

  if (!normalizedPrompt) {
    throw new Error('missing_prompt');
  }

  if (selectedProvider !== 'openai') {
    throw new Error(`provider_not_supported:${selectedProvider}`);
  }

  const response = await fetch('/render/openai/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      provider: 'openai',
      prompt: normalizedPrompt,
      model: 'gpt-image-1'
    })
  });

  if (!response.ok) {
    let detail = null;
    try {
      const body = await response.json();
      detail = body && body.error ? String(body.error) : null;
    } catch (_error) {
      detail = null;
    }

    throw new Error(detail
      ? `openai_generate_${response.status}:${detail}`
      : `openai_generate_${response.status}`);
  }

  const payload = await response.json();
  const result = payload && payload.result ? payload.result : null;
  if (!result) {
    throw new Error('openai_invalid_response');
  }

  return result;
}

export async function generateProductImage(prompt) {
  return generateImage('openai', prompt);
}
