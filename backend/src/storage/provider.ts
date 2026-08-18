import type { Readable } from 'stream';

export interface StorageProvider {
  upload(key: string, body: Buffer, contentType: string): Promise<void>;
  streamUpload(key: string, body: Readable, contentType: string): Promise<void>;
  download(key: string): Promise<{ stream: Readable; contentType?: string; contentLength?: number }>;
  delete(key: string): Promise<void>;
  copy(sourceKey: string, destKey: string): Promise<void>;
}
