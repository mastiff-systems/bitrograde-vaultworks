/**
 * MAS-804: More than 10 files in one multipart request makes @fastify/multipart
 * throw FST_FILES_LIMIT *after* the first 10 non-image files were already
 * streamed to S3. Before the fix that throw escaped every try/catch in
 * upload.ts, orphaning the streamed objects (no DB rows, no cleanup) and
 * returning a generic failure.
 *
 * These tests pin the fixed behavior: 11 files → 413 with a specific error
 * message, storage.delete called for every streamed object (no orphans),
 * zero asset rows; exactly 10 files → 201 with all rows created; a mid-batch
 * DB-insert failure cleans up every not-yet-inserted streamed object.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { FastifyInstance } from 'fastify';
import { buildApp, cleanDb } from './helpers.js';
import { prisma } from '../db/client.js';
import { getStorageProvider } from '../storage/index.js';

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

describe('Upload files-count limit (MAS-804)', () => {
  let app: FastifyInstance;
  let token: string;
  let storage: { streamUpload: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };

  beforeAll(async () => {
    app = await buildApp();
    storage = (await getStorageProvider()) as unknown as typeof storage;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanDb();
    storage.streamUpload.mockClear();
    storage.delete.mockClear();

    const res = await request(app.server)
      .post('/api/auth/register')
      .send({ email: 'filecountqa@example.com', password: 'password123' });
    token = res.body.token;
  });

  function attachN(req: request.Test, n: number): request.Test {
    for (let i = 0; i < n; i++) {
      req.attach('files', Buffer.from(`ase-content-${i}`), {
        filename: `sprite-${i}.ase`,
        contentType: 'application/octet-stream',
      });
    }
    return req;
  }

  it('rejects 11 files with 413, cleans up every streamed S3 object, creates no rows', async () => {
    const res = await attachN(
      request(app.server).post('/api/upload').set('Authorization', `Bearer ${token}`),
      11,
    );

    expect(res.status).toBe(413);
    expect(res.body.error).toBe('Too many files — maximum 10 per upload.');

    // The first 10 non-image files were streamed to S3 before the limit threw;
    // every one of them must have been deleted again — no orphans.
    const streamedKeys = storage.streamUpload.mock.calls.map((c) => c[0] as string);
    expect(streamedKeys).toHaveLength(10);
    const deletedKeys = storage.delete.mock.calls.map((c) => c[0] as string);
    expect([...deletedKeys].sort()).toEqual([...streamedKeys].sort());

    expect(await prisma.asset.count()).toBe(0);
  });

  it('accepts exactly 10 files with 201 and creates all rows', async () => {
    const res = await attachN(
      request(app.server).post('/api/upload').set('Authorization', `Bearer ${token}`),
      10,
    );

    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(10);
    expect(storage.delete).not.toHaveBeenCalled();
    expect(await prisma.asset.count()).toBe(10);
  });

  it('cleans up not-yet-inserted streamed objects when a DB insert fails mid-batch', async () => {
    // Fail the 2nd asset insert. NOTE: do not mockRestore() a spy on a Prisma
    // proxy delegate — it deletes the method; re-point at the bound original.
    const realCreate = prisma.asset.create.bind(prisma.asset);
    let calls = 0;
    const spy = vi.spyOn(prisma.asset, 'create').mockImplementation(((args: unknown) => {
      calls += 1;
      if (calls === 2) return Promise.reject(new Error('simulated insert failure'));
      return realCreate(args as Parameters<typeof realCreate>[0]);
    }) as typeof prisma.asset.create);

    try {
      const res = await attachN(
        request(app.server).post('/api/upload').set('Authorization', `Bearer ${token}`),
        3,
      );

      expect(res.status).toBe(500);
      // Insert 1 succeeded; inserts 2 and 3 never landed — their S3 objects
      // (streamed before the DB loop) must both be deleted, and only those.
      const streamedKeys = storage.streamUpload.mock.calls.map((c) => c[0] as string);
      expect(streamedKeys).toHaveLength(3);
      const deletedKeys = storage.delete.mock.calls.map((c) => c[0] as string);
      expect([...deletedKeys].sort()).toEqual(streamedKeys.slice(1).sort());
      expect(await prisma.asset.count()).toBe(1);
    } finally {
      spy.mockImplementation(realCreate as typeof prisma.asset.create);
    }
  });
});
