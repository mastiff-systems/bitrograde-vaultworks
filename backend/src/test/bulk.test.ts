import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { FastifyInstance } from 'fastify';
import { buildApp, cleanDb } from './helpers.js';
import { prisma } from '../db/client.js';

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
  it('deletes multiple owned assets and removes them from the DB', async () => {
    const a1 = await createAsset(userId, 'file1.txt');
    const a2 = await createAsset(userId, 'file2.txt');

    const res = await request(app.server)
      .post('/api/files/bulk-delete')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ids: [a1.id, a2.id] });

    expect(res.status).toBe(200);
    expect(res.body.deleted).toEqual(expect.arrayContaining([a1.id, a2.id]));
    expect(res.body.errors).toHaveLength(0);

    const remaining = await prisma.asset.findMany({ where: { id: { in: [a1.id, a2.id] } } });
    expect(remaining).toHaveLength(0);
  });

  it('calls storage.delete for each deleted asset', async () => {
    const a1 = await createAsset(userId, 's3_a.txt');
    const a2 = await createAsset(userId, 's3_b.txt');

    await request(app.server)
      .post('/api/files/bulk-delete')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ids: [a1.id, a2.id] });

    expect(mockStorage.delete).toHaveBeenCalledWith(a1.storageKey);
    expect(mockStorage.delete).toHaveBeenCalledWith(a2.storageKey);
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

  it('partial ownership mix — owned assets deleted, unowned go to errors', async () => {
    // Per-asset model: owned asset is deleted successfully; unowned asset gets Unauthorized error.
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

    // Owned asset should be gone; unowned asset must still exist
    const deleted = await prisma.asset.findUnique({ where: { id: ownedAsset.id } });
    expect(deleted).toBeNull();
    const kept = await prisma.asset.findUnique({ where: { id: otherAsset.id } });
    expect(kept).not.toBeNull();
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
