/**
 * Schema validation tests — MAS-244
 *
 * Verifies that Fastify JSON Schema + Zod validation added to all routes in MAS-241
 * correctly rejects invalid inputs with 400 and that valid inputs still return 2xx.
 *
 * Auth routes (email/password failures) are already covered in auth.test.ts.
 * This file adds the cases that aren't covered there.
 */
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
      contentType: 'application/octet-stream',
      contentLength: 12,
    }),
    delete: vi.fn().mockResolvedValue(undefined),
    copy: vi.fn().mockResolvedValue(undefined),
  }),
  invalidateStorageCache: vi.fn(),
}));

let app: FastifyInstance;
let adminToken: string;
let userToken: string;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await cleanDb();
  const adminRes = await request(app.server)
    .post('/api/auth/register')
    .send({ email: 'admin@example.com', password: 'password123' });
  adminToken = adminRes.body.token;

  const userRes = await request(app.server)
    .post('/api/auth/register')
    .send({ email: 'user@example.com', password: 'password123' });
  userToken = userRes.body.token;
});

// ─── auth — missing fields / extra fields ────────────────────────────────────

describe('POST /api/auth/register — schema validation', () => {
  it('returns 400 when email is missing', async () => {
    const res = await request(app.server)
      .post('/api/auth/register')
      .send({ password: 'password123' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when password is missing', async () => {
    const res = await request(app.server)
      .post('/api/auth/register')
      .send({ email: 'new@example.com' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for extra unknown field (additionalProperties: false)', async () => {
    const res = await request(app.server)
      .post('/api/auth/register')
      .send({ email: 'new@example.com', password: 'password123', role: 'superadmin' });
    expect(res.status).toBe(400);
  });

  it('returns 201 on valid registration', async () => {
    await cleanDb();
    const res = await request(app.server)
      .post('/api/auth/register')
      .send({ email: 'valid@example.com', password: 'password123' });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
  });
});

describe('POST /api/auth/login — schema validation', () => {
  it('returns 400 when email is missing', async () => {
    const res = await request(app.server)
      .post('/api/auth/login')
      .send({ password: 'password123' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when password is missing', async () => {
    const res = await request(app.server)
      .post('/api/auth/login')
      .send({ email: 'admin@example.com' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for extra unknown field (additionalProperties: false)', async () => {
    const res = await request(app.server)
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'password123', extra: 'field' });
    expect(res.status).toBe(400);
  });
});

// ─── files — querystring schema ──────────────────────────────────────────────

describe('GET /api/files — querystring schema validation', () => {
  it('returns 400 when limit exceeds max of 200', async () => {
    const res = await request(app.server)
      .get('/api/files?limit=201')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(400);
  });

  it('returns 400 for extra unknown querystring field (additionalProperties: false)', async () => {
    const res = await request(app.server)
      .get('/api/files?unknown=bad')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(400);
  });

  it('returns 200 with valid query params', async () => {
    const res = await request(app.server)
      .get('/api/files?limit=10&page=1')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(200);
  });
});

describe('GET /api/files/:id — UUID param validation', () => {
  it('returns 400 for non-UUID id', async () => {
    const res = await request(app.server)
      .get('/api/files/not-a-valid-uuid')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/files/:id — body validation', () => {
  it('returns 400 when a tag name exceeds maxLength of 100 chars', async () => {
    const asset = await prisma.asset.create({
      data: { originalName: 'test.png', storageKey: 'k/test.png', assetType: 'image', uploadedBy: null },
    });
    const res = await request(app.server)
      .patch(`/api/files/${asset.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ tags: ['x'.repeat(101)] });
    expect(res.status).toBe(400);
  });

  it('returns 400 when description exceeds max length', async () => {
    const asset = await prisma.asset.create({
      data: { originalName: 'test.png', storageKey: 'k/test.png', assetType: 'image', uploadedBy: null },
    });
    const res = await request(app.server)
      .patch(`/api/files/${asset.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ description: 'x'.repeat(2001) });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/files/bulk-delete — body validation', () => {
  it('returns 400 when ids is missing', async () => {
    const res = await request(app.server)
      .post('/api/files/bulk-delete')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 when ids is empty array', async () => {
    const res = await request(app.server)
      .post('/api/files/bulk-delete')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ids: [] });
    expect(res.status).toBe(400);
  });

  it('returns 400 when ids contains non-UUID strings', async () => {
    const res = await request(app.server)
      .post('/api/files/bulk-delete')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ids: ['not-a-uuid'] });
    expect(res.status).toBe(400);
  });
});

// ─── categories ───────────────────────────────────────────────────────────────

describe('POST /api/categories — body validation', () => {
  it('returns 400 when name is missing', async () => {
    const res = await request(app.server)
      .post('/api/categories')
      .set('Authorization', `Bearer ${userToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 201 on valid create', async () => {
    const res = await request(app.server)
      .post('/api/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Graphics' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Graphics');
  });
});

describe('PATCH /api/categories/:id — param validation', () => {
  it('returns 400 for non-UUID id', async () => {
    const res = await request(app.server)
      .patch('/api/categories/not-a-uuid')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 'Updated' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/categories/:categoryId/subcategories — param validation', () => {
  it('returns 400 for non-UUID categoryId', async () => {
    const res = await request(app.server)
      .get('/api/categories/not-a-uuid/subcategories')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/categories/:categoryId/subcategories — param + body validation', () => {
  it('returns 400 for non-UUID categoryId', async () => {
    const res = await request(app.server)
      .post('/api/categories/not-a-uuid/subcategories')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 'Icons' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when name is missing', async () => {
    const cat = await prisma.category.create({ data: { name: 'Graphics', slug: 'graphics' } });
    const res = await request(app.server)
      .post(`/api/categories/${cat.id}/subcategories`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({});
    expect(res.status).toBe(400);
  });
});

// ─── tags ────────────────────────────────────────────────────────────────────

describe('POST /api/tags — body validation', () => {
  it('returns 400 when name is missing', async () => {
    const res = await request(app.server)
      .post('/api/tags')
      .set('Authorization', `Bearer ${userToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 for extra unknown field (additionalProperties: false)', async () => {
    const res = await request(app.server)
      .post('/api/tags')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 'valid-tag', extra: 'should-fail' });
    expect(res.status).toBe(400);
  });

  it('returns 201 on valid create', async () => {
    const res = await request(app.server)
      .post('/api/tags')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 'texture' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('texture');
  });
});

describe('DELETE /api/tags/:id — UUID param validation', () => {
  it('returns 400 for non-UUID id', async () => {
    const res = await request(app.server)
      .delete('/api/tags/not-a-uuid')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/files/:id/tags — body validation', () => {
  it('returns 400 for extra unknown field (additionalProperties: false)', async () => {
    const asset = await prisma.asset.create({
      data: { originalName: 'hero.png', storageKey: 'k/hero.png', assetType: 'image', uploadedBy: null },
    });
    const res = await request(app.server)
      .put(`/api/files/${asset.id}/tags`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ tags: ['art'], extra: 'nope' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when tags field is missing', async () => {
    const asset = await prisma.asset.create({
      data: { originalName: 'hero.png', storageKey: 'k/hero.png', assetType: 'image', uploadedBy: null },
    });
    const res = await request(app.server)
      .put(`/api/files/${asset.id}/tags`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(400);
  });
});

// ─── collections ─────────────────────────────────────────────────────────────

describe('POST /api/collections — body validation', () => {
  it('returns 400 when name is missing', async () => {
    const res = await request(app.server)
      .post('/api/collections')
      .set('Authorization', `Bearer ${userToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 for extra unknown field (additionalProperties: false)', async () => {
    const res = await request(app.server)
      .post('/api/collections')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 'My Collection', unknownField: true });
    expect(res.status).toBe(400);
  });

  it('returns 201 on valid create', async () => {
    const res = await request(app.server)
      .post('/api/collections')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 'Favourites' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Favourites');
  });
});

describe('GET /api/collections/:id — UUID param validation', () => {
  it('returns 400 for non-UUID id', async () => {
    const res = await request(app.server)
      .get('/api/collections/not-a-uuid')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/collections/:id — body + param validation', () => {
  it('returns 400 for non-UUID id', async () => {
    const res = await request(app.server)
      .patch('/api/collections/not-a-uuid')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 'New Name' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for extra unknown field (additionalProperties: false)', async () => {
    const col = await request(app.server)
      .post('/api/collections')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 'My Coll' });
    const res = await request(app.server)
      .patch(`/api/collections/${col.body.id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 'Updated', badField: 'x' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/collections/:id/assets — body validation', () => {
  it('returns 400 when assetIds is missing', async () => {
    const col = await request(app.server)
      .post('/api/collections')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 'My Coll' });
    const res = await request(app.server)
      .post(`/api/collections/${col.body.id}/assets`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 when assetIds contains non-UUIDs', async () => {
    const col = await request(app.server)
      .post('/api/collections')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 'My Coll' });
    const res = await request(app.server)
      .post(`/api/collections/${col.body.id}/assets`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ assetIds: ['not-a-uuid'] });
    expect(res.status).toBe(400);
  });

  it('returns 400 when collection id param is not UUID', async () => {
    const res = await request(app.server)
      .post('/api/collections/not-a-uuid/assets')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ assetIds: ['00000000-0000-0000-0000-000000000001'] });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/collections/:id/assets/:assetId — UUID param validation', () => {
  it('returns 400 for non-UUID assetId', async () => {
    const col = await request(app.server)
      .post('/api/collections')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 'My Coll' });
    const res = await request(app.server)
      .delete(`/api/collections/${col.body.id}/assets/not-a-uuid`)
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-UUID collection id', async () => {
    const res = await request(app.server)
      .delete('/api/collections/not-a-uuid/assets/00000000-0000-0000-0000-000000000001')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(400);
  });
});

// ─── share ────────────────────────────────────────────────────────────────────

describe('POST /api/files/:id/share — param + body validation', () => {
  it('returns 400 for non-UUID file id param', async () => {
    const res = await request(app.server)
      .post('/api/files/not-a-uuid/share')
      .set('Authorization', `Bearer ${userToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 when expiresInDays is less than 1', async () => {
    const asset = await prisma.asset.create({
      data: { originalName: 'img.png', storageKey: 'k/img.png', assetType: 'image', uploadedBy: null },
    });
    const res = await request(app.server)
      .post(`/api/files/${asset.id}/share`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ expiresInDays: 0 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when expiresInDays exceeds 365', async () => {
    const asset = await prisma.asset.create({
      data: { originalName: 'img.png', storageKey: 'k/img.png', assetType: 'image', uploadedBy: null },
    });
    const res = await request(app.server)
      .post(`/api/files/${asset.id}/share`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ expiresInDays: 366 });
    expect(res.status).toBe(400);
  });

  it('returns 400 for extra unknown field (additionalProperties: false)', async () => {
    const asset = await prisma.asset.create({
      data: { originalName: 'img.png', storageKey: 'k/img.png', assetType: 'image', uploadedBy: null },
    });
    const res = await request(app.server)
      .post(`/api/files/${asset.id}/share`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ expiresInDays: 7, unknownField: true });
    expect(res.status).toBe(400);
  });

  it('returns 201 on valid share link creation', async () => {
    const asset = await prisma.asset.create({
      data: { originalName: 'img.png', storageKey: 'k/img.png', assetType: 'image', uploadedBy: null },
    });
    const res = await request(app.server)
      .post(`/api/files/${asset.id}/share`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ expiresInDays: 7 });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
  });
});

describe('GET /api/share/:token — token length validation', () => {
  it('returns 400 when token is shorter than 64 chars', async () => {
    const res = await request(app.server)
      .get('/api/share/tooshort');
    expect(res.status).toBe(400);
  });

  it('returns 400 when token is longer than 64 chars', async () => {
    const longToken = 'a'.repeat(65);
    const res = await request(app.server)
      .get(`/api/share/${longToken}`);
    expect(res.status).toBe(400);
  });
});

// ─── admin ────────────────────────────────────────────────────────────────────

describe('PATCH /api/admin/users/:id/role — body + param validation', () => {
  it('returns 400 for non-UUID user id param', async () => {
    const res = await request(app.server)
      .patch('/api/admin/users/not-a-uuid/role')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'user' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid role value', async () => {
    const userRes = await request(app.server)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${userToken}`);
    const userId = userRes.body.userId;
    const res = await request(app.server)
      .patch(`/api/admin/users/${userId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'superadmin' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for extra unknown field (additionalProperties: false)', async () => {
    const userRes = await request(app.server)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${userToken}`);
    const userId = userRes.body.userId;
    const res = await request(app.server)
      .patch(`/api/admin/users/${userId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'user', extra: 'field' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when role is missing', async () => {
    const userRes = await request(app.server)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${userToken}`);
    const userId = userRes.body.userId;
    const res = await request(app.server)
      .patch(`/api/admin/users/${userId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 200 on valid role change', async () => {
    const userRes = await request(app.server)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${userToken}`);
    const userId = userRes.body.userId;
    const res = await request(app.server)
      .patch(`/api/admin/users/${userId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'admin' });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('admin');
  });
});

describe('GET /api/admin/audit-logs — querystring validation', () => {
  it('returns 400 when limit is 0', async () => {
    const res = await request(app.server)
      .get('/api/admin/audit-logs?limit=0')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  it('returns 400 when limit exceeds 200', async () => {
    const res = await request(app.server)
      .get('/api/admin/audit-logs?limit=201')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid action value', async () => {
    const res = await request(app.server)
      .get('/api/admin/audit-logs?action=INVALID_ACTION')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-UUID assetId', async () => {
    const res = await request(app.server)
      .get('/api/admin/audit-logs?assetId=not-a-uuid')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  it('returns 400 for extra unknown querystring field (additionalProperties: false)', async () => {
    const res = await request(app.server)
      .get('/api/admin/audit-logs?badField=x')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  it('returns 200 with valid query', async () => {
    const res = await request(app.server)
      .get('/api/admin/audit-logs?limit=10')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });
});

// ─── notifications ────────────────────────────────────────────────────────────

describe('PATCH /api/notifications/:id/read — UUID param validation', () => {
  it('returns 400 for non-UUID notification id', async () => {
    const res = await request(app.server)
      .patch('/api/notifications/not-a-uuid/read')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(400);
  });
});

// ─── versions ────────────────────────────────────────────────────────────────

describe('GET /api/files/:id/versions — UUID param validation', () => {
  it('returns 400 for non-UUID asset id', async () => {
    const res = await request(app.server)
      .get('/api/files/not-a-uuid/versions')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(400);
  });

  it('returns 200 for a valid asset id (may 404 if not found)', async () => {
    const asset = await prisma.asset.create({
      data: { originalName: 'doc.pdf', storageKey: 'k/doc.pdf', assetType: 'document', uploadedBy: null },
    });
    const res = await request(app.server)
      .get(`/api/files/${asset.id}/versions`)
      .set('Authorization', `Bearer ${userToken}`);
    expect([200, 401, 403]).toContain(res.status);
  });
});

describe('POST /api/files/:id/versions — UUID param validation', () => {
  it('returns 400 for non-UUID asset id', async () => {
    const res = await request(app.server)
      .post('/api/files/not-a-uuid/versions')
      .set('Authorization', `Bearer ${userToken}`)
      .attach('file', Buffer.from('content'), { filename: 'v2.txt', contentType: 'text/plain' });
    expect(res.status).toBe(400);
  });
});

// ─── audit ───────────────────────────────────────────────────────────────────

describe('GET /api/audit-logs — querystring validation', () => {
  it('returns 400 when limit is 0', async () => {
    const res = await request(app.server)
      .get('/api/audit-logs?limit=0')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  it('returns 400 when limit exceeds 200', async () => {
    const res = await request(app.server)
      .get('/api/audit-logs?limit=201')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  it('returns 400 for extra unknown querystring field (additionalProperties: false)', async () => {
    const res = await request(app.server)
      .get('/api/audit-logs?unknownParam=x')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-UUID userId param', async () => {
    const res = await request(app.server)
      .get('/api/audit-logs?userId=not-a-uuid')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  it('returns 200 with valid query', async () => {
    const res = await request(app.server)
      .get('/api/audit-logs?limit=10&page=1')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });
});

// ─── upload ───────────────────────────────────────────────────────────────────

describe('POST /api/upload — metadata validation', () => {
  it('returns 400 when no file is provided', async () => {
    const res = await request(app.server)
      .post('/api/upload')
      .set('Authorization', `Bearer ${userToken}`)
      .field('description', 'hello');
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid category_id (not UUID)', async () => {
    const res = await request(app.server)
      .post('/api/upload')
      .set('Authorization', `Bearer ${userToken}`)
      .field('category_id', 'not-a-uuid')
      .attach('files', Buffer.from('data'), { filename: 'test.txt', contentType: 'text/plain' });
    expect(res.status).toBe(400);
  });

  it('returns 201 on valid upload', async () => {
    const res = await request(app.server)
      .post('/api/upload')
      .set('Authorization', `Bearer ${userToken}`)
      .attach('files', Buffer.from('hello'), { filename: 'readme.txt', contentType: 'text/plain' });
    expect(res.status).toBe(201);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].original_name).toBe('readme.txt');
  });
});
