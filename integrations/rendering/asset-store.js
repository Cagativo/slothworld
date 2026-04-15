import { generateId } from '../../core/utils.js';
import { logRenderEvent } from './render-stability.js';
import { warnLegacyExecutionPath } from '../../core/execution-pipeline.js';

export async function persistRenderedAsset({ productId, provider, prompt, renderResult }) {
  // LEGACY: canonical pipeline persists inside Node worker. This helper remains for compatibility.
  warnLegacyExecutionPath('integrations/rendering/asset-store.persistRenderedAsset', {
    reason: 'legacy_asset_store_persistence_helper',
    disabled: true
  });

  void productId;
  void provider;
  void prompt;
  void renderResult;
  const assetId = `asset-${generateId()}`;
  logRenderEvent(assetId, 'ASSET_STORE_DISABLED', {
    reason: 'legacy_execution_disabled'
  });
  throw new Error('legacy_execution_disabled:integrations/rendering/asset-store.persistRenderedAsset');
}