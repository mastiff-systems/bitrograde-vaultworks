import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { FastifyInstance } from 'fastify';
import { buildApp, cleanDb } from './helpers.js';
import { prisma } from '../db/client.js';

// Routes now use getStorageProvider() from storage/index.js — mock that module
// instead of the old s3.js stubs.
vi.mock('../storage/index.js', () => ({
  getStorageProvider: vi.fn().mockResolvedValue({
    upload: vi.fn().mockResolvedValue(undefined),
    streamUpload: vi.fn().mockImplementation((_key: string, body: NodeJS.ReadableStream) =>
      new Promise<void>((resolve, reject) => {
        body.resume();
        body.on('end', resolve);
        body.on('error', reject);
      }),
    ),
    download: vi.fn().mockResolvedValue({
      stream: Buffer.from('file-content'),
      contentType: 'text/plain',
      contentLength: 12,
    }),
    delete: vi.fn().mockResolvedValue(undefined),
    copy: vi.fn().mockResolvedValue(undefined),
  }),
  invalidateStorageCache: vi.fn(),
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
    .send({ email: 'cacheuser@example.com', password: 'password123' });
  token = res.body.token;
});

describe('ETag / Cache-Control — GET /api/files', () => {
  it('returns ETag and Cache-Control: private, no-cache', async () => {
    const res = await request(app.server)
      .get('/api/files')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.headers['etag']).toMatch(/^"[0-9a-f]+"$/);
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('returns 304 when If-None-Match matches the ETag', async () => {
    const first = await request(app.server)
      .get('/api/files')
      .set('Authorization', `Bearer ${token}`);
    expect(first.status).toBe(200);

    const second = await request(app.server)
      .get('/api/files')
      .set('Authorization', `Bearer ${token}`)
      .set('If-None-Match', first.headers['etag'] as string);

    expect(second.status).toBe(304);
  });

  it('returns 200 when If-None-Match does not match', async () => {
    const res = await request(app.server)
      .get('/api/files')
      .set('Authorization', `Bearer ${token}`)
      .set('If-None-Match', '"staledeadbeef"');

    expect(res.status).toBe(200);
  });
});

describe('ETag / Cache-Control — GET /api/files/:id', () => {
  it('returns ETag, Last-Modified, and Cache-Control: private, no-cache', async () => {
    const asset = await prisma.asset.create({
      data: { originalName: 'test.txt', storageKey: 'k/test.txt', assetType: 'other' },
    });

    const res = await request(app.server)
      .get(`/api/files/${asset.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.headers['etag']).toMatch(/^"[0-9a-f]+"$/);
    expect(res.headers['last-modified']).toBeDefined();
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('returns 304 when If-None-Match matches the ETag', async () => {
    const asset = await prisma.asset.create({
      data: { originalName: 'test.txt', storageKey: 'k/test.txt', assetType: 'other' },
    });

    const first = await request(app.server)
      .get(`/api/files/${asset.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(first.status).toBe(200);
    const etag = first.headers['etag'] as string;

    const second = await request(app.server)
      .get(`/api/files/${asset.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('If-None-Match', etag);

    expect(second.status).toBe(304);
  });

  it('returns 200 when If-None-Match does not match', async () => {
    const asset = await prisma.asset.create({
      data: { originalName: 'test.txt', storageKey: 'k/test.txt', assetType: 'other' },
    });

    const res = await request(app.server)
      .get(`/api/files/${asset.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('If-None-Match', '"staledeadbeef"');

    expect(res.status).toBe(200);
  });

  it('returns 304 when If-Modified-Since matches Last-Modified', async () => {
    const asset = await prisma.asset.create({
      data: { originalName: 'test.txt', storageKey: 'k/test.txt', assetType: 'other' },
    });

    const first = await request(app.server)
      .get(`/api/files/${asset.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(first.status).toBe(200);
    const lastModified = first.headers['last-modified'] as string;

    const second = await request(app.server)
      .get(`/api/files/${asset.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('If-Modified-Since', lastModified);

    expect(second.status).toBe(304);
  });

  it('returns 200 when If-Modified-Since is before asset updatedAt', async () => {
    const asset = await prisma.asset.create({
      data: { originalName: 'test.txt', storageKey: 'k/test.txt', assetType: 'other' },
    });

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toUTCString();

    const res = await request(app.server)
      .get(`/api/files/${asset.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('If-Modified-Since', yesterday);

    expect(res.status).toBe(200);
  });
});

describe('Cache-Control — GET /api/share/:token', () => {
  it('returns Cache-Control: public, max-age=300', async () => {
    const asset = await prisma.asset.create({
      data: { originalName: 'shared.txt', storageKey: 'k/shared.txt', assetType: 'other' },
    });

    const shareRes = await request(app.server)
      .post(`/api/files/${asset.id}/share`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(shareRes.status).toBe(201);

    const res = await request(app.server).get(`/api/share/${shareRes.body.token}`);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=300');
  });
});
