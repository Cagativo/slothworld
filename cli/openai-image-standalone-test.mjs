import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_STANDALONE_TIMEOUT_MS || 15_000);
const prompt = process.argv.slice(2).join(' ').trim() || 'minimal product test render';

function timeoutAfter(ms) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`standalone_timeout:${ms}`)), ms);
  });
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('[STANDALONE_OPENAI_IMAGE_ERROR] missing OPENAI_API_KEY');
    process.exitCode = 1;
    return;
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const requestPayload = {
    model: 'gpt-5',
    input: prompt,
    tools: [{ type: 'image_generation' }]
  };

  console.log('[STANDALONE_OPENAI_IMAGE_REQUEST]', {
    timeoutMs: OPENAI_TIMEOUT_MS,
    promptLength: prompt.length,
    requestPayload
  });

  const startedAt = Date.now();
  try {
    const response = await Promise.race([
      client.responses.create(requestPayload),
      timeoutAfter(OPENAI_TIMEOUT_MS)
    ]);

    console.log('[STANDALONE_OPENAI_IMAGE_RESOLVED]', {
      durationMs: Date.now() - startedAt,
      outputItems: Array.isArray(response && response.output) ? response.output.length : 0
    });
    console.dir(response, { depth: null, maxArrayLength: null, maxStringLength: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'unknown_error');
    const outcome = message.startsWith('standalone_timeout:') ? 'hang_timeout' : 'rejected';

    console.error('[STANDALONE_OPENAI_IMAGE_FAILURE]', {
      outcome,
      durationMs: Date.now() - startedAt,
      error: {
        name: error && error.name ? error.name : 'Error',
        message,
        stack: error && error.stack ? error.stack : null,
        status: error && Object.prototype.hasOwnProperty.call(error, 'status') ? error.status : null,
        code: error && Object.prototype.hasOwnProperty.call(error, 'code') ? error.code : null,
        type: error && Object.prototype.hasOwnProperty.call(error, 'type') ? error.type : null
      }
    });
    console.dir(error, { depth: null, maxArrayLength: null, maxStringLength: null });
    process.exitCode = 1;
  }
}

await main();
