import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../app.js';
import { buildApp, cleanDb } from './helpers.js';

vi.mock('../storage/s3.js', () => ({
  uploadToS3: vi.fn().mockResolvedValue(undefined),
  deleteFromS3: vi.fn().mockResolvedValue(undefined),
  getS3ObjectStream: vi.fn().mockResolvedValue({
    stream: Buffer.from(''),
    contentType: 'application/octet-stream',
    contentLength: 0,
  }),
}));

/**
 * Build an app with rate limiting active. The normal test env disables rate
 * limiting (NODE_ENV=test) and raises per-route limits to 10000 (VITEST=1).
 * We temporarily clear both so createApp() registers the plugin with real limits.
 */
async function buildRateLimitedApp(): Promise<FastifyInstance> {
  const savedNodeEnv = process.env.NODE_ENV;
  const savedVitest = process.env.VITEST;

  process.env.NODE_ENV = 'development';
  delete process.env.VITEST;

  try {
    const app = await createApp();
    await app.listen({ port: 0 });
    return app;
  } finally {
    if (savedNodeEnv !== undefined) {
      process.env.NODE_ENV = savedNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
    if (savedVitest !== undefined) {
      process.env.VITEST = savedVitest;
    }
  }
}

// ─── Helmet headers ───────────────────────────────────────────────────────────

describe('Security headers (helmet)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('sets x-content-type-options: nosniff on every response', async () => {
    const res = await request(app.server).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('sets x-frame-options: SAMEORIGIN on every response', async () => {
    const res = await request(app.server).get('/health');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
  });
});

// ─── Rate limit – login ───────────────────────────────────────────────────────

describe('Rate limit: POST /api/auth/login (max 10 / minute)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await cleanDb();
    app = await buildRateLimitedApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 429 with retry-after header on the 11th request within a minute', async () => {
    for (let i = 0; i < 10; i++) {
      await request(app.server)
        .post('/api/auth/login')
        .send({ email: 'ratelimit@example.com', password: 'wrongpassword' });
    }

    const res = await request(app.server)
      .post('/api/auth/login')
      .send({ email: 'ratelimit@example.com', password: 'wrongpassword' });

    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  });
});

// ─── Rate limit – register ────────────────────────────────────────────────────

describe('Rate limit: POST /api/auth/register (max 5 / minute)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await cleanDb();
    app = await buildRateLimitedApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 429 on the 6th request within a minute', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app.server)
        .post('/api/auth/register')
        .send({ email: `ratelimit${i}@example.com`, password: 'password123' });
    }

    const res = await request(app.server)
      .post('/api/auth/register')
      .send({ email: 'ratelimit5@example.com', password: 'password123' });

    expect(res.status).toBe(429);
  });
});

// ─── Rate limit – upload ───────────────────────────────────────────────────────

describe('Rate limit: POST /api/upload (max 20 / minute)', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    await cleanDb();
    app = await buildRateLimitedApp();
    const regRes = await request(app.server)
      .post('/api/auth/register')
      .send({ email: 'ratelimit-upload@example.com', password: 'password123' });
    token = regRes.body.token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 429 with retry-after header on the 21st request within a minute', async () => {
    let lastUnderLimitStatus: number | undefined;
    for (let i = 0; i < 20; i++) {
      const r = await request(app.server)
        .post('/api/upload')
        .set('Authorization', `Bearer ${token}`)
        .attach('files', Buffer.from('test'), { filename: 'test.txt', contentType: 'text/plain' });
      lastUnderLimitStatus = r.status;
    }
    // Requests under the limit must not be rate-limited
    expect(lastUnderLimitStatus).not.toBe(429);

    const res = await request(app.server)
      .post('/api/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', Buffer.from('test'), { filename: 'test.txt', contentType: 'text/plain' });

    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  });
});

// ─── CORS production fail-fast ────────────────────────────────────────────────

describe('CORS production fail-fast', () => {
  it('throws when NODE_ENV=production and CORS_ORIGIN is not set', async () => {
    const savedNodeEnv = process.env.NODE_ENV;
    const savedCorsOrigin = process.env.CORS_ORIGIN;

    process.env.NODE_ENV = 'production';
    delete process.env.CORS_ORIGIN;

    try {
      await expect(createApp()).rejects.toThrow(/CORS_ORIGIN/);
    } finally {
      if (savedNodeEnv !== undefined) {
        process.env.NODE_ENV = savedNodeEnv;
      } else {
        delete process.env.NODE_ENV;
      }
      if (savedCorsOrigin !== undefined) {
        process.env.CORS_ORIGIN = savedCorsOrigin;
      }
    }
  });

  it('does not throw when NODE_ENV=production and CORS_ORIGIN is set', async () => {
    const savedNodeEnv = process.env.NODE_ENV;
    const savedCorsOrigin = process.env.CORS_ORIGIN;

    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN = 'http://example.com';

    let app: FastifyInstance | undefined;
    try {
      app = await createApp();
      expect(app).toBeDefined();
    } finally {
      if (app) await app.close();
      if (savedNodeEnv !== undefined) {
        process.env.NODE_ENV = savedNodeEnv;
      } else {
        delete process.env.NODE_ENV;
      }
      if (savedCorsOrigin !== undefined) {
        process.env.CORS_ORIGIN = savedCorsOrigin;
      } else {
        delete process.env.CORS_ORIGIN;
      }
    }
  });
});
