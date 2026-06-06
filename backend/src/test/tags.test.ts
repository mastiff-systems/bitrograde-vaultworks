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
let adminToken: string;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await cleanDb();
  // First registered user is admin
  const adminRes = await request(app.server)
    .post('/api/auth/register')
    .send({ email: 'admin@example.com', password: 'password123' });
  adminToken = adminRes.body.token;

  const userRes = await request(app.server)
    .post('/api/auth/register')
    .send({ email: 'user@example.com', password: 'password123' });
  token = userRes.body.token;
});

// --- GET /api/tags ---

describe('GET /api/tags', () => {
  it('returns empty array when no tags exist', async () => {
    const res = await request(app.server).get('/api/tags').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns tags sorted by name with asset counts', async () => {
    const asset = await prisma.asset.create({
      data: { originalName: 'hero.png', storageKey: 'assets/1/hero.png', assetType: 'texture' },
    });
    const tag = await prisma.tag.create({ data: { name: 'background' } });
    await prisma.tag.create({ data: { name: 'animated' } });
    await prisma.assetTag.create({ data: { assetId: asset.id, tagId: tag.id } });

    const res = await request(app.server).get('/api/tags').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].name).toBe('animated');
    expect(res.body[0].asset_count).toBe(0);
    expect(res.body[1].name).toBe('background');
    expect(res.body[1].asset_count).toBe(1);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app.server).get('/api/tags');
    expect(res.status).toBe(401);
  });
});

// --- POST /api/tags ---

describe('POST /api/tags', () => {
  it('creates a tag and normalizes name to lowercase', async () => {
    const res = await request(app.server)
      .post('/api/tags')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Sprite' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('sprite');
    expect(res.body.asset_count).toBe(0);
    expect(res.body.id).toBeTruthy();
  });

  it('returns 409 for duplicate tag name', async () => {
    await prisma.tag.create({ data: { name: 'sprite' } });

    const res = await request(app.server)
      .post('/api/tags')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'sprite' });

    expect(res.status).toBe(409);
  });

  it('returns 400 for missing name', async () => {
    const res = await request(app.server)
      .post('/api/tags')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app.server).post('/api/tags').send({ name: 'sprite' });
    expect(res.status).toBe(401);
  });
});

// --- DELETE /api/tags/:id ---

describe('DELETE /api/tags/:id', () => {
  it('deletes a tag as admin', async () => {
    const tag = await prisma.tag.create({ data: { name: 'obsolete' } });

    const res = await request(app.server)
      .delete(`/api/tags/${tag.id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(204);
    const check = await prisma.tag.findUnique({ where: { id: tag.id } });
    expect(check).toBeNull();
  });

  it('returns 403 for non-admin user', async () => {
    const tag = await prisma.tag.create({ data: { name: 'protected' } });

    const res = await request(app.server)
      .delete(`/api/tags/${tag.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('returns 404 for unknown tag id', async () => {
    const res = await request(app.server)
      .delete('/api/tags/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });

  it('cascades deletion — removes asset associations', async () => {
    const asset = await prisma.asset.create({
      data: { originalName: 'hero.png', storageKey: 'assets/1/hero.png', assetType: 'texture' },
    });
    const tag = await prisma.tag.create({ data: { name: 'cascade-test' } });
    await prisma.assetTag.create({ data: { assetId: asset.id, tagId: tag.id } });

    await request(app.server)
      .delete(`/api/tags/${tag.id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    const links = await prisma.assetTag.findMany({ where: { tagId: tag.id } });
    expect(links).toHaveLength(0);
  });
});

// --- PUT /api/files/:id/tags ---

describe('PUT /api/files/:id/tags', () => {
  it('sets tags on an asset and auto-creates new tags', async () => {
    const asset = await prisma.asset.create({
      data: { originalName: 'hero.png', storageKey: 'assets/1/hero.png', assetType: 'texture' },
    });

    const res = await request(app.server)
      .put(`/api/files/${asset.id}/tags`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tags: ['sprite', 'hero', 'ui'] });

    expect(res.status).toBe(200);
    expect(res.body.tags).toHaveLength(3);
    const names = res.body.tags.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(['hero', 'sprite', 'ui']);

    const tagCount = await prisma.tag.count();
    expect(tagCount).toBe(3);
  });

  it('replaces existing tags on second call', async () => {
    const asset = await prisma.asset.create({
      data: { originalName: 'bg.png', storageKey: 'assets/2/bg.png', assetType: 'texture' },
    });

    await request(app.server)
      .put(`/api/files/${asset.id}/tags`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tags: ['old1', 'old2'] });

    const res = await request(app.server)
      .put(`/api/files/${asset.id}/tags`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tags: ['new1'] });

    expect(res.status).toBe(200);
    expect(res.body.tags).toHaveLength(1);
    expect(res.body.tags[0].name).toBe('new1');
  });

  it('clears tags when passed empty array', async () => {
    const asset = await prisma.asset.create({
      data: { originalName: 'icon.png', storageKey: 'assets/3/icon.png', assetType: 'texture' },
    });
    await request(app.server)
      .put(`/api/files/${asset.id}/tags`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tags: ['tagged'] });

    const res = await request(app.server)
      .put(`/api/files/${asset.id}/tags`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tags: [] });

    expect(res.status).toBe(200);
    expect(res.body.tags).toHaveLength(0);
  });

  it('normalizes tag names to lowercase', async () => {
    const asset = await prisma.asset.create({
      data: { originalName: 'test.png', storageKey: 'assets/4/test.png', assetType: 'texture' },
    });

    const res = await request(app.server)
      .put(`/api/files/${asset.id}/tags`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tags: ['UPPERCASE', 'MixedCase'] });

    expect(res.status).toBe(200);
    const names = res.body.tags.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(['mixedcase', 'uppercase']);
  });

  it('returns 404 for unknown asset', async () => {
    const res = await request(app.server)
      .put('/api/files/00000000-0000-0000-0000-000000000000/tags')
      .set('Authorization', `Bearer ${token}`)
      .send({ tags: ['sprite'] });

    expect(res.status).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const asset = await prisma.asset.create({
      data: { originalName: 'x.png', storageKey: 'assets/5/x.png', assetType: 'texture' },
    });
    const res = await request(app.server)
      .put(`/api/files/${asset.id}/tags`)
      .send({ tags: ['sprite'] });

    expect(res.status).toBe(401);
  });
});

// --- GET /api/files with filters ---

describe('GET /api/files filtering', () => {
  beforeEach(async () => {
    const assets = await prisma.asset.createMany({
      data: [
        { originalName: 'hero.png', storageKey: 'assets/a/hero.png', assetType: 'texture', mimeType: 'image/png' },
        { originalName: 'enemy.png', storageKey: 'assets/b/enemy.png', assetType: 'sprite', mimeType: 'image/png' },
        { originalName: 'bgm.mp3', storageKey: 'assets/c/bgm.mp3', assetType: 'audio', mimeType: 'audio/mpeg' },
        { originalName: 'idle.gltf', storageKey: 'assets/d/idle.gltf', assetType: '3d_model', mimeType: 'model/gltf+json' },
      ],
    });

    // Tag hero.png with 'background' and 'hd'
    const [hero, enemy] = await Promise.all([
      prisma.asset.findFirst({ where: { originalName: 'hero.png' } }),
      prisma.asset.findFirst({ where: { originalName: 'enemy.png' } }),
    ]);

    const tagBg = await prisma.tag.create({ data: { name: 'background' } });
    const tagHd = await prisma.tag.create({ data: { name: 'hd' } });
    const tagEnemy = await prisma.tag.create({ data: { name: 'enemy' } });

    await prisma.assetTag.createMany({
      data: [
        { assetId: hero!.id, tagId: tagBg.id },
        { assetId: hero!.id, tagId: tagHd.id },
        { assetId: enemy!.id, tagId: tagEnemy.id },
        { assetId: enemy!.id, tagId: tagHd.id },
      ],
    });
  });

  it('filters by assetType', async () => {
    const res = await request(app.server)
      .get('/api/files?assetType=audio')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].original_name).toBe('bgm.mp3');
  });

  it('filters by mimeType', async () => {
    const res = await request(app.server)
      .get('/api/files?mimeType=image/png')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('filters by single tag', async () => {
    const res = await request(app.server)
      .get('/api/files?tags=background')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].original_name).toBe('hero.png');
  });

  it('filters by multiple tags (AND logic)', async () => {
    // Both hero and enemy have 'hd', but only hero has 'background'
    const res = await request(app.server)
      .get('/api/files?tags=hd,background')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].original_name).toBe('hero.png');
  });

  it('returns empty array when no asset matches all tags', async () => {
    const res = await request(app.server)
      .get('/api/files?tags=background,enemy')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('response includes tags array on each asset', async () => {
    const res = await request(app.server)
      .get('/api/files?assetType=texture')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body[0].tags).toBeDefined();
    expect(Array.isArray(res.body[0].tags)).toBe(true);
  });
});
