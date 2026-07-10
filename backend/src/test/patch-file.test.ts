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

async function createAsset(ownerId: string | null, name = 'test.txt') {
  return prisma.asset.create({
    data: {
      originalName: name,
      storageKey: `assets/patch-test/${name}`,
      assetType: 'other',
      uploadedBy: ownerId,
    },
  });
}

// ─── PATCH /api/files/:id ─────────────────────────────────────────────────────

describe('PATCH /api/files/:id', () => {
  it('returns 200 with updated asset on valid name change', async () => {
    const asset = await createAsset(userId);

    const res = await request(app.server)
      .patch(`/api/files/${asset.id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 'renamed.txt' });

    expect(res.status).toBe(200);
    expect(res.body.original_name).toBe('renamed.txt');
    expect(res.body.id).toBe(asset.id);
    expect(Array.isArray(res.body.tags)).toBe(true);
  });

  it('returns 200 with updated description', async () => {
    const asset = await createAsset(userId);

    const res = await request(app.server)
      .patch(`/api/files/${asset.id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ description: 'A new description' });

    expect(res.status).toBe(200);
    expect(res.body.description).toBe('A new description');
  });

  it('replaces tags (not append) when tags are provided', async () => {
    const asset = await createAsset(userId);
    const existingTag = await prisma.tag.create({ data: { name: 'old-tag' } });
    await prisma.assetTag.create({ data: { assetId: asset.id, tagId: existingTag.id } });

    const res = await request(app.server)
      .patch(`/api/files/${asset.id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ tags: ['new-tag'] });

    expect(res.status).toBe(200);
    expect(res.body.tags).toHaveLength(1);
    expect(res.body.tags[0].name).toBe('new-tag');
  });

  it('clears all tags when tags is an empty array', async () => {
    const asset = await createAsset(userId);
    const tag = await prisma.tag.create({ data: { name: 'remove-me' } });
    await prisma.assetTag.create({ data: { assetId: asset.id, tagId: tag.id } });

    const res = await request(app.server)
      .patch(`/api/files/${asset.id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ tags: [] });

    expect(res.status).toBe(200);
    expect(res.body.tags).toHaveLength(0);
  });

  it('returns updated asset with tags included in the response', async () => {
    const asset = await createAsset(userId);

    const res = await request(app.server)
      .patch(`/api/files/${asset.id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ tags: ['alpha', 'beta'] });

    expect(res.status).toBe(200);
    expect(res.body.tags).toHaveLength(2);
    const tagNames = res.body.tags.map((t: { name: string }) => t.name).sort();
    expect(tagNames).toEqual(['alpha', 'beta']);
  });

  it('returns 404 when asset does not exist', async () => {
    const res = await request(app.server)
      .patch('/api/files/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 'ghost.txt' });

    expect(res.status).toBe(404);
  });

  it('returns 403 when user does not own the asset', async () => {
    const asset = await createAsset(adminId, 'admin-file.txt');

    const res = await request(app.server)
      .patch(`/api/files/${asset.id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 'hacked.txt' });

    expect(res.status).toBe(403);
  });

  it('admin can update an asset owned by another user', async () => {
    const asset = await createAsset(userId, 'user-file.txt');

    const res = await request(app.server)
      .patch(`/api/files/${asset.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'admin-renamed.txt' });

    expect(res.status).toBe(200);
    expect(res.body.original_name).toBe('admin-renamed.txt');
  });

  it('returns 400 for invalid body (name is empty string)', async () => {
    const asset = await createAsset(userId);

    const res = await request(app.server)
      .patch(`/api/files/${asset.id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: '' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when description exceeds 2000 characters', async () => {
    const asset = await createAsset(userId);

    const res = await request(app.server)
      .patch(`/api/files/${asset.id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ description: 'x'.repeat(2001) });

    expect(res.status).toBe(400);
  });

  it('returns 401 without a token', async () => {
    const asset = await createAsset(userId);

    const res = await request(app.server)
      .patch(`/api/files/${asset.id}`)
      .send({ name: 'no-auth.txt' });

    expect(res.status).toBe(401);
  });

  it('writes an UPDATE audit log entry on success', async () => {
    const asset = await createAsset(userId);

    await request(app.server)
      .patch(`/api/files/${asset.id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 'audited.txt' });

    await vi.waitFor(
      async () => {
        const logs = await prisma.auditLog.findMany({ where: { action: 'UPDATE_METADATA' } });
        expect(logs).toHaveLength(1);
      },
      { timeout: 3000 },
    );

    const logs = await prisma.auditLog.findMany({ where: { action: 'UPDATE_METADATA' } });
    expect(logs[0].assetId).toBe(asset.id);
    expect(logs[0].userId).toBe(userId);
  });
});

// ─── PUT /api/files/:id/tags (ownership security) ────────────────────────────

describe('PUT /api/files/:id/tags', () => {
  it('returns 403 when user tries to replace tags on an asset they do not own', async () => {
    const asset = await createAsset(adminId, 'admin-tagged.txt');

    const res = await request(app.server)
      .put(`/api/files/${asset.id}/tags`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ tags: ['hacked-tag'] });

    expect(res.status).toBe(403);
  });

  it('owner can replace tags on their own asset', async () => {
    const asset = await createAsset(userId, 'mine.txt');

    const res = await request(app.server)
      .put(`/api/files/${asset.id}/tags`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ tags: ['my-tag'] });

    expect(res.status).toBe(200);
    expect(res.body.tags).toHaveLength(1);
    expect(res.body.tags[0].name).toBe('my-tag');
  });

  it('admin can replace tags on any asset', async () => {
    const asset = await createAsset(userId, 'user-asset.txt');

    const res = await request(app.server)
      .put(`/api/files/${asset.id}/tags`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ tags: ['admin-set-tag'] });

    expect(res.status).toBe(200);
    expect(res.body.tags[0].name).toBe('admin-set-tag');
  });

  it('returns 401 without a token', async () => {
    const asset = await createAsset(userId, 'notags.txt');

    const res = await request(app.server)
      .put(`/api/files/${asset.id}/tags`)
      .send({ tags: ['no-auth'] });

    expect(res.status).toBe(401);
  });
});
