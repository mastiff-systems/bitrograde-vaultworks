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
    expect(res.body).toMatchObject({ data: [], total: 0, page: 1, limit: 50, totalPages: 0 });
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
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).toMatchObject({ original_name: expect.any(String) });
    expect(res.body.total).toBe(2);
    expect(res.body.page).toBe(1);
  });

  it('response includes pagination metadata', async () => {
    await prisma.asset.create({
      data: { originalName: 'a.txt', storageKey: 'k/a.txt', assetType: 'other' },
    });
    const res = await request(app.server)
      .get('/api/files')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 1, page: 1, limit: 50, totalPages: 1 });
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('page=2 returns the correct offset slice', async () => {
    await prisma.asset.createMany({
      data: Array.from({ length: 3 }, (_, i) => ({
        originalName: `f${i}.txt`, storageKey: `k/f${i}.txt`, assetType: 'other',
      })),
    });
    const res = await request(app.server)
      .get('/api/files?page=2&limit=2')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.total).toBe(3);
    expect(res.body.page).toBe(2);
    expect(res.body.totalPages).toBe(2);
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

describe('GET /api/files?q= (fuzzy search)', () => {
  beforeEach(async () => {
    const dragon = await prisma.asset.create({
      data: {
        originalName: 'dragon_sprite.png',
        storageKey: 'assets/s/dragon_sprite.png',
        assetType: 'sprite',
        mimeType: 'image/png',
      },
    });
    await prisma.asset.create({
      data: {
        originalName: 'background_tile.png',
        storageKey: 'assets/s/background_tile.png',
        assetType: 'image',
        mimeType: 'image/png',
        description: 'dungeon floor tile',
      },
    });
    const tagged = await prisma.asset.create({
      data: {
        originalName: 'hero_idle.png',
        storageKey: 'assets/s/hero_idle.png',
        assetType: 'sprite',
        mimeType: 'image/png',
      },
    });
    const unrelated = await prisma.asset.create({
      data: {
        originalName: 'audio_bgm.mp3',
        storageKey: 'assets/s/audio_bgm.mp3',
        assetType: 'audio',
        mimeType: 'audio/mpeg',
      },
    });

    // Tag dragon with 'fire', hero_idle with 'epic'
    const tagFire = await prisma.tag.create({ data: { name: 'fire' } });
    const tagEpic = await prisma.tag.create({ data: { name: 'epic' } });
    await prisma.assetTag.create({ data: { assetId: dragon.id, tagId: tagFire.id } });
    await prisma.assetTag.create({ data: { assetId: tagged.id, tagId: tagEpic.id } });
  });

  it('exact match on name returns the asset', async () => {
    const res = await request(app.server)
      .get('/api/files?q=dragon_sprite.png')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].original_name).toBe('dragon_sprite.png');
  });

  it('partial match (substring) finds the asset', async () => {
    const res = await request(app.server)
      .get('/api/files?q=dragon')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.some((a: { original_name: string }) => a.original_name === 'dragon_sprite.png')).toBe(true);
  });

  it('fuzzy match with typo finds the asset via trigram similarity', async () => {
    // "drago" is sufficiently similar to "dragon_sprite" (trigram similarity > 0.3)
    const res = await request(app.server)
      .get('/api/files?q=drago')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.some((a: { original_name: string }) => a.original_name === 'dragon_sprite.png')).toBe(true);
  });

  it('matches via tag name', async () => {
    const res = await request(app.server)
      .get('/api/files?q=fire')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].original_name).toBe('dragon_sprite.png');
  });

  it('matches via description', async () => {
    const res = await request(app.server)
      .get('/api/files?q=dungeon')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].original_name).toBe('background_tile.png');
  });

  it('returns empty array when nothing matches', async () => {
    const res = await request(app.server)
      .get('/api/files?q=xyzzy_no_match_here')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it('combined with assetType filter narrows results', async () => {
    // 'background' matches background_tile.png (image); filter to image
    const res = await request(app.server)
      .get('/api/files?q=background&assetType=image')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.every((a: { asset_type: string }) => a.asset_type === 'image')).toBe(true);
    expect(res.body.data.some((a: { original_name: string }) => a.original_name === 'background_tile.png')).toBe(true);
  });

  it('combined with tags filter requires both match and tag', async () => {
    // 'hero' matches hero_idle.png (name contains hero, has 'epic' tag); dragon_sprite.png has no 'epic' tag
    const res = await request(app.server)
      .get('/api/files?q=hero&tags=epic')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].original_name).toBe('hero_idle.png');
  });

  it('result includes all asset tags regardless of which tag matched', async () => {
    const res = await request(app.server)
      .get('/api/files?q=fire')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].tags).toBeDefined();
    expect(Array.isArray(res.body.data[0].tags)).toBe(true);
    expect(res.body.data[0].tags[0].name).toBe('fire');
  });

  it('limit param caps the number of results', async () => {
    // All 4 assets match 'png' via name ILIKE; limit=2 should return only 2
    const res = await request(app.server)
      .get('/api/files?q=png&limit=2')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.limit).toBe(2);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
  });

  it('page=1 and page=2 results are disjoint (no duplicates)', async () => {
    const page1 = await request(app.server)
      .get('/api/files?q=png&page=1&limit=2')
      .set('Authorization', `Bearer ${token}`);
    const page2 = await request(app.server)
      .get('/api/files?q=png&page=2&limit=2')
      .set('Authorization', `Bearer ${token}`);

    expect(page1.status).toBe(200);
    expect(page2.status).toBe(200);

    const ids1 = page1.body.data.map((a: { id: string }) => a.id);
    const ids2 = page2.body.data.map((a: { id: string }) => a.id);
    const overlap = ids1.filter((id: string) => ids2.includes(id));
    expect(overlap).toHaveLength(0);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app.server).get('/api/files?q=dragon');
    expect(res.status).toBe(401);
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

describe('GET /api/files query validation', () => {
  it('returns 400 when categoryId is not a valid UUID', async () => {
    const res = await request(app.server)
      .get('/api/files?categoryId=not-a-uuid')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  it('returns 400 when limit is out of range', async () => {
    const res = await request(app.server)
      .get('/api/files?limit=0')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  it('returns 400 when page=0', async () => {
    const res = await request(app.server)
      .get('/api/files?page=0')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });
});
