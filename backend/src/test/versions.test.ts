import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { FastifyInstance } from 'fastify';
import { buildApp, cleanDb } from './helpers.js';
import { prisma } from '../db/client.js';

vi.mock('../storage/s3.js', () => ({
  uploadToS3: vi.fn().mockResolvedValue(undefined),
  deleteFromS3: vi.fn().mockResolvedValue(undefined),
  getS3ObjectStream: vi.fn().mockResolvedValue({
    stream: Buffer.from('file-content'),
    contentType: 'application/octet-stream',
    contentLength: 12,
  }),
}));

let app: FastifyInstance;
let token: string;

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
    .send({ email: 'versioner@example.com', password: 'password123' });
  token = res.body.token;
});

// --- GET /api/files/:id/versions ---

describe('GET /api/files/:id/versions', () => {
  it('returns empty array when no versions exist', async () => {
    const asset = await prisma.asset.create({
      data: { originalName: 'hero.png', storageKey: 'assets/1/hero.png', assetType: 'image' },
    });

    const res = await request(app.server)
      .get(`/api/files/${asset.id}/versions`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns versions in ascending order', async () => {
    const asset = await prisma.asset.create({
      data: { originalName: 'hero.png', storageKey: 'assets/1/hero.png', assetType: 'image' },
    });
    const user = await prisma.user.findFirst({ where: { email: 'versioner@example.com' } });

    await prisma.assetVersion.createMany({
      data: [
        { assetId: asset.id, versionNumber: 2, storageKey: 'assets/1/v2.png', uploadedBy: user!.id },
        { assetId: asset.id, versionNumber: 1, storageKey: 'assets/1/v1.png', uploadedBy: user!.id },
      ],
    });

    const res = await request(app.server)
      .get(`/api/files/${asset.id}/versions`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].version_number).toBe(1);
    expect(res.body[1].version_number).toBe(2);
  });

  it('returns 404 for unknown asset', async () => {
    const res = await request(app.server)
      .get('/api/files/00000000-0000-0000-0000-000000000000/versions')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const asset = await prisma.asset.create({
      data: { originalName: 'x.png', storageKey: 'assets/2/x.png', assetType: 'image' },
    });
    const res = await request(app.server).get(`/api/files/${asset.id}/versions`);
    expect(res.status).toBe(401);
  });
});

// --- POST /api/files/:id/versions ---

describe('POST /api/files/:id/versions', () => {
  it('creates v1 snapshot and v2 on first version upload', async () => {
    const asset = await prisma.asset.create({
      data: {
        originalName: 'hero.png',
        storageKey: 'assets/1/hero.png',
        assetType: 'image',
        mimeType: 'image/png',
        sizeBytes: 1024n,
      },
    });

    const res = await request(app.server)
      .post(`/api/files/${asset.id}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('new-version-data'), {
        filename: 'hero_v2.png',
        contentType: 'image/png',
      });

    expect(res.status).toBe(201);
    expect(res.body.version_number).toBe(2);

    const versions = await prisma.assetVersion.findMany({ where: { assetId: asset.id } });
    expect(versions).toHaveLength(2);
    expect(versions.find((v) => v.versionNumber === 1)).toBeDefined();
    expect(versions.find((v) => v.versionNumber === 2)).toBeDefined();
  });

  it('increments version number on subsequent upload', async () => {
    const asset = await prisma.asset.create({
      data: { originalName: 'hero.png', storageKey: 'assets/1/hero.png', assetType: 'image' },
    });
    const user = await prisma.user.findFirst({ where: { email: 'versioner@example.com' } });

    await prisma.assetVersion.createMany({
      data: [
        { assetId: asset.id, versionNumber: 1, storageKey: 'assets/1/v1.png', uploadedBy: user!.id },
        { assetId: asset.id, versionNumber: 2, storageKey: 'assets/1/v2.png', uploadedBy: user!.id },
      ],
    });

    const res = await request(app.server)
      .post(`/api/files/${asset.id}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('v3-data'), {
        filename: 'hero_v3.png',
        contentType: 'image/png',
      });

    expect(res.status).toBe(201);
    expect(res.body.version_number).toBe(3);
  });

  it('stores the optional commit message', async () => {
    const asset = await prisma.asset.create({
      data: { originalName: 'hero.png', storageKey: 'assets/1/hero.png', assetType: 'image' },
    });

    const res = await request(app.server)
      .post(`/api/files/${asset.id}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .field('message', 'Fixed sprite alignment')
      .attach('file', Buffer.from('v2-data'), {
        filename: 'hero.png',
        contentType: 'image/png',
      });

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Fixed sprite alignment');
  });

  it('updates the asset storageKey to the new version', async () => {
    const asset = await prisma.asset.create({
      data: {
        originalName: 'hero.png',
        storageKey: 'assets/1/hero.png',
        assetType: 'image',
        sizeBytes: 500n,
      },
    });

    await request(app.server)
      .post(`/api/files/${asset.id}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('new-content'), {
        filename: 'hero.png',
        contentType: 'image/png',
      });

    const updated = await prisma.asset.findUnique({ where: { id: asset.id } });
    expect(updated!.storageKey).not.toBe('assets/1/hero.png');
    expect(Number(updated!.sizeBytes)).toBe(Buffer.from('new-content').length);
  });

  it('returns 4xx without a file', async () => {
    const asset = await prisma.asset.create({
      data: { originalName: 'x.png', storageKey: 'assets/2/x.png', assetType: 'image' },
    });

    // Without multipart content-type Fastify returns 406; with multipart but no file we get 400
    const res = await request(app.server)
      .post(`/api/files/${asset.id}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('returns 404 for unknown asset', async () => {
    const res = await request(app.server)
      .post('/api/files/00000000-0000-0000-0000-000000000000/versions')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('data'), { filename: 'x.png', contentType: 'image/png' });

    expect(res.status).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const asset = await prisma.asset.create({
      data: { originalName: 'x.png', storageKey: 'assets/3/x.png', assetType: 'image' },
    });
    const res = await request(app.server)
      .post(`/api/files/${asset.id}/versions`)
      .attach('file', Buffer.from('data'), { filename: 'x.png', contentType: 'image/png' });
    expect(res.status).toBe(401);
  });
});

// --- GET /api/files/:id/versions/:versionId/download ---

describe('GET /api/files/:id/versions/:versionId/download', () => {
  it('streams the versioned file', async () => {
    const asset = await prisma.asset.create({
      data: { originalName: 'hero.png', storageKey: 'assets/1/hero.png', assetType: 'image' },
    });
    const user = await prisma.user.findFirst({ where: { email: 'versioner@example.com' } });

    const version = await prisma.assetVersion.create({
      data: {
        assetId: asset.id,
        versionNumber: 1,
        storageKey: 'assets/1/v1.png',
        mimeType: 'image/png',
        uploadedBy: user!.id,
      },
    });

    const res = await request(app.server)
      .get(`/api/files/${asset.id}/versions/${version.id}/download`)
      .query({ token });

    expect(res.status).toBe(200);
  });

  it('returns 404 for version belonging to different asset', async () => {
    const a1 = await prisma.asset.create({
      data: { originalName: 'a.png', storageKey: 'assets/a/a.png', assetType: 'image' },
    });
    const a2 = await prisma.asset.create({
      data: { originalName: 'b.png', storageKey: 'assets/b/b.png', assetType: 'image' },
    });
    const user = await prisma.user.findFirst({ where: { email: 'versioner@example.com' } });

    const version = await prisma.assetVersion.create({
      data: {
        assetId: a1.id,
        versionNumber: 1,
        storageKey: 'assets/a/v1.png',
        uploadedBy: user!.id,
      },
    });

    // Request version of a1 but under a2's URL
    const res = await request(app.server)
      .get(`/api/files/${a2.id}/versions/${version.id}/download`)
      .query({ token });

    expect(res.status).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const asset = await prisma.asset.create({
      data: { originalName: 'x.png', storageKey: 'assets/x/x.png', assetType: 'image' },
    });
    const user = await prisma.user.findFirst({ where: { email: 'versioner@example.com' } });
    const version = await prisma.assetVersion.create({
      data: { assetId: asset.id, versionNumber: 1, storageKey: 'assets/x/v1.png', uploadedBy: user!.id },
    });

    const res = await request(app.server).get(
      `/api/files/${asset.id}/versions/${version.id}/download`,
    );
    expect(res.status).toBe(401);
  });
});

// --- GET /api/files/:id/versions/:versionId/preview ---
// MAS-570: ensure ?token= query-param auth passes the preHandler (ASSET_MEDIA_RE must include /preview)

describe('GET /api/files/:id/versions/:versionId/preview', () => {
  it('streams the versioned file inline via ?token= query param', async () => {
    const asset = await prisma.asset.create({
      data: { originalName: 'hero.png', storageKey: 'assets/1/hero.png', assetType: 'image' },
    });
    const user = await prisma.user.findFirst({ where: { email: 'versioner@example.com' } });

    const version = await prisma.assetVersion.create({
      data: {
        assetId: asset.id,
        versionNumber: 1,
        storageKey: 'assets/1/v1.png',
        mimeType: 'image/png',
        uploadedBy: user!.id,
      },
    });

    const res = await request(app.server)
      .get(`/api/files/${asset.id}/versions/${version.id}/preview`)
      .query({ token });

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe('inline');
  });

  it('returns 401 without any auth', async () => {
    const asset = await prisma.asset.create({
      data: { originalName: 'x.png', storageKey: 'assets/x/x.png', assetType: 'image' },
    });
    const user = await prisma.user.findFirst({ where: { email: 'versioner@example.com' } });
    const version = await prisma.assetVersion.create({
      data: { assetId: asset.id, versionNumber: 1, storageKey: 'assets/x/v1.png', uploadedBy: user!.id },
    });

    const res = await request(app.server).get(
      `/api/files/${asset.id}/versions/${version.id}/preview`,
    );
    expect(res.status).toBe(401);
  });
});
