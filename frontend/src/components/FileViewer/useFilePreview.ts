import { useMemo } from 'react';
import { streamUrl, downloadUrl, type Asset } from '../../api/client.js';
import { resolveMimeType, resolveRenderer, type RendererType } from './mimeUtils.js';

export interface UseFilePreviewResult {
  url: string;
  downloadHref: string;
  mimeType: string;
  renderer: RendererType;
}

export function useFilePreview(asset: Asset): UseFilePreviewResult {
  return useMemo(() => {
    const mimeType = resolveMimeType(asset.mime_type, asset.original_name);
    return {
      url: streamUrl(asset.id),
      downloadHref: downloadUrl(asset.id),
      mimeType,
      renderer: resolveRenderer(mimeType),
    };
  }, [asset.id, asset.mime_type, asset.original_name]);
}
