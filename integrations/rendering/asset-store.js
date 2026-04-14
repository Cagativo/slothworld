import { generateId } from '../../core/utils.js';
import { logRenderEvent } from './render-stability.js';

export async function persistRenderedAsset({ productId, provider, prompt, renderResult }) {
  const assetId = `asset-${generateId()}`;
  const renderId = renderResult
    && renderResult.metadata
    && typeof renderResult.metadata.renderId === 'string'
    ? renderResult.metadata.renderId
    : null;
  const rawContentBase64 = renderResult ? renderResult.contentBase64 : null;
  let contentBase64 = '';

  if (typeof rawContentBase64 === 'string') {
    contentBase64 = rawContentBase64.trim();
  } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(rawContentBase64)) {
    contentBase64 = rawContentBase64.toString('base64');
  } else if (
    typeof Buffer !== 'undefined'
    &&
    rawContentBase64
    && typeof rawContentBase64 === 'object'
    && rawContentBase64.type === 'Buffer'
    && Array.isArray(rawContentBase64.data)
  ) {
    contentBase64 = Buffer.from(rawContentBase64.data).toString('base64');
  }

  if (!contentBase64) {
    throw new Error('asset_store_contract_error:missing_contentBase64');
  }

  const payload = {
    assetId,
    productId,
    provider,
    prompt,
    contentBase64,
    extension: 'png',
    mimeType: 'image/png',
    metadata: renderResult && renderResult.metadata ? renderResult.metadata : {}
  };
  const payloadJson = JSON.stringify(payload);
  logRenderEvent(renderId || assetId, 'ASSET_STORE_PERSIST_REQUESTED', {
    assetId,
    productId,
    provider,
    hasContentBase64: true
  });
  logRenderEvent(renderId || assetId, 'ASSET_STORE_PERSIST_PAYLOAD', {
    assetId,
    productId,
    provider,
    payloadBytes: payloadJson.length,
    contentBase64Length: contentBase64.length
  });

  const response = await fetch('/asset-store/render', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: payloadJson
  });

  if (!response.ok) {
    let detail = null;
    try {
      const body = await response.json();
      detail = body && body.error ? String(body.error) : null;
    } catch (_error) {
      detail = null;
    }

    logRenderEvent(renderId || assetId, 'ASSET_STORE_PERSIST_FAILED', {
      assetId,
      productId,
      provider,
      status: response.status,
      detail,
      payloadBytes: payloadJson.length,
      hasContentBase64: !!contentBase64
    });
    throw new Error(detail
      ? `asset_store_${response.status}:${detail}`
      : `asset_store_${response.status}`);
  }

  const data = await response.json();
  if (!data || !data.asset) {
    logRenderEvent(renderId || assetId, 'ASSET_STORE_INVALID_RESPONSE', {
      assetId,
      productId,
      provider
    });
    throw new Error('asset_store_invalid_response');
  }

  logRenderEvent(renderId || assetId, 'ASSET_STORE_PERSISTED', {
    assetId: data.asset.assetId,
    productId: data.asset.productId,
    provider: data.asset.provider,
    url: data.asset.url
  });

  return data.asset;
}