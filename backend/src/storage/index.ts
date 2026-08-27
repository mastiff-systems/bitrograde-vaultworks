import { getAllSettings } from '../db/settings.js';
import type { StorageProvider } from './provider.js';

let cachedProvider: StorageProvider | null = null;
let cachedType: string | null = null;

export async function getStorageProvider(): Promise<StorageProvider> {
  const settings = await getAllSettings();
  const type = settings['storage_type'] || 's3';
  if (!cachedProvider || cachedType !== type) {
    cachedProvider =
      type === 'disk'
        ? new (await import('./disk.js')).DiskStorageProvider()
        : new (await import('./s3-provider.js')).S3StorageProvider();
    cachedType = type;
  }
  return cachedProvider;
}

export function invalidateStorageCache(): void {
  cachedProvider = null;
  cachedType = null;
}
