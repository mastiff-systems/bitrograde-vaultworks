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
    contentType: 'text/plain',
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
    .send({ email: 'fileuser@example.com', password: 'password123' });
  token = res.body.token;
});

describe('GET /api/files', () => {
  it('returns empty array when no assets exist', async () => {
    const res = await request(app.server)
      .get('/api/files')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns list of assets ordered by upload date', async () => {
    await prisma.asset.createMany({
      data: [
        { originalName: 'first.txt', storageKey: 'assets/1/first.txt', assetType: 'other' },
        { originalName: 'second.png', storageKey: 'assets/2/second.png', assetType: 'image' },
      ],
    });

    const res = await request(app.server)
      .get('/api/files')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ original_name: expect.any(String) });
  });

  it('returns 401 without auth', async () => {
    const res = await request(app.server).get('/api/files');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/files/:id', () => {
  it('returns asset by id', async () => {
    const asset = await prisma.asset.create({
      data: {
        originalName: 'test.png',
        mimeType: 'image/png',
        sizeBytes: 1024n,
        storageKey: 'assets/test/test.png',
        assetType: 'image',
      },
    });

    const res = await request(app.server)
      .get(`/api/files/${asset.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(asset.id);
    expect(res.body.original_name).toBe('test.png');
    expect(res.body.asset_type).toBe('image');
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app.server)
      .get('/api/files/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('returns 400 for non-uuid id', async () => {
    const res = await request(app.server)
      .get('/api/files/not-a-uuid')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/files/:id', () => {
  it('deletes asset and returns 204', async () => {
    const asset = await prisma.asset.create({
      data: {
        originalName: 'delete-me.txt',
        storageKey: 'assets/del/delete-me.txt',
        assetType: 'other',
      },
    });

    const res = await request(app.server)
      .delete(`/api/files/${asset.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(204);

    const check = await prisma.asset.findUnique({ where: { id: asset.id } });
    expect(check).toBeNull();
  });

  it('deletes thumbnail from S3 when present', async () => {
    const { deleteFromS3 } = await import('../storage/s3.js');
    const asset = await prisma.asset.create({
      data: {
        originalName: 'img.png',
        storageKey: 'assets/img/img.png',
        thumbnailKey: 'assets/img/thumbnail.webp',
        assetType: 'image',
      },
    });

    await request(app.server)
      .delete(`/api/files/${asset.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(deleteFromS3).toHaveBeenCalledWith('assets/img/thumbnail.webp');
  });

  it('returns 404 when deleting non-existent asset', async () => {
    const res = await request(app.server)
      .delete('/api/files/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const asset = await prisma.asset.create({
      data: { originalName: 'x.txt', storageKey: 'assets/x/x.txt', assetType: 'other' },
    });

    const res = await request(app.server).delete(`/api/files/${asset.id}`);
    expect(res.status).toBe(401);
  });
});
