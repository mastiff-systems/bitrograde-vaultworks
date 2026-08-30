/**
 * @deprecated MAS-602 — do NOT import from this module in production code.
 * These helpers talk straight to S3 and ignore the storage_type setting, which
 * breaks deployments running on disk storage. Use getStorageProvider() from
 * './index.js' instead. This file survives only because several test files
 * still vi.mock it; delete it once those mocks are removed.
 */
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

/**
 * Prepend rootFolderPrefix to an object key.
 * If prefix is empty/unset the key is returned unchanged (root-level storage).
 * Trailing slashes on the prefix are stripped to avoid double-slash keys.
 */
function prefixedKey(prefix: string, key: string): string {
  if (!prefix) return key;
  return `${prefix.replace(/\/+$/, '')}/${key}`;
}

async function getClient(): Promise<{ client: S3Client; bucket: string; prefix: string }> {
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

export async function uploadToS3(key: string, body: Buffer, contentType: string): Promise<void> {
  const { client, bucket, prefix } = await getClient();
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: prefixedKey(prefix, key), Body: body, ContentType: contentType }));
}

/**
 * Stream a file to S3 without buffering the entire body in Node.js heap.
 * Uses @aws-sdk/lib-storage's multipart Upload which handles chunking,
 * retry, and concurrency transparently.
 */
export async function streamUploadToS3(
  key: string,
  body: Readable,
  contentType: string,
): Promise<void> {
  const { client, bucket, prefix } = await getClient();
  const upload = new Upload({
    client,
    params: { Bucket: bucket, Key: prefixedKey(prefix, key), Body: body, ContentType: contentType },
    queueSize: 4,           // concurrent part uploads
    partSize: 5 * 1024 * 1024, // 5 MB (S3 minimum part size)
  });
  await upload.done();
}

export async function deleteFromS3(key: string): Promise<void> {
  const { client, bucket, prefix } = await getClient();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: prefixedKey(prefix, key) }));
}

export async function copyS3Object(sourceKey: string, destKey: string): Promise<void> {
  const { client, bucket, prefix } = await getClient();
  await client.send(
    new CopyObjectCommand({
      Bucket: bucket,
      CopySource: `${bucket}/${prefixedKey(prefix, sourceKey)}`,
      Key: prefixedKey(prefix, destKey),
    }),
  );
}

/**
 * Move an S3 object by copying to destKey then deleting sourceKey.
 * Throws if the copy fails (nothing has changed).
 * Delete of the source is best-effort: a failure leaves an orphaned object at sourceKey
 * but the DB will already point to destKey, so it will not be served or re-used.
 * The orphan is recoverable by an operator and does not block downstream work.
 */
export async function moveS3Object(sourceKey: string, destKey: string): Promise<void> {
  await copyS3Object(sourceKey, destKey);
  await deleteFromS3(sourceKey).catch((err) => {
    console.error(`[s3] moveS3Object: failed to delete source "${sourceKey}" after copy:`, err);
  });
}

export async function getS3ObjectStream(
  key: string,
): Promise<{ stream: Readable; contentType: string | undefined; contentLength: number | undefined }> {
  const { client, bucket, prefix } = await getClient();
  const resp = await client.send(new GetObjectCommand({ Bucket: bucket, Key: prefixedKey(prefix, key) }));
  return {
    stream: resp.Body as Readable,
    contentType: resp.ContentType,
    contentLength: resp.ContentLength,
  };
}
