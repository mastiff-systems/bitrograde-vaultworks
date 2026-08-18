/**
 * MAS-415 – E2E tests for the storage abstraction layer
 *
 * Covers all four scenarios from the issue:
 *   1. Disk storage — full round trip (upload → verify on disk → download → delete)
 *   2. S3 storage — key format unchanged, no regression in upload/download/delete
 *   3. Provider switching via UI (disk→S3; settings persist; routing updated)
 *   4. Edge cases (ENOENT tolerance, double-delete, orphaned file cleanup on DB failure)
 *
 * Infrastructure requirements (all provided by docker-compose dev stack):
 *   - PostgreSQL test DB  : localhost:5433 / vaultworks_test
 *   - MinIO               : localhost:9000 / bucket vaultworks-assets
 *       credentials: vaultworks / vaultworks123
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import type { FastifyInstance } from 'fastify';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { buildApp, cleanDb } from './helpers.js';
import { prisma } from '../db/client.js';
import { invalidateStorageCache } from '../storage/index.js';
import { invalidateSettingsCache } from '../db/settings.js';
import { DiskStorageProvider } from '../storage/disk.js';

// ── MinIO settings (docker-compose dev stack) ─────────────────────────────────
const MINIO_SETTINGS: Record<string, string> = {
  storage_type: 's3',
  s3_endpoint: 'http://localhost:9000',
  s3_bucket: 'vaultworks-assets',
  s3_access_key: 'vaultworks',
  s3_secret_key: 'vaultworks123',
  s3_force_path_style: 'true',
  s3_root_folder: '',
};

// A minimal valid 1×1 RGB PNG for thumbnail generation
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
);

// ── Shared state ──────────────────────────────────────────────────────────────
let app: FastifyInstance;
let token: string;       // regular uploader
let adminToken: string;  // admin (for settings changes)
let userId: string;      // uploader's userId (needed for uploadedBy FK on disk assets)
let tmpDir: string;      // isolated disk storage root for all tests

// ── Lifecycle ─────────────────────────────────────────────────────────────────
beforeAll(async () => {
  app = await buildApp();
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vaultworks-storage-e2e-'));
});

afterAll(async () => {
  await app.close();
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

beforeEach(async () => {
  await cleanDb();
  invalidateSettingsCache();
  invalidateStorageCache();

  // Create a regular uploader
  const reg = await request(app.server)
    .post('/api/auth/register')
    .send({ email: 'uploader@test.com', password: 'password123' });
  token = reg.body.token;
  userId = reg.body.user.id;

  // Create admin user and re-login so the JWT contains role=admin
  const adminReg = await request(app.server)
    .post('/api/auth/register')
    .send({ email: 'admin@test.com', password: 'password123' });
  const adminUserId = adminReg.body.user.id;
  await prisma.user.update({ where: { id: adminUserId }, data: { role: 'admin' } });
  const login = await request(app.server)
    .post('/api/auth/login')
    .send({ email: 'admin@test.com', password: 'password123' });
  adminToken = login.body.token;
});

afterEach(() => {
  invalidateSettingsCache();
  invalidateStorageCache();
  // NOTE: vi.restoreAllMocks() is intentionally omitted here.
  // Tests that use vi.spyOn must call spy.mockRestore() themselves (see Scenario 4).
  // Double-restoring a spy after prisma.asset.create has already been patched back
  // corrupts the property descriptor and breaks subsequent tests.
});

// ── Helper: change storage settings via admin API ─────────────────────────────
async function setStorage(settings: Record<string, string>): Promise<void> {
  const res = await request(app.server)
    .put('/api/admin/settings')
    .set('Authorization', `Bearer ${adminToken}`)
    .send(settings);
  expect(res.status).toBe(200);
  // Admin route already calls invalidateStorageCache() — no need to repeat here.
}

// =============================================================================
// Scenario 1 — Disk storage: full round trip
// =============================================================================
describe('Scenario 1: Disk storage — full round trip', () => {
  beforeEach(async () => {
    await setStorage({ storage_type: 'disk', disk_storage_path: tmpDir });
  });

  it('upload creates file at uploads/assets/{uuid}/{filename}', async () => {
    const content = 'hello disk world';

    const res = await request(app.server)
      .post('/api/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', Buffer.from(content), { filename: 'test.txt', contentType: 'text/plain' });

    expect(res.status).toBe(201);
    const assetId: string = res.body[0].id;
    const expectedPath = path.join(tmpDir, `assets/${assetId}/test.txt`);

    const stat = await fs.stat(expectedPath);
    expect(stat.isFile()).toBe(true);

    const readBack = await fs.readFile(expectedPath, 'utf-8');
    expect(readBack).toBe(content);
  });

  it('download returns correct bytes and content-type', async () => {
    const content = 'downloadable content';

    const uploadRes = await request(app.server)
      .post('/api/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', Buffer.from(content), { filename: 'dl.txt', contentType: 'text/plain' });
    expect(uploadRes.status).toBe(201);
    const assetId: string = uploadRes.body[0].id;

    const dlRes = await request(app.server)
      .get(`/api/files/${assetId}/download?token=${token}`);

    expect(dlRes.status).toBe(200);
    expect(dlRes.text).toBe(content);
    expect(dlRes.headers['content-type']).toMatch(/text\/plain/);
  });

  it('stream endpoint returns correct bytes', async () => {
    const content = 'stream test content';

    const uploadRes = await request(app.server)
      .post('/api/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', Buffer.from(content), { filename: 'stream.txt', contentType: 'text/plain' });
    expect(uploadRes.status).toBe(201);
    const assetId: string = uploadRes.body[0].id;

    const streamRes = await request(app.server)
      .get(`/api/files/${assetId}/stream?token=${token}`);

    expect(streamRes.status).toBe(200);
    expect(streamRes.text).toBe(content);
  });

  it('delete removes file from disk and cleans up DB record', async () => {
    const content = 'to be deleted';

    const uploadRes = await request(app.server)
      .post('/api/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', Buffer.from(content), { filename: 'delme.txt', contentType: 'text/plain' });
    expect(uploadRes.status).toBe(201);
    const assetId: string = uploadRes.body[0].id;
    const filePath = path.join(tmpDir, `assets/${assetId}/delme.txt`);

    // File must exist before delete
    await expect(fs.access(filePath)).resolves.toBeUndefined();

    const delRes = await request(app.server)
      .delete(`/api/files/${assetId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(delRes.status).toBe(204);

    // File must be gone from disk
    await expect(fs.access(filePath)).rejects.toThrow();

    // DB record must be gone
    const dbRecord = await prisma.asset.findUnique({ where: { id: assetId } });
    expect(dbRecord).toBeNull();
  });

  it('image upload creates thumbnail file on disk', async () => {
    const uploadRes = await request(app.server)
      .post('/api/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', TINY_PNG, { filename: 'img.png', contentType: 'image/png' });

    expect(uploadRes.status).toBe(201);
    const { id: assetId, thumbnail_key: thumbnailKey } = uploadRes.body[0];

    expect(thumbnailKey).toBeTruthy();
    const thumbPath = path.join(tmpDir, thumbnailKey as string);
    const thumbStat = await fs.stat(thumbPath);
    expect(thumbStat.isFile()).toBe(true);
    expect(thumbStat.size).toBeGreaterThan(0);
  });

  it('delete also removes thumbnail from disk', async () => {
    const uploadRes = await request(app.server)
      .post('/api/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', TINY_PNG, { filename: 'img2.png', contentType: 'image/png' });
    expect(uploadRes.status).toBe(201);
    const { id: assetId, thumbnail_key: thumbnailKey } = uploadRes.body[0];
    expect(thumbnailKey).toBeTruthy();

    const thumbPath = path.join(tmpDir, thumbnailKey as string);
    await expect(fs.access(thumbPath)).resolves.toBeUndefined();

    const delRes = await request(app.server)
      .delete(`/api/files/${assetId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(delRes.status).toBe(204);

    // Thumbnail must be gone from disk
    await expect(fs.access(thumbPath)).rejects.toThrow();
  });

  it('storageKey in DB uses assets/{uuid}/{filename} format', async () => {
    const uploadRes = await request(app.server)
      .post('/api/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', Buffer.from('key format test'), { filename: 'keytest.txt', contentType: 'text/plain' });
    expect(uploadRes.status).toBe(201);
    const assetId: string = uploadRes.body[0].id;

    const dbAsset = await prisma.asset.findUnique({
      where: { id: assetId },
      select: { storageKey: true },
    });
    expect(dbAsset?.storageKey).toBe(`assets/${assetId}/keytest.txt`);
  });
});

// =============================================================================
// Scenario 2 — S3 storage: key format and operations unchanged
// =============================================================================
describe('Scenario 2: S3 storage — key format and operations unchanged', () => {
  beforeEach(async () => {
    await setStorage(MINIO_SETTINGS);
  });

  it('storageKey uses assets/{uuid}/{filename} (no root folder prefix)', async () => {
    const res = await request(app.server)
      .post('/api/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', Buffer.from('s3 content'), { filename: 's3file.txt', contentType: 'text/plain' });

    expect(res.status).toBe(201);
    const assetId: string = res.body[0].id;

    const dbAsset = await prisma.asset.findUnique({
      where: { id: assetId },
      select: { storageKey: true },
    });
    // The storageKey stored in DB never includes the S3 root folder prefix;
    // the S3 provider prepends it internally.
    expect(dbAsset?.storageKey).toBe(`assets/${assetId}/s3file.txt`);
  });

  it('upload returns 201 and asset record', async () => {
    const res = await request(app.server)
      .post('/api/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', Buffer.from('s3 upload test'), { filename: 's3upload.txt', contentType: 'text/plain' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].original_name).toBe('s3upload.txt');
    expect(res.body[0].id).toBeTruthy();
  });

  it('download streams S3 content correctly', async () => {
    const content = 's3 download test content';

    const uploadRes = await request(app.server)
      .post('/api/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', Buffer.from(content), { filename: 's3dl.txt', contentType: 'text/plain' });
    expect(uploadRes.status).toBe(201);
    const assetId: string = uploadRes.body[0].id;

    const dlRes = await request(app.server)
      .get(`/api/files/${assetId}/download?token=${token}`);

    expect(dlRes.status).toBe(200);
    expect(dlRes.text).toBe(content);
  });

  it('delete removes asset from S3 and DB', async () => {
    const uploadRes = await request(app.server)
      .post('/api/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', Buffer.from('delete from s3'), { filename: 's3del.txt', contentType: 'text/plain' });
    expect(uploadRes.status).toBe(201);
    const assetId: string = uploadRes.body[0].id;

    const delRes = await request(app.server)
      .delete(`/api/files/${assetId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(delRes.status).toBe(204);

    // DB record must be gone
    const dbAsset = await prisma.asset.findUnique({ where: { id: assetId } });
    expect(dbAsset).toBeNull();

    // Attempting to download returns 404 (asset gone from DB)
    const dlRes = await request(app.server)
      .get(`/api/files/${assetId}/download?token=${token}`);
    expect(dlRes.status).toBe(404);
  });

  it('storageKey format preserved when root folder prefix is set', async () => {
    // Set a non-empty root folder prefix
    await setStorage({ ...MINIO_SETTINGS, s3_root_folder: 'test-prefix' });

    const res = await request(app.server)
      .post('/api/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', Buffer.from('prefixed'), { filename: 'prefixed.txt', contentType: 'text/plain' });
    expect(res.status).toBe(201);
    const assetId: string = res.body[0].id;

    // The DB storageKey is STILL the base key without prefix — the prefix is an S3 concern
    const dbAsset = await prisma.asset.findUnique({
      where: { id: assetId },
      select: { storageKey: true },
    });
    expect(dbAsset?.storageKey).toBe(`assets/${assetId}/prefixed.txt`);

    // Download must still work (S3Provider uses prefix internally)
    const dlRes = await request(app.server)
      .get(`/api/files/${assetId}/download?token=${token}`);
    expect(dlRes.status).toBe(200);
    expect(dlRes.text).toBe('prefixed');
  });
});

// =============================================================================
// Scenario 3 — Provider switching via the Storage Settings tab
// =============================================================================
describe('Scenario 3: Provider switching via UI', () => {
  it('settings persist after page reload (GET /api/admin/settings)', async () => {
    await setStorage({ storage_type: 'disk', disk_storage_path: tmpDir });

    // Simulate page reload: re-fetch settings
    const res = await request(app.server)
      .get('/api/admin/settings')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.storage_type).toBe('disk');
    expect(res.body.disk_storage_path).toBe(tmpDir);
  });

  it('switching disk→S3: new upload goes to S3, not disk', async () => {
    // Step 1: upload with disk storage
    await setStorage({ storage_type: 'disk', disk_storage_path: tmpDir });

    const diskUpload = await request(app.server)
      .post('/api/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', Buffer.from('disk asset'), { filename: 'disk-asset.txt', contentType: 'text/plain' });
    expect(diskUpload.status).toBe(201);
    const diskAssetId: string = diskUpload.body[0].id;
    const diskFilePath = path.join(tmpDir, `assets/${diskAssetId}/disk-asset.txt`);
    await expect(fs.access(diskFilePath)).resolves.toBeUndefined();

    // Step 2: switch to S3
    await setStorage(MINIO_SETTINGS);

    // Step 3: new upload should go to S3, not disk
    const s3Upload = await request(app.server)
      .post('/api/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', Buffer.from('s3 asset'), { filename: 's3-asset.txt', contentType: 'text/plain' });
    expect(s3Upload.status).toBe(201);
    const s3AssetId: string = s3Upload.body[0].id;

    // New file must NOT be on disk
    const s3FilePath = path.join(tmpDir, `assets/${s3AssetId}/s3-asset.txt`);
    await expect(fs.access(s3FilePath)).rejects.toThrow();

    // New S3 upload must be downloadable
    const dlRes = await request(app.server)
      .get(`/api/files/${s3AssetId}/download?token=${token}`);
    expect(dlRes.status).toBe(200);
    expect(dlRes.text).toBe('s3 asset');
  });

  it('old disk asset is inaccessible after switching to S3 (documented behavior)', async () => {
    // Step 1: upload with disk storage
    await setStorage({ storage_type: 'disk', disk_storage_path: tmpDir });

    const diskUpload = await request(app.server)
      .post('/api/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', Buffer.from('pre-switch asset'), { filename: 'pre-switch.txt', contentType: 'text/plain' });
    expect(diskUpload.status).toBe(201);
    const diskAssetId: string = diskUpload.body[0].id;

    // Disk asset is accessible while disk is active
    const diskDl = await request(app.server)
      .get(`/api/files/${diskAssetId}/download?token=${token}`);
    expect(diskDl.status).toBe(200);

    // Step 2: switch to S3
    await setStorage(MINIO_SETTINGS);

    // Step 3: old disk asset download attempt — the S3 provider tries to GET
    // the key from S3 (where it doesn't exist) → expected failure.
    // DOCUMENTED BEHAVIOR: assets uploaded under a different provider are
    // inaccessible after switching without a migration step.
    const postSwitchDl = await request(app.server)
      .get(`/api/files/${diskAssetId}/download?token=${token}`);
    expect([500, 404]).toContain(postSwitchDl.status);

    // The disk file itself is still physically present
    const diskFilePath = path.join(tmpDir, `assets/${diskAssetId}/pre-switch.txt`);
    await expect(fs.access(diskFilePath)).resolves.toBeUndefined();
  });

  it('switching S3→disk: subsequent upload goes to disk', async () => {
    // Step 1: start with S3
    await setStorage(MINIO_SETTINGS);

    const s3Upload = await request(app.server)
      .post('/api/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', Buffer.from('s3 first'), { filename: 's3first.txt', contentType: 'text/plain' });
    expect(s3Upload.status).toBe(201);

    // Step 2: switch to disk
    await setStorage({ storage_type: 'disk', disk_storage_path: tmpDir });

    const diskUpload = await request(app.server)
      .post('/api/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', Buffer.from('disk second'), { filename: 'disk-second.txt', contentType: 'text/plain' });
    expect(diskUpload.status).toBe(201);
    const diskAssetId: string = diskUpload.body[0].id;

    // New file must be on disk
    const diskFilePath = path.join(tmpDir, `assets/${diskAssetId}/disk-second.txt`);
    await expect(fs.access(diskFilePath)).resolves.toBeUndefined();
  });
});

// =============================================================================
// Scenario 4 — Edge cases and bulletproofing
// =============================================================================
describe('Scenario 4: Edge cases', () => {
  beforeEach(async () => {
    await setStorage({ storage_type: 'disk', disk_storage_path: tmpDir });
  });

  it('ENOENT tolerance: delete with missing disk file returns 204, not 500', async () => {
    // Create DB record pointing to a file that does NOT exist on disk
    const ghostKey = `assets/ghost-${Date.now()}/ghost.txt`;
    const asset = await prisma.asset.create({
      data: {
        originalName: 'ghost.txt',
        storageKey: ghostKey,
        assetType: 'other',
        uploadedBy: userId,
      },
    });

    // Verify the file does not exist on disk
    await expect(fs.access(path.join(tmpDir, ghostKey))).rejects.toThrow();

    const delRes = await request(app.server)
      .delete(`/api/files/${asset.id}`)
      .set('Authorization', `Bearer ${token}`);

    // Must return 204 — DiskStorageProvider.delete() silently swallows ENOENT
    expect(delRes.status).toBe(204);

    // DB record must still be cleaned up
    const check = await prisma.asset.findUnique({ where: { id: asset.id } });
    expect(check).toBeNull();
  });

  it('double-delete: second DELETE returns 404, not 500', async () => {
    const uploadRes = await request(app.server)
      .post('/api/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', Buffer.from('once only'), { filename: 'once.txt', contentType: 'text/plain' });
    expect(uploadRes.status).toBe(201);
    const assetId: string = uploadRes.body[0].id;

    // First delete — succeeds
    const del1 = await request(app.server)
      .delete(`/api/files/${assetId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del1.status).toBe(204);

    // Second delete — asset is gone from DB; route returns 404 before touching storage
    const del2 = await request(app.server)
      .delete(`/api/files/${assetId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del2.status).toBe(404);
  });

  it('download of non-existent disk file returns 500 (no silent data loss)', async () => {
    // Create DB record pointing to a missing file — simulate partially-deleted state
    const ghostKey = `assets/missing-${Date.now()}/missing.txt`;
    const asset = await prisma.asset.create({
      data: {
        originalName: 'missing.txt',
        storageKey: ghostKey,
        assetType: 'other',
        uploadedBy: userId,
      },
    });

    const dlRes = await request(app.server)
      .get(`/api/files/${asset.id}/download?token=${token}`);

    // DiskStorageProvider.download throws when the file is not found → 500
    expect(dlRes.status).toBe(500);
  });

  // NOTE: this test must run LAST in Scenario 4.
  // vi.spyOn(prisma.asset, 'create') uses Prisma's internal Proxy and may leave
  // the property in a non-callable state after mockRestore() in older vitest
  // versions. Running it last means no subsequent test in this file calls
  // prisma.asset.create after the spy has been active.
  it('orphaned file is cleaned up when DB insert fails after disk write', async () => {
    // Spy on DiskStorageProvider.delete to verify cleanup is triggered
    const deleteSpy = vi.spyOn(DiskStorageProvider.prototype, 'delete');

    // Force the prisma asset.create call to fail
    const createSpy = vi.spyOn(prisma.asset, 'create').mockRejectedValueOnce(
      new Error('Simulated DB insert failure'),
    );

    try {
      const uploadRes = await request(app.server)
        .post('/api/upload')
        .set('Authorization', `Bearer ${token}`)
        .attach('files', Buffer.from('orphan test'), { filename: 'orphan.txt', contentType: 'text/plain' });

      // Upload must fail (DB insert threw)
      expect(uploadRes.status).toBe(500);

      // DiskStorageProvider.delete must have been called to clean up the orphaned file
      expect(deleteSpy).toHaveBeenCalled();
    } finally {
      createSpy.mockRestore();
      deleteSpy.mockRestore();
    }
  });
});
