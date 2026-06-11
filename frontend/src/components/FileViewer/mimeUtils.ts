export const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
  flac: 'audio/flac', aac: 'audio/aac',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', ogv: 'video/ogg',
  pdf: 'application/pdf',
  txt: 'text/plain', md: 'text/markdown', json: 'application/json',
  xml: 'application/xml', csv: 'text/csv', yaml: 'application/yaml', yml: 'application/yaml',
  glb: 'model/gltf-binary', gltf: 'model/gltf+json',
  obj: 'model/obj', stl: 'model/stl', ply: 'model/ply',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
  psd: 'application/x-photoshop',
};

export type RendererType = 'image' | 'audio' | 'video' | 'pdf' | 'code' | 'model' | 'office' | 'archive' | 'unsupported';

export function resolveMimeType(mimeType: string | null, filename: string): string {
  if (mimeType && mimeType !== 'application/octet-stream') return mimeType;
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_MIME[ext] ?? 'application/octet-stream';
}

const NON_RENDERABLE_IMAGE_TYPES = new Set([
  'image/vnd.adobe.photoshop',
  'image/x-photoshop',
]);

export function resolveRenderer(mimeType: string): RendererType {
  if (NON_RENDERABLE_IMAGE_TYPES.has(mimeType)) return 'unsupported';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType === 'application/pdf') return 'pdf';
  if (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml' ||
    mimeType === 'application/yaml'
  ) return 'code';
  if (mimeType.startsWith('model/')) return 'model';
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) return 'office';
  if (mimeType === 'application/zip') return 'archive';
  return 'unsupported';
}
