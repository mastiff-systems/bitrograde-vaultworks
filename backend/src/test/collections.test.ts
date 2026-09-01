import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { FastifyInstance } from 'fastify';
import { buildApp, cleanDb } from './helpers.js';
import { prisma } from '../db/client.js';

vi.mock('../storage/s3.js', () => ({
  uploadToS3: vi.fn().mockResolvedValue(undefined),
  deleteFromS3: vi.fn().mockResolvedValue(undefined),
  getS3ObjectStream: vi.fn().mockResolvedValue({
    stream: Buffer.from(''),
    contentType: 'application/octet-stream',
    contentLength: 0,
  }),
}));

let app: FastifyInstance;
let token: string;
let userId: string;
let otherToken: string;
let adminToken: string;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  // collectionAsset -> collection -> user; clean dependents before cleanDb()
  await prisma.collectionAsset.deleteMany();
  await prisma.collection.deleteMany();
  await cleanDb();

  // First registration becomes admin
  const adminRes = await request(app.server)
    .post('/api/auth/register')
    .send({ email: 'admin@example.com', password: 'password123' });
  adminToken = adminRes.body.token;

  const userRes = await request(app.server)
    .post('/api/auth/register')
    .send({ email: 'user@example.com', password: 'password123' });
  token = userRes.body.token;
  userId = userRes.body.user.id;

  const otherRes = await request(app.server)
    .post('/api/auth/register')
    .send({ email: 'other@example.com', password: 'password123' });
  otherToken = otherRes.body.token;
});

async function createAsset(uploadedBy: string | null = null, name = 'test.txt') {
  return prisma.asset.create({
    data: {
      originalName: name,
      storageKey: `assets/coll-test/${name}`,
      assetType: 'other',
      uploadedBy,
    },
  });
}

// ─── POST /api/collections ───────────────────────────────────────────────────

describe('POST /api/collections', () => {
  it('creates a collection and returns 201', async () => {
    const res = await request(app.server)
      .post('/api/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'My Collection', description: 'Test desc' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.name).toBe('My Collection');
    expect(res.body.description).toBe('Test desc');
    expect(res.body.asset_count).toBe(0);
    expect(res.body.preview_asset).toBeNull();
  });

  it('creates a collection without description', async () => {
    const res = await request(app.server)
      .post('/api/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'No Description' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('No Description');
  });

  it('returns 400 for missing name', async () => {
    const res = await request(app.server)
      .post('/api/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ description: 'no name' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for empty name', async () => {
    const res = await request(app.server)
      .post('/api/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '' });

    expect(res.status).toBe(400);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app.server)
      .post('/api/collections')
      .send({ name: 'Unauthorized' });

    expect(res.status).toBe(401);
  });
});

// ─── GET /api/collections ────────────────────────────────────────────────────

describe('GET /api/collections', () => {
  it('returns empty array when user has no collections', async () => {
    const res = await request(app.server)
      .get('/api/collections')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns all collections regardless of creator (shared read)', async () => {
    await request(app.server)
      .post('/api/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'My Coll' });

    await request(app.server)
      .post('/api/collections')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ name: 'Other Coll' });

    const res = await request(app.server)
      .get('/api/collections')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const names = res.body.map((c: { name: string }) => c.name).sort();
    expect(names).toEqual(['My Coll', 'Other Coll']);
  });

  it('exposes created_by so clients can distinguish ownership', async () => {
    await request(app.server)
      .post('/api/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Owned Coll' });

    const res = await request(app.server)
      .get('/api/collections')
      .set('Authorization', `Bearer ${otherToken}`);

    expect(res.status).toBe(200);
    expect(res.body[0].created_by).toBe(userId);
  });

  it('includes asset_count and preview_asset when assets are present', async () => {
    const asset = await createAsset(userId, 'preview.png');

    const createRes = await request(app.server)
      .post('/api/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'With Asset' });
    const collId = createRes.body.id;

    await request(app.server)
      .post(`/api/collections/${collId}/assets`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assetIds: [asset.id] });

    const res = await request(app.server)
      .get('/api/collections')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body[0].asset_count).toBe(1);
    expect(res.body[0].preview_asset).not.toBeNull();
    expect(res.body[0].preview_asset.id).toBe(asset.id);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app.server).get('/api/collections');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/collections/:id ─────────────────────────────────────────────────

describe('GET /api/collections/:id', () => {
  it('returns collection with its assets', async () => {
    const asset = await createAsset(userId, 'file.png');

    const createRes = await request(app.server)
      .post('/api/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Detail Coll' });
    const collId = createRes.body.id;

    await request(app.server)
      .post(`/api/collections/${collId}/assets`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assetIds: [asset.id] });

    const res = await request(app.server)
      .get(`/api/collections/${collId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(collId);
    expect(res.body.assets).toHaveLength(1);
    expect(res.body.assets[0].id).toBe(asset.id);
    expect(res.body.asset_count).toBe(1);
  });

  it('paginates assets with limit and offset', async () => {
    const createRes = await request(app.server)
      .post('/api/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Paginated Coll' });
    const collId = createRes.body.id;

    const a1 = await createAsset(userId, 'pag1.png');
    const a2 = await createAsset(userId, 'pag2.png');
    const a3 = await createAsset(userId, 'pag3.png');

    await request(app.server)
      .post(`/api/collections/${collId}/assets`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assetIds: [a1.id, a2.id, a3.id] });

    const res = await request(app.server)
      .get(`/api/collections/${collId}?limit=2&offset=1`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.assets).toHaveLength(2);
    expect(res.body.asset_count).toBe(3);
    expect(res.body.limit).toBe(2);
    expect(res.body.offset).toBe(1);
  });

  it('returns 404 for unknown collection', async () => {
    const res = await request(app.server)
      .get('/api/collections/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('allows reading another user\'s collection (shared read)', async () => {
    const createRes = await request(app.server)
      .post('/api/collections')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ name: 'Other User Coll' });
    const collId = createRes.body.id;

    const res = await request(app.server)
      .get(`/api/collections/${collId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Other User Coll');
  });

  it('returns 401 without auth', async () => {
    const res = await request(app.server)
      .get('/api/collections/00000000-0000-0000-0000-000000000000');

    expect(res.status).toBe(401);
  });
});

// ─── PATCH /api/collections/:id ──────────────────────────────────────────────

describe('PATCH /api/collections/:id', () => {
  it('updates collection name', async () => {
    const createRes = await request(app.server)
      .post('/api/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Original Name' });
    const collId = createRes.body.id;

    const res = await request(app.server)
      .patch(`/api/collections/${collId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Updated Name' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Name');
  });

  it('updates collection description', async () => {
    const createRes = await request(app.server)
      .post('/api/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'My Coll', description: 'Old desc' });
    const collId = createRes.body.id;

    const res = await request(app.server)
      .patch(`/api/collections/${collId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ description: 'New desc' });

    expect(res.status).toBe(200);
    expect(res.body.description).toBe('New desc');
  });

  it('clears description when set to null', async () => {
    const createRes = await request(app.server)
      .post('/api/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Has Desc', description: 'Something' });
    const collId = createRes.body.id;

    const res = await request(app.server)
      .patch(`/api/collections/${collId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ description: null });

    expect(res.status).toBe(200);
    expect(res.body.description).toBeNull();
  });

  it('returns 400 for empty name', async () => {
    const createRes = await request(app.server)
      .post('/api/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Valid' });
    const collId = createRes.body.id;

    const res = await request(app.server)
      .patch(`/api/collections/${collId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '' });

    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown collection', async () => {
    const res = await request(app.server)
      .patch('/api/collections/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Ghost' });

    expect(res.status).toBe(404);
  });

  it('returns 403 when patching another user\'s collection', async () => {
    const createRes = await request(app.server)
      .post('/api/collections')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ name: 'Other Coll' });
    const collId = createRes.body.id;

    const res = await request(app.server)
      .patch(`/api/collections/${collId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Hijack' });

    expect(res.status).toBe(403);
  });

  it('allows an admin to patch another user\'s collection', async () => {
    const createRes = await request(app.server)
      .post('/api/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'User Coll' });
    const collId = createRes.body.id;

    const res = await request(app.server)
      .patch(`/api/collections/${collId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Admin Renamed' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Admin Renamed');
  });

  it('returns 401 without auth', async () => {
    const res = await request(app.server)
      .patch('/api/collections/00000000-0000-0000-0000-000000000000')
      .send({ name: 'No Auth' });

    expect(res.status).toBe(401);
  });
});

// ─── DELETE /api/collections/:id ─────────────────────────────────────────────

describe('DELETE /api/collections/:id', () => {
  it('deletes a collection and returns 204', async () => {
    const createRes = await request(app.server)
      .post('/api/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'To Delete' });
    const collId = createRes.body.id;

    const res = await request(app.server)
      .delete(`/api/collections/${collId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(204);

    const check = await prisma.collection.findUnique({ where: { id: collId } });
    expect(check).toBeNull();
  });

  it('returns 404 for unknown collection', async () => {
    const res = await request(app.server)
      .delete('/api/collections/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('returns 403 when deleting another user\'s collection', async () => {
    const createRes = await request(app.server)
      .post('/api/collections')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ name: 'Other Coll' });
    const collId = createRes.body.id;

    const res = await request(app.server)
      .delete(`/api/collections/${collId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);

    const check = await prisma.collection.findUnique({ where: { id: collId } });
    expect(check).not.toBeNull();
  });

  it('allows an admin to delete another user\'s collection', async () => {
    const createRes = await request(app.server)
      .post('/api/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Admin Deletable' });
    const collId = createRes.body.id;

    const res = await request(app.server)
      .delete(`/api/collections/${collId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(204);

    const check = await prisma.collection.findUnique({ where: { id: collId } });
    expect(check).toBeNull();
  });

  it('returns 401 without auth', async () => {
    const res = await request(app.server)
      .delete('/api/collections/00000000-0000-0000-0000-000000000000');

    expect(res.status).toBe(401);
  });
});

// ─── POST /api/collections/:id/assets ────────────────────────────────────────

describe('POST /api/collections/:id/assets (add assets)', () => {
  it('adds assets to a collection', async () => {
    const a1 = await createAsset(userId, 'asset1.png');
    const a2 = await createAsset(userId, 'asset2.png');

    const createRes = await request(app.server)
      .post('/api/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Coll with Assets' });
    const collId = createRes.body.id;

    const res = await request(app.server)
      .post(`/api/collections/${collId}/assets`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assetIds: [a1.id, a2.id] });

    expect(res.status).toBe(200);
    expect(res.body.added).toBe(2);
  });

  it('does not double-add assets already in the collection', async () => {
    const asset = await createAsset(userId, 'once.png');

    const createRes = await request(app.server)
      .post('/api/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Idempotent Coll' });
    const collId = createRes.body.id;

    await request(app.server)
      .post(`/api/collections/${collId}/assets`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assetIds: [asset.id] });

    const res = await request(app.server)
      .post(`/api/collections/${collId}/assets`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assetIds: [asset.id] });

    expect(res.status).toBe(200);
    expect(res.body.added).toBe(0);

    const entries = await prisma.collectionAsset.findMany({ where: { collectionId: collId } });
    expect(entries).toHaveLength(1);
  });

  it('returns 400 for non-existent asset IDs', async () => {
    const createRes = await request(app.server)
      .post('/api/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Invalid Assets Coll' });
    const collId = createRes.body.id;

    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await request(app.server)
      .post(`/api/collections/${collId}/assets`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assetIds: [fakeId] });

    expect(res.status).toBe(400);
    expect(res.body.invalidIds).toContain(fakeId);
  });

  it('returns 400 for empty assetIds array', async () => {
    const createRes = await request(app.server)
      .post('/api/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Empty Assets Coll' });
    const collId = createRes.body.id;

    const res = await request(app.server)
      .post(`/api/collections/${collId}/assets`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assetIds: [] });

    expect(res.status).toBe(400);
  });

  it('returns 404 when collection not found', async () => {
    const asset = await createAsset(userId, 'orphan.png');

    const res = await request(app.server)
      .post('/api/collections/00000000-0000-0000-0000-000000000000/assets')
      .set('Authorization', `Bearer ${token}`)
      .send({ assetIds: [asset.id] });

    expect(res.status).toBe(404);
  });

  it('allows adding assets to another user\'s collection (shared membership)', async () => {
    const asset = await createAsset(userId, 'my_asset.png');

    const createRes = await request(app.server)
      .post('/api/collections')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ name: 'Other Coll' });
    const collId = createRes.body.id;

    const res = await request(app.server)
      .post(`/api/collections/${collId}/assets`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assetIds: [asset.id] });

    expect(res.status).toBe(200);
    expect(res.body.added).toBe(1);
  });

  it('returns 400 when adding a trashed asset', async () => {
    const asset = await createAsset(userId, 'trashed.png');
    await prisma.asset.update({ where: { id: asset.id }, data: { deletedAt: new Date() } });

    const createRes = await request(app.server)
      .post('/api/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'No Trash Coll' });
    const collId = createRes.body.id;

    const res = await request(app.server)
      .post(`/api/collections/${collId}/assets`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assetIds: [asset.id] });

    expect(res.status).toBe(400);
    expect(res.body.invalidIds).toContain(asset.id);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app.server)
      .post('/api/collections/00000000-0000-0000-0000-000000000000/assets')
      .send({ assetIds: ['00000000-0000-0000-0000-000000000001'] });

    expect(res.status).toBe(401);
  });
});

// ─── DELETE /api/collections/:id/assets/:assetId ─────────────────────────────

describe('DELETE /api/collections/:id/assets/:assetId (remove asset)', () => {
  it('removes an asset from a collection and returns 204', async () => {
    const asset = await createAsset(userId, 'removable.png');

    const createRes = await request(app.server)
      .post('/api/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Remove Asset Coll' });
    const collId = createRes.body.id;

    await request(app.server)
      .post(`/api/collections/${collId}/assets`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assetIds: [asset.id] });

    const res = await request(app.server)
      .delete(`/api/collections/${collId}/assets/${asset.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(204);

    const link = await prisma.collectionAsset.findFirst({
      where: { collectionId: collId, assetId: asset.id },
    });
    expect(link).toBeNull();
  });

  it('returns 404 when asset is not in the collection', async () => {
    const asset = await createAsset(userId, 'not_in_coll.png');

    const createRes = await request(app.server)
      .post('/api/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Empty Coll' });
    const collId = createRes.body.id;

    const res = await request(app.server)
      .delete(`/api/collections/${collId}/assets/${asset.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('returns 404 when collection not found', async () => {
    const asset = await createAsset(userId, 'ghost_coll.png');

    const res = await request(app.server)
      .delete(`/api/collections/00000000-0000-0000-0000-000000000000/assets/${asset.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('allows removing an asset from another user\'s collection (shared membership)', async () => {
    const asset = await createAsset(null, 'other_asset.png');

    const createRes = await request(app.server)
      .post('/api/collections')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ name: 'Other Coll' });
    const collId = createRes.body.id;

    await request(app.server)
      .post(`/api/collections/${collId}/assets`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ assetIds: [asset.id] });

    const res = await request(app.server)
      .delete(`/api/collections/${collId}/assets/${asset.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(204);

    const link = await prisma.collectionAsset.findFirst({
      where: { collectionId: collId, assetId: asset.id },
    });
    expect(link).toBeNull();
  });

  it('returns 401 without auth', async () => {
    const res = await request(app.server)
      .delete(
        '/api/collections/00000000-0000-0000-0000-000000000000/assets/00000000-0000-0000-0000-000000000001',
      );

    expect(res.status).toBe(401);
  });
});

// ─── Trashed assets are hidden from collection views ─────────────────────────

describe('trashed-asset filtering', () => {
  it('excludes trashed assets from list asset_count and preview', async () => {
    const keep = await createAsset(userId, 'kept.png');
    const trash = await createAsset(userId, 'binned.png');

    const createRes = await request(app.server)
      .post('/api/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Mixed Coll' });
    const collId = createRes.body.id;

    await request(app.server)
      .post(`/api/collections/${collId}/assets`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assetIds: [trash.id, keep.id] });

    await prisma.asset.update({ where: { id: trash.id }, data: { deletedAt: new Date() } });

    const res = await request(app.server)
      .get('/api/collections')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body[0].asset_count).toBe(1);
    expect(res.body[0].preview_asset.id).toBe(keep.id);
  });

  it('excludes trashed assets from collection detail listing and count', async () => {
    const keep = await createAsset(userId, 'kept2.png');
    const trash = await createAsset(userId, 'binned2.png');

    const createRes = await request(app.server)
      .post('/api/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Detail Mixed Coll' });
    const collId = createRes.body.id;

    await request(app.server)
      .post(`/api/collections/${collId}/assets`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assetIds: [keep.id, trash.id] });

    await prisma.asset.update({ where: { id: trash.id }, data: { deletedAt: new Date() } });

    const res = await request(app.server)
      .get(`/api/collections/${collId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.asset_count).toBe(1);
    expect(res.body.assets).toHaveLength(1);
    expect(res.body.assets[0].id).toBe(keep.id);
  });

  it('restored assets reappear in collection views', async () => {
    const asset = await createAsset(userId, 'round_trip.png');

    const createRes = await request(app.server)
      .post('/api/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Round Trip Coll' });
    const collId = createRes.body.id;

    await request(app.server)
      .post(`/api/collections/${collId}/assets`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assetIds: [asset.id] });

    await prisma.asset.update({ where: { id: asset.id }, data: { deletedAt: new Date() } });
    await prisma.asset.update({ where: { id: asset.id }, data: { deletedAt: null } });

    const res = await request(app.server)
      .get(`/api/collections/${collId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.asset_count).toBe(1);
    expect(res.body.assets[0].id).toBe(asset.id);
  });
});
