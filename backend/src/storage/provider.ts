import type { Readable } from 'stream';

/**
 * Normalized "source object does not exist" error thrown by providers so that
 * routes can react to a missing object without inspecting provider-specific
 * error shapes (ENOENT on disk, NoSuchKey/NotFound on S3).
 */
export class StorageNotFoundError extends Error {
  constructor(key: string, cause?: unknown) {
    super(`Storage object not found: ${key}`);
    this.name = 'StorageNotFoundError';
    this.cause = cause;
  }
}

export interface StorageProvider {
  upload(key: string, body: Buffer, contentType: string): Promise<void>;
  streamUpload(key: string, body: Readable, contentType: string): Promise<void>;
  download(key: string): Promise<{ stream: Readable; contentType?: string; contentLength?: number }>;
  delete(key: string): Promise<void>;
  copy(sourceKey: string, destKey: string): Promise<void>;
  /**
   * Move an object from sourceKey to destKey.
   * Throws StorageNotFoundError if the source does not exist (nothing has changed).
   * Deleting the source after a successful copy is best-effort: a failure leaves
   * an orphan at sourceKey, but the caller's DB will already point at destKey.
   */
  move(sourceKey: string, destKey: string): Promise<void>;
}
