import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { FastifyInstance } from 'fastify';
import { buildApp, cleanDb } from './helpers.js';
import { prisma } from '../db/client.js';

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
    .send({ email: 'taxonomy@example.com', password: 'password123' });
  token = res.body.token;
});

// --- GET /api/categories ---

describe('GET /api/categories', () => {
  it('returns empty array when no categories exist', async () => {
    const res = await request(app.server)
      .get('/api/categories')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns categories with nested subcategories', async () => {
    const cat = await prisma.category.create({ data: { name: 'Graphics', slug: 'graphics' } });
    await prisma.subcategory.create({ data: { categoryId: cat.id, name: 'Icons', slug: 'icons' } });
    await prisma.subcategory.create({ data: { categoryId: cat.id, name: 'Backgrounds', slug: 'backgrounds' } });

    const res = await request(app.server)
      .get('/api/categories')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Graphics');
    expect(res.body[0].slug).toBe('graphics');
    expect(res.body[0].subcategories).toHaveLength(2);
    expect(res.body[0].subcategories[0].name).toBe('Backgrounds'); // sorted by name asc
    expect(res.body[0].subcategories[1].name).toBe('Icons');
  });
});

// --- POST /api/categories ---

describe('POST /api/categories', () => {
  it('creates a category with explicit slug', async () => {
    const res = await request(app.server)
      .post('/api/categories')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Photos', slug: 'photos' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Photos');
    expect(res.body.slug).toBe('photos');
    expect(res.body.subcategories).toEqual([]);
  });

  it('auto-generates slug from name', async () => {
    const res = await request(app.server)
      .post('/api/categories')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Textures & Materials' });
    expect(res.status).toBe(201);
    expect(res.body.slug).toBe('textures-materials');
  });

  it('returns 409 on duplicate name', async () => {
    await prisma.category.create({ data: { name: 'Audio', slug: 'audio' } });
    const res = await request(app.server)
      .post('/api/categories')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Audio' });
    expect(res.status).toBe(409);
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app.server)
      .post('/api/categories')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });
});

// --- PATCH /api/categories/:id ---

describe('PATCH /api/categories/:id', () => {
  it('updates category name', async () => {
    const cat = await prisma.category.create({ data: { name: 'Old Name', slug: 'old-name' } });
    const res = await request(app.server)
      .patch(`/api/categories/${cat.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'New Name' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('New Name');
    expect(res.body.slug).toBe('old-name'); // unchanged
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app.server)
      .patch('/api/categories/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'X' });
    expect(res.status).toBe(404);
  });
});

// --- DELETE /api/categories/:id ---

describe('DELETE /api/categories/:id', () => {
  it('deletes category and cascades to subcategories', async () => {
    const cat = await prisma.category.create({ data: { name: 'Temp', slug: 'temp' } });
    await prisma.subcategory.create({ data: { categoryId: cat.id, name: 'Sub', slug: 'sub' } });

    const res = await request(app.server)
      .delete(`/api/categories/${cat.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);

    const remaining = await prisma.subcategory.count({ where: { categoryId: cat.id } });
    expect(remaining).toBe(0);
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app.server)
      .delete('/api/categories/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('sets category_id to null on assets (SET NULL)', async () => {
    const cat = await prisma.category.create({ data: { name: 'ToDelete', slug: 'to-delete' } });
    const asset = await prisma.asset.create({
      data: { originalName: 'file.png', storageKey: 'assets/x/file.png', categoryId: cat.id },
    });

    await request(app.server)
      .delete(`/api/categories/${cat.id}`)
      .set('Authorization', `Bearer ${token}`);

    const updated = await prisma.asset.findUnique({ where: { id: asset.id }, select: { categoryId: true } });
    expect(updated?.categoryId).toBeNull();
  });
});

// --- GET /api/categories/:categoryId/subcategories ---

describe('GET /api/categories/:categoryId/subcategories', () => {
  it('returns subcategories for a category', async () => {
    const cat = await prisma.category.create({ data: { name: 'Graphics', slug: 'graphics' } });
    await prisma.subcategory.createMany({
      data: [
        { categoryId: cat.id, name: 'Icons', slug: 'icons' },
        { categoryId: cat.id, name: 'Textures', slug: 'textures' },
      ],
    });

    const res = await request(app.server)
      .get(`/api/categories/${cat.id}/subcategories`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].category_id).toBe(cat.id);
  });

  it('returns 404 for unknown category', async () => {
    const res = await request(app.server)
      .get('/api/categories/00000000-0000-0000-0000-000000000000/subcategories')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

// --- POST /api/categories/:categoryId/subcategories ---

describe('POST /api/categories/:categoryId/subcategories', () => {
  it('creates a subcategory with auto slug', async () => {
    const cat = await prisma.category.create({ data: { name: 'Graphics', slug: 'graphics' } });
    const res = await request(app.server)
      .post(`/api/categories/${cat.id}/subcategories`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'UI Kits' });
    expect(res.status).toBe(201);
    expect(res.body.slug).toBe('ui-kits');
    expect(res.body.category_id).toBe(cat.id);
  });

  it('returns 404 for unknown parent category', async () => {
    const res = await request(app.server)
      .post('/api/categories/00000000-0000-0000-0000-000000000000/subcategories')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Icons' });
    expect(res.status).toBe(404);
  });

  it('returns 409 on slug conflict within category', async () => {
    const cat = await prisma.category.create({ data: { name: 'Graphics', slug: 'graphics' } });
    await prisma.subcategory.create({ data: { categoryId: cat.id, name: 'Icons', slug: 'icons' } });
    const res = await request(app.server)
      .post(`/api/categories/${cat.id}/subcategories`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Icons Again', slug: 'icons' });
    expect(res.status).toBe(409);
  });

  it('allows same slug across different categories', async () => {
    const cat1 = await prisma.category.create({ data: { name: 'Graphics', slug: 'graphics' } });
    const cat2 = await prisma.category.create({ data: { name: 'Photos', slug: 'photos' } });
    await prisma.subcategory.create({ data: { categoryId: cat1.id, name: 'Icons', slug: 'icons' } });
    const res = await request(app.server)
      .post(`/api/categories/${cat2.id}/subcategories`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Icons', slug: 'icons' });
    expect(res.status).toBe(201);
  });
});

// --- PATCH /api/categories/:categoryId/subcategories/:id ---

describe('PATCH /api/categories/:categoryId/subcategories/:id', () => {
  it('updates subcategory name', async () => {
    const cat = await prisma.category.create({ data: { name: 'Graphics', slug: 'graphics' } });
    const sub = await prisma.subcategory.create({ data: { categoryId: cat.id, name: 'Old', slug: 'old' } });

    const res = await request(app.server)
      .patch(`/api/categories/${cat.id}/subcategories/${sub.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Updated' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated');
  });

  it('returns 404 when subcategory does not belong to category', async () => {
    const cat1 = await prisma.category.create({ data: { name: 'Cat1', slug: 'cat1' } });
    const cat2 = await prisma.category.create({ data: { name: 'Cat2', slug: 'cat2' } });
    const sub = await prisma.subcategory.create({ data: { categoryId: cat2.id, name: 'Sub', slug: 'sub' } });

    const res = await request(app.server)
      .patch(`/api/categories/${cat1.id}/subcategories/${sub.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Hacked' });
    expect(res.status).toBe(404);
  });
});

// --- DELETE /api/categories/:categoryId/subcategories/:id ---

describe('DELETE /api/categories/:categoryId/subcategories/:id', () => {
  it('deletes a subcategory', async () => {
    const cat = await prisma.category.create({ data: { name: 'Graphics', slug: 'graphics' } });
    const sub = await prisma.subcategory.create({ data: { categoryId: cat.id, name: 'Icons', slug: 'icons' } });

    const res = await request(app.server)
      .delete(`/api/categories/${cat.id}/subcategories/${sub.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);

    const count = await prisma.subcategory.count({ where: { id: sub.id } });
    expect(count).toBe(0);
  });

  it('returns 404 for unknown subcategory', async () => {
    const cat = await prisma.category.create({ data: { name: 'Graphics', slug: 'graphics' } });
    const res = await request(app.server)
      .delete(`/api/categories/${cat.id}/subcategories/00000000-0000-0000-0000-000000000000`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

// --- GET /api/files with taxonomy filters ---

describe('GET /api/files taxonomy filters', () => {
  it('filters by categoryId', async () => {
    const cat = await prisma.category.create({ data: { name: 'Graphics', slug: 'graphics' } });
    await prisma.asset.create({
      data: { originalName: 'in-cat.png', storageKey: 'a/1/in.png', categoryId: cat.id },
    });
    await prisma.asset.create({
      data: { originalName: 'no-cat.png', storageKey: 'a/2/no.png' },
    });

    const res = await request(app.server)
      .get(`/api/files?categoryId=${cat.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].original_name).toBe('in-cat.png');
  });

  it('filters by format (mime_type prefix)', async () => {
    await prisma.asset.create({
      data: { originalName: 'img.png', storageKey: 'a/3/img.png', mimeType: 'image/png' },
    });
    await prisma.asset.create({
      data: { originalName: 'track.mp3', storageKey: 'a/4/track.mp3', mimeType: 'audio/mpeg' },
    });

    const res = await request(app.server)
      .get('/api/files?format=image')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].original_name).toBe('img.png');
  });

  it('returns taxonomy fields on each asset', async () => {
    const cat = await prisma.category.create({ data: { name: 'Audio', slug: 'audio' } });
    await prisma.asset.create({
      data: {
        originalName: 'track.mp3',
        storageKey: 'a/5/track.mp3',
        categoryId: cat.id,
        license: 'CC-BY',
        resolutionW: null,
        resolutionH: null,
        durationSeconds: 120.5,
      },
    });

    const res = await request(app.server)
      .get('/api/files')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body[0].category_id).toBe(cat.id);
    expect(res.body[0].license).toBe('CC-BY');
    expect(res.body[0].duration_seconds).toBe(120.5);
  });
});
