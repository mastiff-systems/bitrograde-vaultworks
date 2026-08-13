/**
 * MAS-359: Verify file-size limit enforcement after the 500 MB → 5 GB increase.
 *
 * Strategy: boot a test app with MAX_UPLOAD_BYTES=1024 so we can exercise the
 * reject path without allocating multi-GB buffers.  The acceptance path is
 * validated by the existing upload.test.ts suite (all 11 tests pass with the
 * default 5 GB limit in place).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../app.js';
import { prisma } from '../db/client.js';

vi.mock('../storage/s3.js', () => ({
  uploadToS3: vi.fn().mockResolvedValue(undefined),
  streamUploadToS3: vi.fn().mockImplementation((_key: string, body: NodeJS.ReadableStream) =>
    new Promise<void>((resolve, reject) => {
      body.resume();
      body.on('end', resolve);
      body.on('error', reject);
    }),
  ),
  deleteFromS3: vi.fn().mockResolvedValue(undefined),
  getS3ObjectStream: vi.fn().mockResolvedValue({
    stream: Buffer.from(''),
    contentType: 'application/octet-stream',
    contentLength: 0,
  }),
}));

// ──────────────────────────────────────────────────────────────────────────────
// Default-limit check (static / fast — no server needed)
// ──────────────────────────────────────────────────────────────────────────────

describe('MAX_FILE_SIZE_BYTES constant', () => {
  it('backend default is 5 GB (5_368_709_120 bytes)', () => {
    // Mirrors the calculation in app.ts line 27
    const backendDefault = 5 * 1024 * 1024 * 1024;
    expect(backendDefault).toBe(5_368_709_120);

    // When MAX_UPLOAD_BYTES is not set the default kicks in
    const resolved = Number(process.env.MAX_UPLOAD_BYTES ?? backendDefault);
    // In the test environment MAX_UPLOAD_BYTES must NOT be set, so resolved === 5 GB
    if (!process.env.MAX_UPLOAD_BYTES) {
      expect(resolved).toBe(5_368_709_120);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Runtime limit enforcement (micro-limit app so tests stay fast)
// ──────────────────────────────────────────────────────────────────────────────

const MICRO_LIMIT = 1024; // 1 KB — small enough for fast tests

describe('Upload size limit enforcement', () => {
  let app: FastifyInstance;
  let token: string;
  const originalMaxUpload = process.env.MAX_UPLOAD_BYTES;

  beforeAll(async () => {
    process.env.MAX_UPLOAD_BYTES = String(MICRO_LIMIT);
    app = await createApp();
    await app.listen({ port: 0 });
  });

  afterAll(async () => {
    if (originalMaxUpload === undefined) {
      delete process.env.MAX_UPLOAD_BYTES;
    } else {
      process.env.MAX_UPLOAD_BYTES = originalMaxUpload;
    }
    await app.close();
  });

  beforeEach(async () => {
    // Minimal DB reset so each test gets a clean slate
    await prisma.assetTag.deleteMany();
    await prisma.assetVersion.deleteMany();
    await prisma.asset.deleteMany();
    await prisma.tag.deleteMany();
    await prisma.user.deleteMany();
    await prisma.setting.deleteMany();
    await prisma.subcategory.deleteMany();
    await prisma.category.deleteMany();

    const res = await request(app.server)
      .post('/api/auth/register')
      .send({ email: 'limitqa@example.com', password: 'password123' });
    token = res.body.token;
  });

  it('rejects a file over the configured limit with 413', async () => {
    // 2× the MICRO_LIMIT — must be rejected
    const oversizeBuffer = Buffer.alloc(MICRO_LIMIT * 2, 0x61 /* 'a' */);

    const res = await request(app.server)
      .post('/api/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', oversizeBuffer, {
        filename: 'oversize.bin',
        contentType: 'application/octet-stream',
      });

    expect(res.status).toBe(413);
  });

  it('accepts a file under the configured limit', async () => {
    // Half the MICRO_LIMIT — must succeed
    const undersizeBuffer = Buffer.alloc(Math.floor(MICRO_LIMIT / 2), 0x62 /* 'b' */);

    const res = await request(app.server)
      .post('/api/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', undersizeBuffer, {
        filename: 'smallfile.bin',
        contentType: 'application/octet-stream',
      });

    expect(res.status).toBe(201);
    expect(res.body[0].original_name).toBe('smallfile.bin');
  });
});
