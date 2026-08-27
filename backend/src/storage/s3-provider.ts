import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { Readable } from 'stream';
import { getS3Config } from '../db/settings.js';
import type { StorageProvider } from './provider.js';

/**
 * S3StorageProvider implements StorageProvider using AWS S3 (or compatible APIs
 * such as MinIO, DigitalOcean Spaces).
 *
 * This is a class-based refactor of the standalone functions in s3.ts.
 * The original s3.ts is intentionally kept intact for the 4 route files that
 * still import from it directly; those will be migrated in a follow-up issue.
 */
export class S3StorageProvider implements StorageProvider {
  /**
   * Prepend rootFolderPrefix to an object key.
   * If prefix is empty/unset the key is returned unchanged (root-level storage).
   * Trailing slashes on the prefix are stripped to avoid double-slash keys.
   */
  private prefixedKey(prefix: string, key: string): string {
    if (!prefix) return key;
    return `${prefix.replace(/\/+$/, '')}/${key}`;
  }

  private async getClient(): Promise<{ client: S3Client; bucket: string; prefix: string }> {
    const cfg = await getS3Config();
    const client = new S3Client({
      endpoint: cfg.endpoint,
      // region is not user-configurable; fall back to env or SDK default.
      // S3-compatible providers (MinIO, DigitalOcean Spaces) ignore this value.
      region: process.env.S3_REGION || 'us-east-1',
      credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
      forcePathStyle: cfg.forcePathStyle,
    });
    return { client, bucket: cfg.bucket, prefix: cfg.rootFolderPrefix };
  }

  async upload(key: string, body: Buffer, contentType: string): Promise<void> {
    const { client, bucket, prefix } = await this.getClient();
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: this.prefixedKey(prefix, key),
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  /**
   * Stream a file to S3 without buffering the entire body in Node.js heap.
   * Uses @aws-sdk/lib-storage's multipart Upload which handles chunking,
   * retry, and concurrency transparently.
   */
  async streamUpload(key: string, body: Readable, contentType: string): Promise<void> {
    const { client, bucket, prefix } = await this.getClient();
    const upload = new Upload({
      client,
      params: {
        Bucket: bucket,
        Key: this.prefixedKey(prefix, key),
        Body: body,
        ContentType: contentType,
      },
      queueSize: 4,              // concurrent part uploads
      partSize: 5 * 1024 * 1024, // 5 MB (S3 minimum part size)
    });
    await upload.done();
  }

  async download(
    key: string,
  ): Promise<{ stream: Readable; contentType?: string; contentLength?: number }> {
    const { client, bucket, prefix } = await this.getClient();
    const resp = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: this.prefixedKey(prefix, key) }),
    );
    return {
      stream: resp.Body as Readable,
      contentType: resp.ContentType,
      contentLength: resp.ContentLength,
    };
  }

  async delete(key: string): Promise<void> {
    const { client, bucket, prefix } = await this.getClient();
    await client.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: this.prefixedKey(prefix, key) }),
    );
  }

  async copy(sourceKey: string, destKey: string): Promise<void> {
    const { client, bucket, prefix } = await this.getClient();
    await client.send(
      new CopyObjectCommand({
        Bucket: bucket,
        CopySource: `${bucket}/${this.prefixedKey(prefix, sourceKey)}`,
        Key: this.prefixedKey(prefix, destKey),
      }),
    );
  }
}
