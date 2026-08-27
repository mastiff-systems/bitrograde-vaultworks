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
    streamUpload: vi.fn().mockResolvedValue(undefined),
    download: vi.fn().mockResolvedValue({
      stream: Buffer.from('file-content'),
      contentType: 'text/plain',
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
  userId = res.body.user.id;
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
  it('soft-deletes asset (moved to trash) and returns 204', async () => {
    // Must set uploadedBy so the delete permission check passes for non-admin users.
    const asset = await prisma.asset.create({
      data: {
        originalName: 'delete-me.txt',
        storageKey: 'assets/del/delete-me.txt',
        assetType: 'other',
        uploadedBy: userId,
      },
    });

    const res = await request(app.server)
      .delete(`/api/files/${asset.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(204);

    // DELETE is a soft-delete: the record stays, marked deleted, keyed into trash/
    const check = await prisma.asset.findUnique({ where: { id: asset.id } });
    expect(check?.deletedAt).not.toBeNull();
    expect(check?.storageKey).toBe(`trash/${asset.id}/delete-me.txt`);
  });

  it('moves storage object and thumbnail to trash', async () => {
    // Access the mock provider's move spy via the mocked module.
    const { getStorageProvider } = await import('../storage/index.js');
    const provider = await (getStorageProvider as ReturnType<typeof vi.fn>)();
    const moveMock = provider.move as ReturnType<typeof vi.fn>;
    moveMock.mockClear();

    const asset = await prisma.asset.create({
      data: {
        originalName: 'img.png',
        storageKey: 'assets/img/img.png',
        thumbnailKey: 'assets/img/thumbnail.webp',
        assetType: 'image',
        uploadedBy: userId,
      },
    });

    await request(app.server)
      .delete(`/api/files/${asset.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(moveMock).toHaveBeenCalledWith('assets/img/img.png', `trash/${asset.id}/img.png`);
    expect(moveMock).toHaveBeenCalledWith('assets/img/thumbnail.webp', `trash/${asset.id}/thumbnail.webp`);
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

// MAS-608: ownership enforcement on the three destructive/restorative file routes.
//
// NOTE ON TEST SETUP: the outer beforeEach registers fileuser@example.com FIRST after
// cleanDb, and the register route makes the first user an admin. So `token`/`userId`
// are an ADMIN identity — which is why the pre-existing DELETE tests above pass the
// ownership check regardless of uploadedBy. Every 403 case below therefore needs a
// second, non-admin user (`otherToken`), and uses `userId` (the admin) as the victim
// owner so the caller is neither admin nor owner.
describe('ownership checks on delete/restore/purge (MAS-608)', () => {
  let otherToken: string;
  let otherUserId: string;

  beforeEach(async () => {
    const res = await request(app.server)
      .post('/api/auth/register')
      .send({ email: 'attacker@example.com', password: 'password123' });
    expect(res.body.user.role).toBe('user'); // guards the admin-is-first-user assumption
    otherToken = res.body.token;
    otherUserId = res.body.user.id;
  });

  // Creates an asset already in the trash, owned by `owner`.
  async function createTrashedAsset(owner: string, name = 'victim.txt') {
    return prisma.asset.create({
      data: {
        originalName: name,
        storageKey: `trash/x/${name}`,
        assetType: 'other',
        uploadedBy: owner,
        deletedAt: new Date(),
        deletedBy: owner,
      },
    });
  }

  describe('DELETE /api/files/:id (soft-delete)', () => {
    it('returns 403 for a non-admin, non-owner and leaves the asset untrashed', async () => {
      const asset = await prisma.asset.create({
        data: {
          originalName: 'not-yours.txt',
          storageKey: 'assets/ny/not-yours.txt',
          assetType: 'other',
          uploadedBy: userId, // owned by the admin, not the caller
        },
      });

      const res = await request(app.server)
        .delete(`/api/files/${asset.id}`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'Forbidden' });

      const check = await prisma.asset.findUnique({ where: { id: asset.id } });
      expect(check?.deletedAt).toBeNull();
    });

    it('allows the owner (non-admin) to soft-delete their own asset', async () => {
      const asset = await prisma.asset.create({
        data: {
          originalName: 'mine.txt',
          storageKey: 'assets/mine/mine.txt',
          assetType: 'other',
          uploadedBy: otherUserId,
        },
      });

      const res = await request(app.server)
        .delete(`/api/files/${asset.id}`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(204);
      const check = await prisma.asset.findUnique({ where: { id: asset.id } });
      expect(check?.deletedAt).not.toBeNull();
    });
  });

  describe('POST /api/files/:id/restore', () => {
    it('returns 403 for a non-admin, non-owner and leaves the asset in the trash', async () => {
      const asset = await createTrashedAsset(userId);

      const res = await request(app.server)
        .post(`/api/files/${asset.id}/restore`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'Forbidden' });

      const check = await prisma.asset.findUnique({ where: { id: asset.id } });
      expect(check?.deletedAt).not.toBeNull();
    });

    it('allows the owner (non-admin) to restore their own asset', async () => {
      const asset = await createTrashedAsset(otherUserId, 'mine-trashed.txt');

      const res = await request(app.server)
        .post(`/api/files/${asset.id}/restore`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(asset.id);

      const check = await prisma.asset.findUnique({ where: { id: asset.id } });
      expect(check?.deletedAt).toBeNull();
    });

    it('allows an admin to restore another user\'s asset', async () => {
      const asset = await createTrashedAsset(otherUserId, 'theirs-trashed.txt');

      const res = await request(app.server)
        .post(`/api/files/${asset.id}/restore`)
        .set('Authorization', `Bearer ${token}`); // admin

      expect(res.status).toBe(200);
      const check = await prisma.asset.findUnique({ where: { id: asset.id } });
      expect(check?.deletedAt).toBeNull();
    });

    it('returns 404 (not 403) for an asset that is not in the trash', async () => {
      const asset = await prisma.asset.create({
        data: {
          originalName: 'live.txt',
          storageKey: 'assets/live/live.txt',
          assetType: 'other',
          uploadedBy: userId,
        },
      });

      const res = await request(app.server)
        .post(`/api/files/${asset.id}/restore`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(404);
    });

    it('returns 404 for a missing asset', async () => {
      const res = await request(app.server)
        .post('/api/files/00000000-0000-0000-0000-000000000000/restore')
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/files/:id/purge', () => {
    // This is the core regression test: the pre-fix handler called prisma.asset.delete
    // unconditionally, so the row was already destroyed before any check could run.
    it('returns 403 for a non-admin, non-owner AND the asset row still exists', async () => {
      const asset = await createTrashedAsset(userId, 'purge-me.txt');

      const res = await request(app.server)
        .delete(`/api/files/${asset.id}/purge`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'Forbidden' });

      // The whole point of the bug: an unauthorized caller must not destroy the row.
      const check = await prisma.asset.findUnique({ where: { id: asset.id } });
      expect(check).not.toBeNull();
      expect(check?.deletedAt).not.toBeNull();
    });

    it('does not delete storage objects on a 403', async () => {
      const { getStorageProvider } = await import('../storage/index.js');
      const provider = await (getStorageProvider as ReturnType<typeof vi.fn>)();
      const deleteMock = provider.delete as ReturnType<typeof vi.fn>;
      deleteMock.mockClear();

      const asset = await createTrashedAsset(userId, 'keep-bytes.txt');

      const res = await request(app.server)
        .delete(`/api/files/${asset.id}/purge`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(403);
      expect(deleteMock).not.toHaveBeenCalled();
    });

    it('allows the owner (non-admin) to purge their own asset', async () => {
      const asset = await createTrashedAsset(otherUserId, 'my-purge.txt');

      const res = await request(app.server)
        .delete(`/api/files/${asset.id}/purge`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(204);
      const check = await prisma.asset.findUnique({ where: { id: asset.id } });
      expect(check).toBeNull();
    });

    it('allows an admin to purge another user\'s asset', async () => {
      const asset = await createTrashedAsset(otherUserId, 'their-purge.txt');

      const res = await request(app.server)
        .delete(`/api/files/${asset.id}/purge`)
        .set('Authorization', `Bearer ${token}`); // admin

      expect(res.status).toBe(204);
      const check = await prisma.asset.findUnique({ where: { id: asset.id } });
      expect(check).toBeNull();
    });

    it('returns 404 (not 403) for an asset that is not in the trash', async () => {
      const asset = await prisma.asset.create({
        data: {
          originalName: 'live2.txt',
          storageKey: 'assets/live2/live2.txt',
          assetType: 'other',
          uploadedBy: userId,
        },
      });

      const res = await request(app.server)
        .delete(`/api/files/${asset.id}/purge`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(404);
      // A live asset must survive a 404 purge attempt.
      const check = await prisma.asset.findUnique({ where: { id: asset.id } });
      expect(check).not.toBeNull();
    });

    it('returns 404 for a missing asset', async () => {
      const res = await request(app.server)
        .delete('/api/files/00000000-0000-0000-0000-000000000000/purge')
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(404);
    });
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
