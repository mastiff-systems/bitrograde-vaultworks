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
    // Drain the stream so the multipart parser can advance to the next part,
    // mimicking what the real S3 Upload does when it consumes the body.
    streamUpload: vi.fn().mockImplementation((_key: string, body: NodeJS.ReadableStream) =>
      new Promise<void>((resolve, reject) => {
        body.resume();
        body.on('end', resolve);
        body.on('error', reject);
      }),
    ),
    download: vi.fn().mockResolvedValue({
      stream: Buffer.from(''),
      contentType: 'application/octet-stream',
      contentLength: 0,
    }),
    delete: vi.fn().mockResolvedValue(undefined),
    copy: vi.fn().mockResolvedValue(undefined),
  }),
  invalidateStorageCache: vi.fn(),
}));

// Minimal valid 1×1 RGB PNG for thumbnail generation testing
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
);

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
    .send({ email: 'uploader@example.com', password: 'password123' });
  token = res.body.token;
});

describe('POST /api/upload', () => {
  it('uploads a text file and returns asset record', async () => {
    const res = await request(app.server)
      .post('/api/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', Buffer.from('hello world'), {
        filename: 'hello.txt',
        contentType: 'text/plain',
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].original_name).toBe('hello.txt');
    expect(res.body[0].asset_type).toBe('document');
    expect(res.body[0].id).toBeTruthy();
  });

  it('persists asset to database', async () => {
    const res = await request(app.server)
      .post('/api/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', Buffer.from('content'), {
        filename: 'doc.txt',
        contentType: 'text/plain',
      });

    const asset = await prisma.asset.findUnique({ where: { id: res.body[0].id } });
    expect(asset).not.toBeNull();
    expect(asset!.originalName).toBe('doc.txt');
  });

  it('detects audio asset type by extension', async () => {
    const res = await request(app.server)
      .post('/api/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', Buffer.from('audio-data'), {
        filename: 'track.mp3',
        contentType: 'audio/mpeg',
      });

    expect(res.status).toBe(201);
    expect(res.body[0].asset_type).toBe('audio');
  });

  it('detects 3d model asset type by extension', async () => {
    const res = await request(app.server)
      .post('/api/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', Buffer.from('model-data'), {
        filename: 'scene.glb',
        contentType: 'model/gltf-binary',
      });

    expect(res.status).toBe(201);
    expect(res.body[0].asset_type).toBe('3d');
  });

  it('generates thumbnail for image uploads', async () => {
    const res = await request(app.server)
      .post('/api/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', TINY_PNG, {
        filename: 'photo.png',
        contentType: 'image/png',
      });

    expect(res.status).toBe(201);
    expect(res.body[0].asset_type).toBe('image');
    expect(res.body[0].thumbnail_key).toBeTruthy();
  });

  it('uploads multiple files in one request', async () => {
    const res = await request(app.server)
      .post('/api/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', Buffer.from('file1'), { filename: 'a.txt', contentType: 'text/plain' })
      .attach('files', Buffer.from('file2'), { filename: 'b.txt', contentType: 'text/plain' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(2);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app.server)
      .post('/api/upload')
      .attach('files', Buffer.from('data'), { filename: 'x.txt', contentType: 'text/plain' });

    expect(res.status).toBe(401);
  });

  // MAS-349: keep-both auto-rename
  describe('auto-rename on duplicate filename (keep-both path)', () => {
    it('renames duplicate to -Copy variant on second upload', async () => {
      // First upload — no conflict, name unchanged
      const first = await request(app.server)
        .post('/api/upload')
        .set('Authorization', `Bearer ${token}`)
        .attach('files', Buffer.from('v1'), { filename: 'photo.jpg', contentType: 'image/jpeg' });
      expect(first.status).toBe(201);
      expect(first.body[0].original_name).toBe('photo.jpg');

      // Second upload — same filename, should be renamed to photo-Copy.jpg
      const second = await request(app.server)
        .post('/api/upload')
        .set('Authorization', `Bearer ${token}`)
        .attach('files', Buffer.from('v2'), { filename: 'photo.jpg', contentType: 'image/jpeg' });
      expect(second.status).toBe(201);
      expect(second.body[0].original_name).toBe('photo-Copy.jpg');
    });

    it('renames to (2) variant when -Copy is also taken', async () => {
      // Upload original, then -Copy, then the same name again → should get (2)
      for (const name of ['photo.jpg', 'photo-Copy.jpg']) {
        await request(app.server)
          .post('/api/upload')
          .set('Authorization', `Bearer ${token}`)
          .attach('files', Buffer.from('data'), { filename: name, contentType: 'image/jpeg' });
      }

      const third = await request(app.server)
        .post('/api/upload')
        .set('Authorization', `Bearer ${token}`)
        .attach('files', Buffer.from('v3'), { filename: 'photo.jpg', contentType: 'image/jpeg' });
      expect(third.status).toBe(201);
      expect(third.body[0].original_name).toBe('photo (2).jpg');
    });

    it('renames two same-named files within a single batch upload', async () => {
      // Both arrive in the same multipart request — second should get -Copy
      const res = await request(app.server)
        .post('/api/upload')
        .set('Authorization', `Bearer ${token}`)
        .attach('files', Buffer.from('a'), { filename: 'doc.txt', contentType: 'text/plain' })
        .attach('files', Buffer.from('b'), { filename: 'doc.txt', contentType: 'text/plain' });

      expect(res.status).toBe(201);
      expect(res.body).toHaveLength(2);
      const names = res.body.map((r: { original_name: string }) => r.original_name);
      expect(names).toContain('doc.txt');
      expect(names).toContain('doc-Copy.txt');
    });

    it('persists the renamed asset to the database with the resolved name', async () => {
      // Seed an existing asset
      await request(app.server)
        .post('/api/upload')
        .set('Authorization', `Bearer ${token}`)
        .attach('files', Buffer.from('original'), { filename: 'asset.png', contentType: 'image/png' });

      const res = await request(app.server)
        .post('/api/upload')
        .set('Authorization', `Bearer ${token}`)
        .attach('files', Buffer.from('duplicate'), { filename: 'asset.png', contentType: 'image/png' });

      expect(res.status).toBe(201);
      const id = res.body[0].id;
      const record = await prisma.asset.findUnique({ where: { id } });
      expect(record).not.toBeNull();
      expect(record!.originalName).toBe('asset-Copy.png');
    });
  });

  // --- MIME type category mismatch (MAS-429) ---

  describe('MIME type category mismatch warnings', () => {
    it('returns X-Category-Mismatch: true header when file MIME is not in the category allowed list', async () => {
      const cat = await prisma.category.create({
        data: { name: 'VideoOnly', slug: 'video-only', allowedMimeTypes: ['video/mp4', 'video/webm'] },
      });

      const res = await request(app.server)
        .post('/api/upload')
        .set('Authorization', `Bearer ${token}`)
        .field('category_id', cat.id)
        .attach('files', Buffer.from('audio-data'), { filename: 'track.mp3', contentType: 'audio/mpeg' });

      expect(res.status).toBe(201);
      expect(res.headers['x-category-mismatch']).toBe('true');
    });

    it('does not return X-Category-Mismatch header when file MIME matches the category allowed list', async () => {
      const cat = await prisma.category.create({
        data: { name: 'AudioOnly', slug: 'audio-only', allowedMimeTypes: ['audio/mpeg', 'audio/wav'] },
      });

      const res = await request(app.server)
        .post('/api/upload')
        .set('Authorization', `Bearer ${token}`)
        .field('category_id', cat.id)
        .attach('files', Buffer.from('audio-data'), { filename: 'track.mp3', contentType: 'audio/mpeg' });

      expect(res.status).toBe(201);
      expect(res.headers['x-category-mismatch']).toBeUndefined();
    });

    it('upload with MIME mismatch still returns 201 with the asset record', async () => {
      const cat = await prisma.category.create({
        data: { name: 'DocsOnly', slug: 'docs-only', allowedMimeTypes: ['application/pdf'] },
      });

      const res = await request(app.server)
        .post('/api/upload')
        .set('Authorization', `Bearer ${token}`)
        .field('category_id', cat.id)
        .attach('files', Buffer.from('plain text'), { filename: 'readme.txt', contentType: 'text/plain' });

      expect(res.status).toBe(201);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBeTruthy();
      expect(res.body[0].original_name).toBe('readme.txt');
    });

    it('sets category_mismatch_warning: true on the mismatched asset in the response body', async () => {
      const cat = await prisma.category.create({
        data: { name: 'ScriptsOnly', slug: 'scripts-only', allowedMimeTypes: ['application/javascript'] },
      });

      const res = await request(app.server)
        .post('/api/upload')
        .set('Authorization', `Bearer ${token}`)
        .field('category_id', cat.id)
        .attach('files', Buffer.from('plain text'), { filename: 'note.txt', contentType: 'text/plain' });

      expect(res.status).toBe(201);
      expect(res.body[0].category_mismatch_warning).toBe(true);
    });

    it('does not set category_mismatch_warning when MIME matches', async () => {
      const cat = await prisma.category.create({
        data: { name: 'TextOnly', slug: 'text-only', allowedMimeTypes: ['text/plain'] },
      });

      const res = await request(app.server)
        .post('/api/upload')
        .set('Authorization', `Bearer ${token}`)
        .field('category_id', cat.id)
        .attach('files', Buffer.from('plain text'), { filename: 'note.txt', contentType: 'text/plain' });

      expect(res.status).toBe(201);
      expect(res.body[0].category_mismatch_warning).toBeUndefined();
    });
  });
});
