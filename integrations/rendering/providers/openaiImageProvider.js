import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../../');
const GENERATED_ASSETS_DIR = path.join(ROOT_DIR, 'assets', 'generated');

function extractBase64Image(response) {
  if (!response || !Array.isArray(response.output)) {
    return null;
  }

  for (const output of response.output) {
    if (!output || output.type !== 'image_generation_call') {
      continue;
    }

    if (typeof output.result === 'string' && output.result.trim()) {
      return output.result.trim();
    }
  }

  return null;
}

export async function generateImage({ prompt, productId }) {
  const normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
  const normalizedProductId = typeof productId === 'string' && productId.trim() ? productId.trim() : 'product';

  if (!normalizedPrompt) {
    throw new Error('missing_prompt');
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('openai_api_key_missing');
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const createdAt = Date.now();
  const id = `${createdAt}-${Math.random().toString(16).slice(2, 10)}`;
  const safeProductId = normalizedProductId
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'product';

  console.log('[OPENAI_IMAGE_REQUEST]', {
    productId: safeProductId,
    promptLength: normalizedPrompt.length,
    model: 'gpt-5'
  });

  const response = await client.responses.create({
    model: 'gpt-5',
    input: normalizedPrompt,
    tools: [{ type: 'image_generation' }]
  });

  const base64Png = extractBase64Image(response);
  if (!base64Png) {
    throw new Error('OPENAI_IMAGE_FAILED_NO_OUTPUT');
  }

  const targetDir = path.join(GENERATED_ASSETS_DIR, safeProductId);
  fs.mkdirSync(targetDir, { recursive: true });

  const assetId = `asset-${id}`;
  const filename = `${assetId}.png`;
  const assetPath = path.join(targetDir, filename);
  fs.writeFileSync(assetPath, Buffer.from(base64Png, 'base64'));

  console.log('[OPENAI_IMAGE_SUCCESS]', {
    productId: safeProductId,
    assetId,
    base64Length: base64Png.length
  });
  console.log('[OPENAI_IMAGE_SAVE_PATH]', assetPath);

  return {
    assetId,
    productId: safeProductId,
    url: `/assets/generated/${safeProductId}/${filename}`,
    provider: 'openai',
    prompt: normalizedPrompt,
    createdAt,
    mimeType: 'image/png',
    hasContentBase64: true
  };
}
