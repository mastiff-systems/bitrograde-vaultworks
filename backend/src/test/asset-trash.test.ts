import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { FastifyInstance } from 'fastify';
import { buildApp, cleanDb } from './helpers.js';
import { prisma } from '../db/client.js';
import { collectUniqueKeys, toTrashKey, toLiveKey } from '../lib/assetTrash.js';
import { purgeExpiredAssets } from '../jobs/trashPurge.js';

// MAS-690: trash/restore/purge must cover the COMPLETE object set of a versioned
// asset — Asset.storageKey, Asset.thumbnailKey, and every AssetVersion.storageKey.
// Two invariants from the version-upload flow shape the fixtures here:
//  - INV-1: the latest AssetVersion.storageKey === Asset.storageKey (same physical
//    object), so physical moves/deletes must be deduped.
//  - INV-2: the v1 snapshot row keeps the original base key assets/{id}/{originalName}.

vi.mock('../storage/index.js', () => ({
  getStorageProvider: vi.fn().mockResolvedValue({
    upload: vi.fn().mockResolvedValue(undefined),
    streamUpload: vi.fn().mockResolvedValue(undefined),
    download: vi.fn().mockResolvedValue({
      stream: Buffer.from('file-content'),
      contentType: 'application/octet-stream',
      contentLength: 12,
    }),
    delete: vi.fn().mockResolvedValue(undefined),
    copy: vi.fn().mockResolvedValue(undefined),
    move: vi.fn().mockResolvedValue(undefined),
  }),
  invalidateStorageCache: vi.fn(),
}));

let app: FastifyInstance;
let token: string;
let userId: string;

async function getMockProvider() {
  const { getStorageProvider } = await import('../storage/index.js');
  const provider = await getStorageProvider();
  return {
    move: provider.move as ReturnType<typeof vi.fn>,
    delete: provider.delete as ReturnType<typeof vi.fn>,
  };
}

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await cleanDb();
  const res = await request(app.server)
    .post('/api/auth/register')
    .send({ email: 'trasher@example.com', password: 'password123' });
  token = res.body.token;
  userId = res.body.user.id;
  const { move, delete: del } = await getMockProvider();
  move.mockClear();
  del.mockClear();
});

/**
 * Creates a versioned asset in the state left behind by two version uploads:
 * v1 snapshot at the original base key (INV-2), v2 and v3 under versions/,
 * Asset.storageKey === v3.storageKey (INV-1), plus a thumbnail.
 * 4 unique physical objects: base, thumbnail, v2 file, v3 file.
 */
async function createVersionedAsset(opts: { trashed?: boolean; deletedAt?: Date } = {}) {
  const prefix = opts.trashed ? 'trash' : 'assets';
  const asset = await prisma.asset.create({
    data: {
      originalName: 'hero.png',
      storageKey: 'placeholder',
      thumbnailKey: 'placeholder',
      assetType: 'image',
      mimeType: 'image/png',
      uploadedBy: userId,
      ...(opts.trashed ? { deletedAt: opts.deletedAt ?? new Date(), deletedBy: userId } : {}),
    },
  });
  const baseKey = `${prefix}/${asset.id}/hero.png`;
  const v2Key = `${prefix}/${asset.id}/versions/1720000000001_hero.png`;
  const v3Key = `${prefix}/${asset.id}/versions/1720000000002_hero.png`;
  const thumbKey = `${prefix}/${asset.id}/thumbnail.webp`;

  await prisma.asset.update({
    where: { id: asset.id },
    data: { storageKey: v3Key, thumbnailKey: thumbKey },
  });
  await prisma.assetVersion.createMany({
    data: [
      { assetId: asset.id, versionNumber: 1, storageKey: baseKey, uploadedBy: userId },
      { assetId: asset.id, versionNumber: 2, storageKey: v2Key, uploadedBy: userId },
      { assetId: asset.id, versionNumber: 3, storageKey: v3Key, uploadedBy: userId },
    ],
  });

  return { id: asset.id, baseKey, v2Key, v3Key, thumbKey };
}

// --- Unit: key-mapping helpers ---

describe('assetTrash key mapping', () => {
  it('toTrashKey swaps the prefix and preserves the subpath', () => {
    expect(toTrashKey('abc', 'assets/abc/hero.png')).toBe('trash/abc/hero.png');
    expect(toTrashKey('abc', 'assets/abc/versions/123_hero.png')).toBe('trash/abc/versions/123_hero.png');
    expect(toTrashKey('abc', 'assets/abc/thumbnail.webp')).toBe('trash/abc/thumbnail.webp');
  });

  it('toTrashKey returns null for non-conforming keys', () => {
    expect(toTrashKey('abc', 'legacy/hero.png')).toBeNull();
    expect(toTrashKey('abc', 'assets/other-id/hero.png')).toBeNull();
    expect(toTrashKey('abc', 'trash/abc/hero.png')).toBeNull();
  });

  it('toLiveKey is the exact inverse of toTrashKey', () => {
    expect(toLiveKey('abc', 'trash/abc/versions/123_hero.png')).toBe('assets/abc/versions/123_hero.png');
    expect(toLiveKey('abc', 'trash/abc/hero.png')).toBe('assets/abc/hero.png');
    expect(toLiveKey('abc', 'assets/abc/hero.png')).toBeNull();
    expect(toLiveKey('abc', 'weird/key.png')).toBeNull();
  });

  it('collectUniqueKeys dedupes the shared latest-version key (INV-1) and skips null thumbnail', () => {
    expect(
      collectUniqueKeys({
        storageKey: 'assets/a/versions/2_f.png',
        thumbnailKey: 'assets/a/thumbnail.webp',
        versions: [
          { storageKey: 'assets/a/f.png' },
          { storageKey: 'assets/a/versions/2_f.png' },
        ],
      }),
    ).toEqual(['assets/a/versions/2_f.png', 'assets/a/thumbnail.webp', 'assets/a/f.png']);

    expect(collectUniqueKeys({ storageKey: 'k', thumbnailKey: null, versions: [] })).toEqual(['k']);
  });
});

// --- DELETE /api/files/:id on a versioned asset ---

describe('DELETE /api/files/:id (versioned asset)', () => {
  it('moves every unique physical object to trash/ exactly once and rewrites all rows', async () => {
    const { id, baseKey, v2Key, v3Key, thumbKey } = await createVersionedAsset();
    const { move } = await getMockProvider();

    const res = await request(app.server)
      .delete(`/api/files/${id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(204);

    // One move per unique physical object — the shared v3/main key moves ONCE (INV-1)
    expect(move).toHaveBeenCalledTimes(4);
    expect(move).toHaveBeenCalledWith(v3Key, `trash/${id}/versions/1720000000002_hero.png`);
    expect(move).toHaveBeenCalledWith(thumbKey, `trash/${id}/thumbnail.webp`);
    expect(move).toHaveBeenCalledWith(baseKey, `trash/${id}/hero.png`);
    expect(move).toHaveBeenCalledWith(v2Key, `trash/${id}/versions/1720000000001_hero.png`);

    // Asset row rewritten
    const asset = await prisma.asset.findUnique({ where: { id } });
    expect(asset!.deletedAt).not.toBeNull();
    expect(asset!.storageKey).toBe(`trash/${id}/versions/1720000000002_hero.png`);
    expect(asset!.thumbnailKey).toBe(`trash/${id}/thumbnail.webp`);

    // Every AssetVersion row rewritten — including the v1 base-key snapshot (INV-2)
    const versions = await prisma.assetVersion.findMany({ where: { assetId: id }, orderBy: { versionNumber: 'asc' } });
    expect(versions.map((v) => v.storageKey)).toEqual([
      `trash/${id}/hero.png`,
      `trash/${id}/versions/1720000000001_hero.png`,
      `trash/${id}/versions/1720000000002_hero.png`,
    ]);
  });

  it('leaves DB untouched when the main object move fails', async () => {
    const { id, v3Key } = await createVersionedAsset();
    const { move } = await getMockProvider();
    move.mockRejectedValueOnce(new Error('S3 exploded'));

    const res = await request(app.server)
      .delete(`/api/files/${id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(500);
    const asset = await prisma.asset.findUnique({ where: { id } });
    expect(asset!.deletedAt).toBeNull();
    expect(asset!.storageKey).toBe(v3Key);
  });
});

// --- version routes 404 on trashed parent (MAS-689 §6) ---

describe('version routes on a trashed asset', () => {
  it('list, upload, download and preview all return 404', async () => {
    const { id } = await createVersionedAsset({ trashed: true });
    const version = await prisma.assetVersion.findFirst({ where: { assetId: id, versionNumber: 2 } });

    const list = await request(app.server)
      .get(`/api/files/${id}/versions`)
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(404);

    const upload = await request(app.server)
      .post(`/api/files/${id}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('data'), { filename: 'hero.png', contentType: 'image/png' });
    expect(upload.status).toBe(404);

    const download = await request(app.server)
      .get(`/api/files/${id}/versions/${version!.id}/download`)
      .query({ token });
    expect(download.status).toBe(404);

    const preview = await request(app.server)
      .get(`/api/files/${id}/versions/${version!.id}/preview`)
      .query({ token });
    expect(preview.status).toBe(404);
  });

  it('version routes still work on a live asset', async () => {
    const { id } = await createVersionedAsset();
    const version = await prisma.assetVersion.findFirst({ where: { assetId: id, versionNumber: 2 } });

    const list = await request(app.server)
      .get(`/api/files/${id}/versions`)
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(3);

    const download = await request(app.server)
      .get(`/api/files/${id}/versions/${version!.id}/download`)
      .query({ token });
    expect(download.status).toBe(200);
  });
});

// --- POST /api/files/:id/restore on a versioned asset ---

describe('POST /api/files/:id/restore (versioned asset)', () => {
  it('moves the complete trashed set back to assets/ and rewrites all rows', async () => {
    const { id } = await createVersionedAsset({ trashed: true });
    const { move } = await getMockProvider();

    const res = await request(app.server)
      .post(`/api/files/${id}/restore`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);

    expect(move).toHaveBeenCalledTimes(4);
    expect(move).toHaveBeenCalledWith(`trash/${id}/versions/1720000000002_hero.png`, `assets/${id}/versions/1720000000002_hero.png`);
    expect(move).toHaveBeenCalledWith(`trash/${id}/thumbnail.webp`, `assets/${id}/thumbnail.webp`);
    expect(move).toHaveBeenCalledWith(`trash/${id}/hero.png`, `assets/${id}/hero.png`);
    expect(move).toHaveBeenCalledWith(`trash/${id}/versions/1720000000001_hero.png`, `assets/${id}/versions/1720000000001_hero.png`);

    const asset = await prisma.asset.findUnique({ where: { id } });
    expect(asset!.deletedAt).toBeNull();
    expect(asset!.storageKey).toBe(`assets/${id}/versions/1720000000002_hero.png`);
    expect(asset!.thumbnailKey).toBe(`assets/${id}/thumbnail.webp`);

    const versions = await prisma.assetVersion.findMany({ where: { assetId: id }, orderBy: { versionNumber: 'asc' } });
    expect(versions.map((v) => v.storageKey)).toEqual([
      `assets/${id}/hero.png`,
      `assets/${id}/versions/1720000000001_hero.png`,
      `assets/${id}/versions/1720000000002_hero.png`,
    ]);

    // Version download works again after restore
    const version = versions.find((v) => v.versionNumber === 2);
    const download = await request(app.server)
      .get(`/api/files/${id}/versions/${version!.id}/download`)
      .query({ token });
    expect(download.status).toBe(200);
  });
});

// --- DELETE /api/files/:id/purge on a versioned asset ---

describe('DELETE /api/files/:id/purge (versioned asset)', () => {
  it('deletes every unique physical object and cascade-removes version rows', async () => {
    const { id } = await createVersionedAsset({ trashed: true });
    const { delete: del } = await getMockProvider();

    const res = await request(app.server)
      .delete(`/api/files/${id}/purge`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(204);

    // One delete per unique physical object — base, thumbnail, v2 file, v3 file
    expect(del).toHaveBeenCalledTimes(4);
    expect(del).toHaveBeenCalledWith(`trash/${id}/versions/1720000000002_hero.png`);
    expect(del).toHaveBeenCalledWith(`trash/${id}/thumbnail.webp`);
    expect(del).toHaveBeenCalledWith(`trash/${id}/hero.png`);
    expect(del).toHaveBeenCalledWith(`trash/${id}/versions/1720000000001_hero.png`);

    expect(await prisma.asset.findUnique({ where: { id } })).toBeNull();
    expect(await prisma.assetVersion.count({ where: { assetId: id } })).toBe(0);
  });
});

// --- POST /api/files/bulk-delete on versioned assets ---

describe('POST /api/files/bulk-delete (versioned asset)', () => {
  it('moves the complete object set per asset and rewrites version rows', async () => {
    const versioned = await createVersionedAsset();
    // Plain non-versioned asset in the same batch — regression: key shape unchanged
    const plain = await prisma.asset.create({
      data: {
        originalName: 'plain.txt',
        storageKey: 'assets/plain/plain.txt',
        assetType: 'other',
        uploadedBy: userId,
      },
    });
    const { move } = await getMockProvider();

    const res = await request(app.server)
      .post('/api/files/bulk-delete')
      .set('Authorization', `Bearer ${token}`)
      .send({ ids: [versioned.id, plain.id] });

    expect(res.status).toBe(200);
    expect(res.body.deleted).toEqual(expect.arrayContaining([versioned.id, plain.id]));
    expect(res.body.errors).toEqual([]);

    // 4 unique objects for the versioned asset + 1 for the plain asset
    expect(move).toHaveBeenCalledTimes(5);
    expect(move).toHaveBeenCalledWith(versioned.baseKey, `trash/${versioned.id}/hero.png`);
    expect(move).toHaveBeenCalledWith(versioned.v2Key, `trash/${versioned.id}/versions/1720000000001_hero.png`);
    expect(move).toHaveBeenCalledWith(versioned.v3Key, `trash/${versioned.id}/versions/1720000000002_hero.png`);
    expect(move).toHaveBeenCalledWith(versioned.thumbKey, `trash/${versioned.id}/thumbnail.webp`);
    // Non-conforming legacy main key falls back to today's computed trash target
    expect(move).toHaveBeenCalledWith('assets/plain/plain.txt', `trash/${plain.id}/plain.txt`);

    const versions = await prisma.assetVersion.findMany({ where: { assetId: versioned.id }, orderBy: { versionNumber: 'asc' } });
    expect(versions.map((v) => v.storageKey)).toEqual([
      `trash/${versioned.id}/hero.png`,
      `trash/${versioned.id}/versions/1720000000001_hero.png`,
      `trash/${versioned.id}/versions/1720000000002_hero.png`,
    ]);
  });

  it('a storage failure on one asset does not abort the rest', async () => {
    const a = await createVersionedAsset();
    const b = await prisma.asset.create({
      data: { originalName: 'b.txt', storageKey: `assets/will-fail/b.txt`, assetType: 'other', uploadedBy: userId },
    });
    const { move } = await getMockProvider();
    // First move (a's main object) blows up; everything else succeeds
    move.mockRejectedValueOnce(new Error('S3 exploded'));

    const res = await request(app.server)
      .post('/api/files/bulk-delete')
      .set('Authorization', `Bearer ${token}`)
      .send({ ids: [a.id, b.id] });

    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([{ id: a.id, reason: 'Storage error' }]);
    expect(res.body.deleted).toEqual([b.id]);

    const untouched = await prisma.asset.findUnique({ where: { id: a.id } });
    expect(untouched!.deletedAt).toBeNull();
    expect(untouched!.storageKey).toBe(a.v3Key);
  });
});

// --- Scheduled auto-purge job ---

describe('trashPurge job (versioned asset)', () => {
  it('deletes every unique physical object of an expired asset', async () => {
    const THIRTY_ONE_DAYS_MS = 31 * 24 * 60 * 60 * 1000;
    const expired = await createVersionedAsset({
      trashed: true,
      deletedAt: new Date(Date.now() - THIRTY_ONE_DAYS_MS),
    });
    // Recently trashed asset must survive the job
    const fresh = await createVersionedAsset({ trashed: true });
    const { delete: del } = await getMockProvider();

    await purgeExpiredAssets();

    expect(del).toHaveBeenCalledTimes(4);
    expect(del).toHaveBeenCalledWith(`trash/${expired.id}/versions/1720000000002_hero.png`);
    expect(del).toHaveBeenCalledWith(`trash/${expired.id}/thumbnail.webp`);
    expect(del).toHaveBeenCalledWith(`trash/${expired.id}/hero.png`);
    expect(del).toHaveBeenCalledWith(`trash/${expired.id}/versions/1720000000001_hero.png`);

    expect(await prisma.asset.findUnique({ where: { id: expired.id } })).toBeNull();
    expect(await prisma.assetVersion.count({ where: { assetId: expired.id } })).toBe(0);
    expect(await prisma.asset.findUnique({ where: { id: fresh.id } })).not.toBeNull();
    expect(await prisma.assetVersion.count({ where: { assetId: fresh.id } })).toBe(3);
  });
});
