import { prisma } from './client.js';
import path from 'path';

export interface S3Config {
  endpoint: string;
  bucket: string;
  rootFolderPrefix: string;
  accessKey: string;
  secretKey: string;
  forcePathStyle: boolean;
}

const S3_KEYS = ['s3_endpoint', 's3_bucket', 's3_root_folder', 's3_access_key', 's3_secret_key'] as const;
const DISK_KEYS = ['disk_storage_path'] as const;
const STORAGE_KEYS = ['storage_type'] as const;

export const SMTP_KEYS = ['smtp_host', 'smtp_port', 'smtp_username', 'smtp_password', 'smtp_from_address', 'smtp_encryption'] as const;
export type SmtpKey = typeof SMTP_KEYS[number];

let cache: Record<string, string> | null = null;
let cacheAt = 0;
const CACHE_TTL = 30_000;

export function invalidateSettingsCache(): void {
  cache = null;
  cacheAt = 0;
}

export async function getAllSettings(): Promise<Record<string, string>> {
  if (cache && Date.now() - cacheAt < CACHE_TTL) return cache;

  const rows = await prisma.setting.findMany({ select: { key: true, value: true } });
  cache = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  cacheAt = Date.now();
  return cache;
}

function env(key: string): string {
  return process.env[key.toUpperCase()] ?? '';
}

/**
 * Strip a leading bucket-vhost label from the endpoint hostname.
 *
 * Admins sometimes paste the bucket's virtual-host URL (e.g.
 * https://<bucket>.sfo3.digitaloceanspaces.com) as the S3 endpoint. Combined
 * with path-style addressing (forced below for non-AWS endpoints) every
 * request then references the bucket twice — in the host AND the path. DO
 * Spaces resolves the bucket from the vhost and treats the full path as the
 * object key, so keys get stored with the bucket name embedded, and
 * CopyObjectCommand's x-amz-copy-source (parsed server-side as bucket +
 * clean key) fails with NoSuchKey, breaking trash/restore/purge (MAS-667).
 * Normalizing at read time makes any admin-entered vhost URL harmless.
 */
function normalizeS3Endpoint(endpoint: string, bucket: string): string {
  if (!endpoint || !bucket) return endpoint;
  try {
    const url = new URL(endpoint);
    const vhostLabel = `${bucket}.`;
    if (url.hostname.startsWith(vhostLabel) && url.hostname.length > vhostLabel.length) {
      url.hostname = url.hostname.slice(vhostLabel.length);
      let normalized = url.toString();
      // URL.toString() appends a trailing slash to a bare origin; don't add
      // one the admin didn't type
      if (normalized.endsWith('/') && !endpoint.endsWith('/')) {
        normalized = normalized.slice(0, -1);
      }
      return normalized;
    }
  } catch {
    // Not a parseable URL — pass through unchanged and let the SDK reject it
  }
  return endpoint;
}

export async function getS3Config(): Promise<S3Config> {
  const s = await getAllSettings();
  const bucket = s['s3_bucket'] || env('S3_BUCKET');
  const endpoint = normalizeS3Endpoint(s['s3_endpoint'] || env('S3_ENDPOINT'), bucket);
  return {
    endpoint,
    bucket,
    // rootFolderPrefix is optional; empty string means store at bucket root
    rootFolderPrefix: s['s3_root_folder'] ?? env('S3_ROOT_FOLDER'),
    accessKey: s['s3_access_key'] || env('S3_ACCESS_KEY'),
    secretKey: s['s3_secret_key'] || env('S3_SECRET_KEY'),
    // Auto-detect: no endpoint or AWS endpoint → virtual-hosted style; any
    // custom endpoint → path style (computed from the NORMALIZED endpoint)
    forcePathStyle: endpoint.length > 0 && !endpoint.includes('amazonaws.com'),
  };
}

export interface DiskConfig {
  storagePath: string;
}

export async function getDiskConfig(): Promise<DiskConfig> {
  const s = await getAllSettings();
  return {
    storagePath: s['disk_storage_path'] || process.env.DISK_STORAGE_PATH || path.join(process.cwd(), 'uploads'),
  };
}

export async function upsertSettings(updates: Record<string, string>): Promise<void> {
  const entries = Object.entries(updates);
  if (!entries.length) return;

  await prisma.$transaction(
    entries.map(([key, value]) =>
      prisma.setting.upsert({
        where: { key },
        create: { key, value },
        update: { value, updatedAt: new Date() },
      }),
    ),
  );
  invalidateSettingsCache();
}

export { S3_KEYS, DISK_KEYS, STORAGE_KEYS };

