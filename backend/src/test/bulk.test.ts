import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { FastifyInstance } from 'fastify';
import { buildApp, cleanDb } from './helpers.js';
import { prisma } from '../db/client.js';
import { StorageNotFoundError } from '../storage/provider.js';

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    upload: vi.fn().mockResolvedValue(undefined),
    streamUpload: vi.fn().mockResolvedValue(undefined),
    download: vi.fn().mockResolvedValue({
      stream: Buffer.from('file-content'),
      contentType: 'text/plain',
      contentLength: 12,
    }),
    delete: vi.fn().mockResolvedValue(undefined),
    copy: vi.fn().mockResolvedValue(undefined),
    move: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../storage/index.js', () => ({
  getStorageProvider: vi.fn().mockResolvedValue(mockStorage),
  invalidateStorageCache: vi.fn(),
}));

let app: FastifyInstance;
let adminToken: string;
let adminId: string;
let userToken: string;
let userId: string;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  vi.clearAllMocks();
  // AuditLog references User/Asset (onDelete: SetNull) — delete it first to avoid stale rows
  await prisma.auditLog.deleteMany();
  await cleanDb();

  // First registration becomes admin
  const adminRes = await request(app.server)
    .post('/api/auth/register')
    .send({ email: 'admin@example.com', password: 'password123' });
  adminToken = adminRes.body.token;
  adminId = adminRes.body.user.id;

  // Second registration is a regular user
  const userRes = await request(app.server)
    .post('/api/auth/register')
    .send({ email: 'user@example.com', password: 'password123' });
  userToken = userRes.body.token;
  userId = userRes.body.user.id;
});

function binaryParser(
  res: { on: (event: string, cb: (chunk: Buffer) => void) => void },
  callback: (err: Error | null, body: Buffer) => void,
) {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

async function createAsset(ownerId: string | null, name = 'test.txt') {
  return prisma.asset.create({
    data: {
      originalName: name,
      storageKey: `assets/bulk-test/${name}`,
      assetType: 'other',
      uploadedBy: ownerId,
    },
  });
}

// ─── POST /api/files/bulk-delete ────────────────────────────────────────────

describe('POST /api/files/bulk-delete', () => {
  it('soft-deletes multiple owned assets (moved to trash), keeping the DB records', async () => {
    const a1 = await createAsset(userId, 'file1.txt');
    const a2 = await createAsset(userId, 'file2.txt');

    const res = await request(app.server)
      .post('/api/files/bulk-delete')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ids: [a1.id, a2.id] });

    expect(res.status).toBe(200);
    expect(res.body.deleted).toEqual(expect.arrayContaining([a1.id, a2.id]));
    expect(res.body.errors).toHaveLength(0);

    // Bulk delete is a soft-delete: records stay, marked deleted, keyed into trash/
    const remaining = await prisma.asset.findMany({ where: { id: { in: [a1.id, a2.id] } } });
    expect(remaining).toHaveLength(2);
    for (const asset of remaining) {
      expect(asset.deletedAt).not.toBeNull();
      expect(asset.deletedBy).toBe(userId);
      expect(asset.storageKey).toBe(`trash/${asset.id}/${asset.originalName}`);
    }

    // Trashed assets show up in the trash listing
    const trashRes = await request(app.server)
      .get('/api/trash')
      .set('Authorization', `Bearer ${userToken}`);
    expect(trashRes.status).toBe(200);
    const trashIds = trashRes.body.map((a: { id: string }) => a.id);
    expect(trashIds).toEqual(expect.arrayContaining([a1.id, a2.id]));
  });

  it('moves each storage object to trash/ and never calls storage.delete', async () => {
    const a1 = await createAsset(userId, 's3_a.txt');
    const a2 = await createAsset(userId, 's3_b.txt');

    await request(app.server)
      .post('/api/files/bulk-delete')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ids: [a1.id, a2.id] });

    expect(mockStorage.move).toHaveBeenCalledWith(a1.storageKey, `trash/${a1.id}/s3_a.txt`);
    expect(mockStorage.move).toHaveBeenCalledWith(a2.storageKey, `trash/${a2.id}/s3_b.txt`);
    expect(mockStorage.delete).not.toHaveBeenCalled();
  });

  it('still soft-deletes when the storage object is already missing (StorageNotFoundError)', async () => {
    const asset = await createAsset(userId, 'ghost.txt');
    mockStorage.move.mockRejectedValueOnce(new StorageNotFoundError('source missing'));

    const res = await request(app.server)
      .post('/api/files/bulk-delete')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ids: [asset.id] });

    expect(res.status).toBe(200);
    expect(res.body.deleted).toContain(asset.id);
    expect(res.body.errors).toHaveLength(0);

    const check = await prisma.asset.findUnique({ where: { id: asset.id } });
    expect(check?.deletedAt).not.toBeNull();
    expect(check?.storageKey).toBe(`trash/${asset.id}/ghost.txt`);
  });

  it('reports a per-asset Storage error and leaves the DB row untouched on non-NotFound move failure', async () => {
    const asset = await createAsset(userId, 'stuck.txt');
    mockStorage.move.mockRejectedValueOnce(new Error('s3 exploded'));

    const res = await request(app.server)
      .post('/api/files/bulk-delete')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ids: [asset.id] });

    expect(res.status).toBe(200);
    expect(res.body.deleted).toHaveLength(0);
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0].id).toBe(asset.id);
    expect(res.body.errors[0].reason).toBe('Storage error');

    // Asset untouched: not trashed, storage key unchanged
    const check = await prisma.asset.findUnique({ where: { id: asset.id } });
    expect(check?.deletedAt).toBeNull();
    expect(check?.storageKey).toBe(asset.storageKey);
  });

  it('reports Not found for an already-trashed asset in the batch', async () => {
    const trashed = await prisma.asset.create({
      data: {
        originalName: 'already-gone.txt',
        storageKey: 'trash/x/already-gone.txt',
        assetType: 'other',
        uploadedBy: userId,
        deletedAt: new Date(),
        deletedBy: userId,
      },
    });

    const res = await request(app.server)
      .post('/api/files/bulk-delete')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ids: [trashed.id] });

    expect(res.status).toBe(200);
    expect(res.body.deleted).toHaveLength(0);
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0].id).toBe(trashed.id);
    expect(res.body.errors[0].reason).toBe('Not found');
  });

  it('bulk-trashed assets are restorable via POST /api/files/:id/restore', async () => {
    const asset = await createAsset(userId, 'comeback.txt');

    await request(app.server)
      .post('/api/files/bulk-delete')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ids: [asset.id] });

    const restoreRes = await request(app.server)
      .post(`/api/files/${asset.id}/restore`)
      .set('Authorization', `Bearer ${userToken}`);

    expect(restoreRes.status).toBe(200);
    const check = await prisma.asset.findUnique({ where: { id: asset.id } });
    expect(check?.deletedAt).toBeNull();
    expect(check?.storageKey).toBe(`assets/${asset.id}/comeback.txt`);
  });

  it('returns 200 with Unauthorized error when user tries to delete an asset they do not own', async () => {
    // NOTE: Implementation uses per-asset error model (not a global 403).
    // Spec said "expect 403" but the implementation returns 200 with errors[].reason = 'Unauthorized'.
    const asset = await createAsset(adminId, 'admin_file.txt');

    const res = await request(app.server)
      .post('/api/files/bulk-delete')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ids: [asset.id] });

    expect(res.status).toBe(200);
    expect(res.body.deleted).toHaveLength(0);
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0].id).toBe(asset.id);
    expect(res.body.errors[0].reason).toBe('Unauthorized');

    // Asset must still exist — it was not deleted
    const check = await prisma.asset.findUnique({ where: { id: asset.id } });
    expect(check).not.toBeNull();
  });

  it('admin successfully deletes assets owned by another user', async () => {
    const asset = await createAsset(userId, 'user_owned.txt');

    const res = await request(app.server)
      .post('/api/files/bulk-delete')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ids: [asset.id] });

    expect(res.status).toBe(200);
    expect(res.body.deleted).toContain(asset.id);
    expect(res.body.errors).toHaveLength(0);
  });

  it('partial ownership mix — owned assets soft-deleted, unowned go to errors', async () => {
    // Per-asset model: owned asset is trashed successfully; unowned asset gets Unauthorized error.
    const ownedAsset = await createAsset(userId, 'mine.txt');
    const otherAsset = await createAsset(adminId, 'theirs.txt');

    const res = await request(app.server)
      .post('/api/files/bulk-delete')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ids: [ownedAsset.id, otherAsset.id] });

    expect(res.status).toBe(200);
    expect(res.body.deleted).toContain(ownedAsset.id);
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0].id).toBe(otherAsset.id);
    expect(res.body.errors[0].reason).toBe('Unauthorized');

    // Owned asset should be in the trash; unowned asset must be untouched
    const deleted = await prisma.asset.findUnique({ where: { id: ownedAsset.id } });
    expect(deleted?.deletedAt).not.toBeNull();
    expect(deleted?.storageKey).toBe(`trash/${ownedAsset.id}/mine.txt`);
    const kept = await prisma.asset.findUnique({ where: { id: otherAsset.id } });
    expect(kept?.deletedAt).toBeNull();
    expect(kept?.storageKey).toBe(otherAsset.storageKey);
  });

  it('writes one DELETE audit log entry per deleted asset', async () => {
    const a1 = await createAsset(userId, 'audit1.txt');
    const a2 = await createAsset(userId, 'audit2.txt');

    await request(app.server)
      .post('/api/files/bulk-delete')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ids: [a1.id, a2.id] });

    // logAudit is fire-and-forget — poll until both entries land in DB
    await vi.waitFor(
      async () => {
        const logs = await prisma.auditLog.findMany({ where: { action: 'DELETE' } });
        expect(logs).toHaveLength(2);
      },
      { timeout: 3000 },
    );

    const logs = await prisma.auditLog.findMany({ where: { action: 'DELETE' } });
    const deletedIds = logs.map((l) => (l.details as Record<string, unknown>).deletedAssetId);
    expect(deletedIds).toContain(a1.id);
    expect(deletedIds).toContain(a2.id);
  });

  it('response body has { deleted, errors } shape with not-found IDs in errors', async () => {
    const asset = await createAsset(userId, 'exists.txt');
    // Use a proper v4 UUID (version=4, variant=8) so Zod v4 uuid() validation passes
    const missingId = 'aaaabbbb-cccc-4ddd-8eee-ffff00001111';

    const res = await request(app.server)
      .post('/api/files/bulk-delete')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ids: [asset.id, missingId] });

    expect(res.status).toBe(200);
    expect(res.body.deleted).toContain(asset.id);
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0].id).toBe(missingId);
    expect(res.body.errors[0].reason).toMatch(/not found/i);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app.server)
      .post('/api/files/bulk-delete')
      .send({ ids: ['00000000-0000-0000-0000-000000000000'] });

    expect(res.status).toBe(401);
  });
});

// ─── POST /api/files/bulk-download ──────────────────────────────────────────

describe('POST /api/files/bulk-download', () => {
  it('returns 200 with application/zip content-type for owned assets', async () => {
    const a1 = await createAsset(userId, 'dl_a.txt');
    const a2 = await createAsset(userId, 'dl_b.txt');

    const res = await request(app.server)
      .post('/api/files/bulk-download')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ids: [a1.id, a2.id] });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/zip/);
  });

  it('sets Content-Disposition: attachment; filename=assets.zip', async () => {
    const asset = await createAsset(userId, 'single.txt');

    const res = await request(app.server)
      .post('/api/files/bulk-download')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ids: [asset.id] });

    expect(res.headers['content-disposition']).toBe('attachment; filename=assets.zip');
  });

  it('response body is a valid ZIP file (PK magic bytes at offset 0)', async () => {
    const asset = await createAsset(userId, 'magic.txt');

    const res = await request(app.server)
      .post('/api/files/bulk-download')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ids: [asset.id] })
      .buffer(true)
      .parse(binaryParser);

    const body = res.body as unknown as Buffer;
    // ZIP local file header signature: PK\x03\x04
    expect(body[0]).toBe(0x50); // P
    expect(body[1]).toBe(0x4b); // K
    expect(body[2]).toBe(0x03);
    expect(body[3]).toBe(0x04);
  });

  it('ZIP archive contains the asset filename in the local file header', async () => {
    const asset = await createAsset(userId, 'my_asset.txt');

    const res = await request(app.server)
      .post('/api/files/bulk-download')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ids: [asset.id] })
      .buffer(true)
      .parse(binaryParser);

    const body = res.body as unknown as Buffer;
    // ZIP local file header: filename length is at bytes 26-27 (LE uint16)
    const filenameLen = body.readUInt16LE(26);
    const filename = body.subarray(30, 30 + filenameLen).toString('utf8');
    expect(filename).toBe('my_asset.txt');
  });

  it('returns 403 when user attempts to download an asset they do not own', async () => {
    const asset = await createAsset(adminId, 'admin_doc.txt');

    const res = await request(app.server)
      .post('/api/files/bulk-download')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ids: [asset.id] });

    expect(res.status).toBe(403);
  });

  it('admin can download assets owned by another user', async () => {
    const asset = await createAsset(userId, 'user_asset.txt');

    const res = await request(app.server)
      .post('/api/files/bulk-download')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ids: [asset.id] });

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename=assets.zip');
  });

  it('returns 401 without a token', async () => {
    const res = await request(app.server)
      .post('/api/files/bulk-download')
      .send({ ids: ['00000000-0000-0000-0000-000000000000'] });

    expect(res.status).toBe(401);
  });

  it('destroys the socket instead of hanging when storage download fails (MAS-602)', async () => {
    const asset = await createAsset(userId, 'boom.txt');
    mockStorage.download.mockRejectedValueOnce(new Error('storage exploded'));

    // The handler has already hijacked the reply when the failure occurs, so no
    // HTTP response can be sent — the connection must be destroyed so the client
    // errors out immediately rather than waiting forever.
    await expect(
      request(app.server)
        .post('/api/files/bulk-download')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ ids: [asset.id] }),
    ).rejects.toThrow();
  });
});

// ─── POST /api/files/bulk-update ────────────────────────────────────────────

describe('POST /api/files/bulk-update', () => {
  async function createCategory(name: string) {
    return prisma.category.create({ data: { name, slug: name.toLowerCase().replace(/\s+/g, '-') } });
  }
  async function createSubcategory(categoryId: string, name: string) {
    return prisma.subcategory.create({ data: { categoryId, name, slug: name.toLowerCase().replace(/\s+/g, '-') } });
  }
  async function tagNamesOf(assetId: string) {
    const rows = await prisma.assetTag.findMany({ where: { assetId }, include: { tag: true } });
    return rows.map((r) => r.tag.name).sort();
  }

  it('sets category and subcategory on multiple owned assets', async () => {
    const a1 = await createAsset(userId, 'bu1.txt');
    const a2 = await createAsset(userId, 'bu2.txt');
    const cat = await createCategory('Bulk Cat');
    const sub = await createSubcategory(cat.id, 'Bulk Sub');

    const res = await request(app.server)
      .post('/api/files/bulk-update')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ids: [a1.id, a2.id], categoryId: cat.id, subcategoryId: sub.id });

    expect(res.status).toBe(200);
    expect(res.body.updated).toEqual(expect.arrayContaining([a1.id, a2.id]));
    expect(res.body.errors).toHaveLength(0);

    const rows = await prisma.asset.findMany({ where: { id: { in: [a1.id, a2.id] } } });
    for (const row of rows) {
      expect(row.categoryId).toBe(cat.id);
      expect(row.subcategoryId).toBe(sub.id);
    }
  });

  it('clears category AND subcategory with categoryId: null', async () => {
    const cat = await createCategory('Clear Cat');
    const sub = await createSubcategory(cat.id, 'Clear Sub');
    const asset = await prisma.asset.create({
      data: {
        originalName: 'clear.txt', storageKey: 'assets/bulk-test/clear.txt', assetType: 'other',
        uploadedBy: userId, categoryId: cat.id, subcategoryId: sub.id,
      },
    });

    const res = await request(app.server)
      .post('/api/files/bulk-update')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ids: [asset.id], categoryId: null });

    expect(res.status).toBe(200);
    const row = await prisma.asset.findUnique({ where: { id: asset.id } });
    expect(row?.categoryId).toBeNull();
    expect(row?.subcategoryId).toBeNull();
  });

  it('nulls subcategory when category changes without a new subcategory', async () => {
    const oldCat = await createCategory('Old Cat');
    const oldSub = await createSubcategory(oldCat.id, 'Old Sub');
    const newCat = await createCategory('New Cat');
    const asset = await prisma.asset.create({
      data: {
        originalName: 'recat.txt', storageKey: 'assets/bulk-test/recat.txt', assetType: 'other',
        uploadedBy: userId, categoryId: oldCat.id, subcategoryId: oldSub.id,
      },
    });

    const res = await request(app.server)
      .post('/api/files/bulk-update')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ids: [asset.id], categoryId: newCat.id });

    expect(res.status).toBe(200);
    const row = await prisma.asset.findUnique({ where: { id: asset.id } });
    expect(row?.categoryId).toBe(newCat.id);
    expect(row?.subcategoryId).toBeNull();
  });

  it('rejects a subcategory that does not belong to the given category', async () => {
    const catA = await createCategory('Cat A');
    const catB = await createCategory('Cat B');
    const subB = await createSubcategory(catB.id, 'Sub of B');
    const asset = await createAsset(userId, 'mismatch.txt');

    const res = await request(app.server)
      .post('/api/files/bulk-update')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ids: [asset.id], categoryId: catA.id, subcategoryId: subB.id });

    expect(res.status).toBe(400);
    const row = await prisma.asset.findUnique({ where: { id: asset.id } });
    expect(row?.categoryId).toBeNull();
  });

  it('rejects subcategoryId without categoryId', async () => {
    const cat = await createCategory('Lone Cat');
    const sub = await createSubcategory(cat.id, 'Lone Sub');
    const asset = await createAsset(userId, 'lone.txt');

    const res = await request(app.server)
      .post('/api/files/bulk-update')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ids: [asset.id], subcategoryId: sub.id });

    expect(res.status).toBe(400);
  });

  it('rejects an unknown categoryId with 400', async () => {
    const asset = await createAsset(userId, 'badcat.txt');

    const res = await request(app.server)
      .post('/api/files/bulk-update')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ids: [asset.id], categoryId: '00000000-0000-0000-0000-000000000000' });

    expect(res.status).toBe(400);
  });

  it('adds and removes tags as deltas, preserving unrelated tags', async () => {
    const a1 = await createAsset(userId, 'tag1.txt');
    const a2 = await createAsset(userId, 'tag2.txt');
    // a1 starts with tags [keep, drop]; a2 starts with [drop]
    const keep = await prisma.tag.create({ data: { name: 'keep' } });
    const drop = await prisma.tag.create({ data: { name: 'drop' } });
    await prisma.assetTag.createMany({ data: [
      { assetId: a1.id, tagId: keep.id },
      { assetId: a1.id, tagId: drop.id },
      { assetId: a2.id, tagId: drop.id },
    ]});

    const res = await request(app.server)
      .post('/api/files/bulk-update')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ids: [a1.id, a2.id], addTags: ['Added '], removeTags: ['drop'] });

    expect(res.status).toBe(200);
    expect(res.body.updated).toEqual(expect.arrayContaining([a1.id, a2.id]));

    // Names are normalized (trimmed + lowercased); 'keep' survives on a1
    expect(await tagNamesOf(a1.id)).toEqual(['added', 'keep']);
    expect(await tagNamesOf(a2.id)).toEqual(['added']);
  });

  it('is idempotent for addTags already present (skipDuplicates)', async () => {
    const asset = await createAsset(userId, 'idem.txt');
    const existing = await prisma.tag.create({ data: { name: 'already' } });
    await prisma.assetTag.create({ data: { assetId: asset.id, tagId: existing.id } });

    const res = await request(app.server)
      .post('/api/files/bulk-update')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ids: [asset.id], addTags: ['already'] });

    expect(res.status).toBe(200);
    expect(await tagNamesOf(asset.id)).toEqual(['already']);
  });

  it('reports per-id errors: trashed → Not found, foreign-owned → Unauthorized, rest updated', async () => {
    const mine = await createAsset(userId, 'mine.txt');
    const theirs = await createAsset(adminId, 'theirs.txt');
    const trashed = await prisma.asset.create({
      data: {
        originalName: 'trashed.txt', storageKey: 'trash/x/trashed.txt', assetType: 'other',
        uploadedBy: userId, deletedAt: new Date(), deletedBy: userId,
      },
    });
    const ghost = '00000000-0000-0000-0000-000000000000';
    const cat = await createCategory('Partial Cat');

    const res = await request(app.server)
      .post('/api/files/bulk-update')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ids: [mine.id, theirs.id, trashed.id, ghost], categoryId: cat.id });

    expect(res.status).toBe(200);
    expect(res.body.updated).toEqual([mine.id]);
    expect(res.body.errors).toEqual(expect.arrayContaining([
      { id: theirs.id, reason: 'Unauthorized' },
      { id: trashed.id, reason: 'Not found' },
      { id: ghost, reason: 'Not found' },
    ]));

    // Trashed + foreign assets untouched
    const trashedRow = await prisma.asset.findUnique({ where: { id: trashed.id } });
    expect(trashedRow?.categoryId).toBeNull();
    const theirsRow = await prisma.asset.findUnique({ where: { id: theirs.id } });
    expect(theirsRow?.categoryId).toBeNull();
    const mineRow = await prisma.asset.findUnique({ where: { id: mine.id } });
    expect(mineRow?.categoryId).toBe(cat.id);
  });

  it('lets an admin bulk-update assets they do not own', async () => {
    const asset = await createAsset(userId, 'admin-target.txt');
    const cat = await createCategory('Admin Cat');

    const res = await request(app.server)
      .post('/api/files/bulk-update')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ids: [asset.id], categoryId: cat.id });

    expect(res.status).toBe(200);
    expect(res.body.updated).toEqual([asset.id]);
  });

  it('rejects a body with no operation (only ids) with 400', async () => {
    const asset = await createAsset(userId, 'noop.txt');

    const res = await request(app.server)
      .post('/api/files/bulk-update')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ids: [asset.id] });

    expect(res.status).toBe(400);
  });

  it('rejects unknown body properties (additionalProperties: false)', async () => {
    const asset = await createAsset(userId, 'extra.txt');

    const res = await request(app.server)
      .post('/api/files/bulk-update')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ids: [asset.id], addTags: ['x'], nope: true });

    expect(res.status).toBe(400);
  });

  it('writes an UPDATE_METADATA audit row per updated asset', async () => {
    const a1 = await createAsset(userId, 'audit1.txt');
    const a2 = await createAsset(userId, 'audit2.txt');

    const res = await request(app.server)
      .post('/api/files/bulk-update')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ids: [a1.id, a2.id], addTags: ['audited'] });

    expect(res.status).toBe(200);

    // logAudit is fire-and-forget; give it a tick to land
    await new Promise((r) => setTimeout(r, 50));
    const logs = await prisma.auditLog.findMany({ where: { action: 'UPDATE_METADATA' } });
    expect(logs.map((l) => l.assetId).sort()).toEqual([a1.id, a2.id].sort());
  });

  it('returns 401 without auth', async () => {
    const res = await request(app.server)
      .post('/api/files/bulk-update')
      .send({ ids: ['00000000-0000-0000-0000-000000000000'], addTags: ['x'] });

    expect(res.status).toBe(401);
  });
});
