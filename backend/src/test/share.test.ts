import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { FastifyInstance } from 'fastify';
import { buildApp, cleanDb } from './helpers.js';
import { prisma } from '../db/client.js';

vi.mock('../storage/s3.js', () => ({
  uploadToS3: vi.fn().mockResolvedValue(undefined),
  deleteFromS3: vi.fn().mockResolvedValue(undefined),
  getS3ObjectStream: vi.fn().mockResolvedValue({
    stream: Buffer.from('asset-bytes'),
    contentType: 'image/png',
    contentLength: 10,
  }),
}));

let app: FastifyInstance;
let token: string;
let otherToken: string;

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
    .send({ email: 'sharer@example.com', password: 'password123' });
  token = res.body.token;

  const res2 = await request(app.server)
    .post('/api/auth/register')
    .send({ email: 'other@example.com', password: 'password123' });
  otherToken = res2.body.token;
});

async function createAsset() {
  return prisma.asset.create({
    data: { originalName: 'image.png', mimeType: 'image/png', storageKey: 'assets/share-test/image.png', assetType: 'image' },
  });
}

describe('POST /api/files/:id/share', () => {
  it('creates a share link and returns token + url + expiresAt', async () => {
    const asset = await createAsset();
    const res = await request(app.server)
      .post(`/api/files/${asset.id}/share`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      token: expect.stringMatching(/^[0-9a-f]{64}$/),
      url: expect.stringContaining('/api/share/'),
      expiresAt: expect.any(String),
    });
  });

  it('respects custom expiresInDays', async () => {
    const asset = await createAsset();
    const res = await request(app.server)
      .post(`/api/files/${asset.id}/share`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expiresInDays: 7 });

    expect(res.status).toBe(201);
    const expiry = new Date(res.body.expiresAt);
    const diffDays = (expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThan(6);
    expect(diffDays).toBeLessThan(8);
  });

  it('returns 404 for non-existent asset', async () => {
    const res = await request(app.server)
      .post('/api/files/00000000-0000-0000-0000-000000000000/share')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const asset = await createAsset();
    const res = await request(app.server)
      .post(`/api/files/${asset.id}/share`)
      .send({});

    expect(res.status).toBe(401);
  });

  it('replaces existing share link (one per asset)', async () => {
    const asset = await createAsset();
    const res1 = await request(app.server)
      .post(`/api/files/${asset.id}/share`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    const res2 = await request(app.server)
      .post(`/api/files/${asset.id}/share`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
    expect(res1.body.token).not.toBe(res2.body.token);

    const count = await prisma.shareLink.count({ where: { assetId: asset.id } });
    expect(count).toBe(1);
  });
});

describe('GET /api/share/:token', () => {
  it('streams the asset for a valid token (unauthenticated)', async () => {
    const asset = await createAsset();
    const shareRes = await request(app.server)
      .post(`/api/files/${asset.id}/share`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    const { token: shareToken } = shareRes.body;

    const res = await request(app.server).get(`/api/share/${shareToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
  });

  it('returns 404 for unknown token', async () => {
    const fakeToken = 'a'.repeat(64);
    const res = await request(app.server).get(`/api/share/${fakeToken}`);
    expect(res.status).toBe(404);
  });

  it('returns 404 for expired token', async () => {
    const asset = await createAsset();
    const past = new Date(Date.now() - 1000);
    await prisma.shareLink.create({
      data: {
        token: 'b'.repeat(64),
        assetId: asset.id,
        expiresAt: past,
      },
    });

    const res = await request(app.server).get(`/api/share/${'b'.repeat(64)}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/files/:id/share', () => {
  it('lists active share links for the asset', async () => {
    const asset = await createAsset();
    await request(app.server)
      .post(`/api/files/${asset.id}/share`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    const res = await request(app.server)
      .get(`/api/files/${asset.id}/share`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ url: expect.stringContaining('/api/share/'), expiresAt: expect.any(String) });
  });

  it('returns 401 without auth', async () => {
    const asset = await createAsset();
    const res = await request(app.server).get(`/api/files/${asset.id}/share`);
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/files/:id/share', () => {
  it('revokes all share links for the asset (owner)', async () => {
    const asset = await createAsset();
    await request(app.server)
      .post(`/api/files/${asset.id}/share`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    const del = await request(app.server)
      .delete(`/api/files/${asset.id}/share`)
      .set('Authorization', `Bearer ${token}`);

    expect(del.status).toBe(204);
    const count = await prisma.shareLink.count({ where: { assetId: asset.id } });
    expect(count).toBe(0);
  });

  it('non-owner cannot revoke another user\'s share link', async () => {
    const asset = await createAsset();
    await request(app.server)
      .post(`/api/files/${asset.id}/share`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    const del = await request(app.server)
      .delete(`/api/files/${asset.id}/share`)
      .set('Authorization', `Bearer ${otherToken}`);

    // returns 204 but deletes nothing (no links owned by otherToken)
    expect(del.status).toBe(204);
    const count = await prisma.shareLink.count({ where: { assetId: asset.id } });
    expect(count).toBe(1);
  });

  it('returns 401 without auth', async () => {
    const asset = await createAsset();
    const res = await request(app.server).delete(`/api/files/${asset.id}/share`);
    expect(res.status).toBe(401);
  });

  it('revoked link is no longer accessible via GET /api/share/:token', async () => {
    const asset = await createAsset();
    const shareRes = await request(app.server)
      .post(`/api/files/${asset.id}/share`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    const { token: shareToken } = shareRes.body;

    await request(app.server)
      .delete(`/api/files/${asset.id}/share`)
      .set('Authorization', `Bearer ${token}`);

    const res = await request(app.server).get(`/api/share/${shareToken}`);
    expect(res.status).toBe(404);
  });
});

describe('Audit log', () => {
  it('records SHARE action after POST /api/files/:id/share', async () => {
    const asset = await createAsset();
    await request(app.server)
      .post(`/api/files/${asset.id}/share`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    // logAudit is fire-and-forget; yield to the event loop so the write completes
    await new Promise((r) => setTimeout(r, 50));

    const entry = await prisma.auditLog.findFirst({
      where: { assetId: asset.id, action: 'SHARE' },
    });
    expect(entry).not.toBeNull();
    expect(entry?.action).toBe('SHARE');
  });

  it('records REVOKE_SHARE action after DELETE /api/files/:id/share', async () => {
    const asset = await createAsset();
    await request(app.server)
      .post(`/api/files/${asset.id}/share`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    await request(app.server)
      .delete(`/api/files/${asset.id}/share`)
      .set('Authorization', `Bearer ${token}`);

    await new Promise((r) => setTimeout(r, 50));

    const entry = await prisma.auditLog.findFirst({
      where: { assetId: asset.id, action: 'REVOKE_SHARE' },
    });
    expect(entry).not.toBeNull();
    expect(entry?.action).toBe('REVOKE_SHARE');
  });
});
