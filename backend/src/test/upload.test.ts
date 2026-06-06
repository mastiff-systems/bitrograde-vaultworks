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
    expect(res.body[0].asset_type).toBe('3d_model');
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
    expect(res.body[0].asset_type).toBe('texture');
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
});
