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

async function getClient(): Promise<{ client: S3Client; bucket: string }> {
  const cfg = await getS3Config();
  const client = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
    forcePathStyle: cfg.forcePathStyle,
  });
  return { client, bucket: cfg.bucket };
}

export async function uploadToS3(key: string, body: Buffer, contentType: string): Promise<void> {
  const { client, bucket } = await getClient();
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
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
  const { client, bucket } = await getClient();
  const upload = new Upload({
    client,
    params: { Bucket: bucket, Key: key, Body: body, ContentType: contentType },
    queueSize: 4,           // concurrent part uploads
    partSize: 5 * 1024 * 1024, // 5 MB (S3 minimum part size)
  });
  await upload.done();
}

export async function deleteFromS3(key: string): Promise<void> {
  const { client, bucket } = await getClient();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export async function copyS3Object(sourceKey: string, destKey: string): Promise<void> {
  const { client, bucket } = await getClient();
  await client.send(
    new CopyObjectCommand({
      Bucket: bucket,
      CopySource: `${bucket}/${sourceKey}`,
      Key: destKey,
    }),
  );
}

export async function getS3ObjectStream(
  key: string,
): Promise<{ stream: Readable; contentType: string | undefined; contentLength: number | undefined }> {
  const { client, bucket } = await getClient();
  const resp = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return {
    stream: resp.Body as Readable,
    contentType: resp.ContentType,
    contentLength: resp.ContentLength,
  };
}
