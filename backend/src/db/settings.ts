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

const S3_KEYS = ['s3_endpoint', 's3_bucket', 's3_root_folder', 's3_access_key', 's3_secret_key', 's3_force_path_style'] as const;
const DISK_KEYS = ['disk_storage_path'] as const;
const STORAGE_KEYS = ['storage_type'] as const;

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

export async function getS3Config(): Promise<S3Config> {
  const s = await getAllSettings();
  return {
    endpoint: s['s3_endpoint'] || env('S3_ENDPOINT'),
    bucket: s['s3_bucket'] || env('S3_BUCKET'),
    // rootFolderPrefix is optional; empty string means store at bucket root
    rootFolderPrefix: s['s3_root_folder'] ?? env('S3_ROOT_FOLDER'),
    accessKey: s['s3_access_key'] || env('S3_ACCESS_KEY'),
    secretKey: s['s3_secret_key'] || env('S3_SECRET_KEY'),
    // forcePathStyle defaults to false (unchecked) unless explicitly set to 'true'
    forcePathStyle:
      s['s3_force_path_style'] === 'true' || env('S3_FORCE_PATH_STYLE') === 'true',
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
