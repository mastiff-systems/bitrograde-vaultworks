/**
 * MAS-668 – bucket-vhost endpoint normalization in getS3Config()
 *
 * Prod's s3_endpoint setting was the bucket's virtual-host URL, which combined
 * with forcePathStyle double-references the bucket and embeds the bucket name
 * in every stored key; CopyObjectCommand then 404s (NoSuchKey) and trash/
 * restore/purge break (MAS-667). getS3Config() must strip a leading
 * `<bucket>.` hostname label and compute forcePathStyle from the normalized
 * endpoint. These are pure unit tests — prisma is mocked, no DB needed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../db/client.js', () => ({
  prisma: {
    setting: { findMany: vi.fn() },
  },
}));

import { prisma } from '../db/client.js';
import { getS3Config, invalidateSettingsCache } from '../db/settings.js';

const mockFindMany = vi.mocked(prisma.setting.findMany);
const ENV_KEYS = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ROOT_FOLDER', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'] as const;

beforeEach(() => {
  // Settings rows are cached for 30s; each test seeds its own rows
  invalidateSettingsCache();
  // Blank the env fallbacks so only the mocked settings rows matter
  for (const key of ENV_KEYS) vi.stubEnv(key, '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  mockFindMany.mockReset();
});

async function configFor(settings: Record<string, string>) {
  mockFindMany.mockResolvedValue(
    Object.entries(settings).map(([key, value]) => ({ key, value })) as never,
  );
  return getS3Config();
}

describe('getS3Config() endpoint normalization (MAS-668)', () => {
  it('strips a DO Spaces bucket-vhost label down to the region endpoint, path style', async () => {
    const cfg = await configFor({
      s3_endpoint: 'https://bitrograde-vaultworks-prod.sfo3.digitaloceanspaces.com',
      s3_bucket: 'bitrograde-vaultworks-prod',
    });
    expect(cfg.endpoint).toBe('https://sfo3.digitaloceanspaces.com');
    expect(cfg.forcePathStyle).toBe(true);
  });

  it('leaves a bare region endpoint unchanged, path style', async () => {
    const cfg = await configFor({
      s3_endpoint: 'https://sfo3.digitaloceanspaces.com',
      s3_bucket: 'bitrograde-vaultworks-prod',
    });
    expect(cfg.endpoint).toBe('https://sfo3.digitaloceanspaces.com');
    expect(cfg.forcePathStyle).toBe(true);
  });

  it('leaves an empty endpoint (AWS default) unchanged, virtual-hosted style', async () => {
    const cfg = await configFor({ s3_bucket: 'mybucket' });
    expect(cfg.endpoint).toBe('');
    expect(cfg.forcePathStyle).toBe(false);
  });

  it('strips an AWS bucket-vhost endpoint and keeps virtual-hosted style', async () => {
    const cfg = await configFor({
      s3_endpoint: 'https://mybucket.s3.us-east-1.amazonaws.com',
      s3_bucket: 'mybucket',
    });
    expect(cfg.endpoint).toBe('https://s3.us-east-1.amazonaws.com');
    expect(cfg.forcePathStyle).toBe(false);
  });

  it('does not strip when the bucket is only a hostname prefix, not a full label', async () => {
    const cfg = await configFor({
      s3_endpoint: 'https://vaultworks.sfo3.digitaloceanspaces.com',
      s3_bucket: 'vault',
    });
    expect(cfg.endpoint).toBe('https://vaultworks.sfo3.digitaloceanspaces.com');
    expect(cfg.forcePathStyle).toBe(true);
  });

  it('leaves an endpoint with an explicit port unchanged, path style', async () => {
    const cfg = await configFor({
      s3_endpoint: 'https://minio.local:9000',
      s3_bucket: 'test-bucket',
    });
    expect(cfg.endpoint).toBe('https://minio.local:9000');
    expect(cfg.forcePathStyle).toBe(true);
  });

  it('preserves protocol and port when stripping a vhost label', async () => {
    const cfg = await configFor({
      s3_endpoint: 'http://test-bucket.minio.local:9000',
      s3_bucket: 'test-bucket',
    });
    expect(cfg.endpoint).toBe('http://minio.local:9000');
    expect(cfg.forcePathStyle).toBe(true);
  });
});
