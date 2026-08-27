import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../app.js';
import { buildApp, cleanDb } from './helpers.js';
import { prisma } from '../db/client.js';

vi.mock('../services/email.service.js', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

import { sendEmail } from '../services/email.service.js';
const mockSendEmail = vi.mocked(sendEmail);

/** Rebuild app with real rate limits active (mirrors the pattern in security.test.ts). */
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

/** Pull the raw reset token out of the (mocked) email text. */
function extractTokenFromEmail(callIndex = 0): string {
  const opts = mockSendEmail.mock.calls[callIndex][0];
  const match = opts.text.match(/token=([a-f0-9]+)/);
  if (!match) throw new Error(`No token found in mock email body: ${opts.text}`);
  return match[1];
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await cleanDb();
  mockSendEmail.mockClear();
});

// ─── POST /api/auth/forgot-password ──────────────────────────────────────────

describe('POST /api/auth/forgot-password', () => {
  it('returns 200 with the same message for a registered email', async () => {
    await request(app.server)
      .post('/api/auth/register')
      .send({ email: 'user@example.com', password: 'password123' });

    const res = await request(app.server)
      .post('/api/auth/forgot-password')
      .send({ email: 'user@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/If that email exists/i);
  });

  it('returns the same 200 response for an unregistered email (no enumeration)', async () => {
    const res = await request(app.server)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/If that email exists/i);
  });

  it('stores a sha256-hashed token — raw token is NOT stored in the DB', async () => {
    await request(app.server)
      .post('/api/auth/register')
      .send({ email: 'user@example.com', password: 'password123' });

    await request(app.server)
      .post('/api/auth/forgot-password')
      .send({ email: 'user@example.com' });

    expect(mockSendEmail).toHaveBeenCalledOnce();
    const rawToken = extractTokenFromEmail();

    const user = await prisma.user.findUnique({
      where: { email: 'user@example.com' },
      select: { passwordResetToken: true },
    });

    const expectedHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    expect(user?.passwordResetToken).not.toBe(rawToken);
    expect(user?.passwordResetToken).toBe(expectedHash);
  });

  it('timing: both registered and unregistered emails respond in >= 300ms', async () => {
    await request(app.server)
      .post('/api/auth/register')
      .send({ email: 'timing@example.com', password: 'password123' });

    const t0 = Date.now();
    await request(app.server)
      .post('/api/auth/forgot-password')
      .send({ email: 'timing@example.com' });
    const existingMs = Date.now() - t0;

    const t1 = Date.now();
    await request(app.server)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody-timing@example.com' });
    const missingMs = Date.now() - t1;

    expect(existingMs).toBeGreaterThanOrEqual(290);
    expect(missingMs).toBeGreaterThanOrEqual(290);
    expect(Math.abs(existingMs - missingMs)).toBeLessThan(200);
  }, 5000);

  it('token expires after 1 hour: reset attempt fails when expiry is in the past', async () => {
    await request(app.server)
      .post('/api/auth/register')
      .send({ email: 'user@example.com', password: 'password123' });

    await request(app.server)
      .post('/api/auth/forgot-password')
      .send({ email: 'user@example.com' });

    const rawToken = extractTokenFromEmail();

    // Back-date the expiry to simulate a token that has timed out
    await prisma.user.update({
      where: { email: 'user@example.com' },
      data: { passwordResetExpiresAt: new Date(Date.now() - 1000) },
    });

    const res = await request(app.server)
      .post('/api/auth/reset-password')
      .send({ token: rawToken, password: 'newpassword123' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid or expired reset token/i);
  });
});

describe('Rate limit: POST /api/auth/forgot-password (max 5 / minute)', () => {
  let rateLimitedApp: FastifyInstance;

  beforeAll(async () => {
    await cleanDb();
    rateLimitedApp = await buildRateLimitedApp();
  });

  afterAll(async () => {
    await rateLimitedApp.close();
  });

  it('returns 429 on the 6th request within a minute', async () => {
    for (let i = 0; i < 5; i++) {
      await request(rateLimitedApp.server)
        .post('/api/auth/forgot-password')
        .send({ email: `ratelimit${i}@example.com` });
    }

    const res = await request(rateLimitedApp.server)
      .post('/api/auth/forgot-password')
      .send({ email: 'ratelimit5@example.com' });

    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  });
});

// ─── POST /api/auth/reset-password ───────────────────────────────────────────

describe('POST /api/auth/reset-password', () => {
  /** Register a user, trigger forgot-password, and return the raw token from the email. */
  async function registerAndForgot(email: string): Promise<string> {
    await request(app.server)
      .post('/api/auth/register')
      .send({ email, password: 'password123' });
    await request(app.server)
      .post('/api/auth/forgot-password')
      .send({ email });
    return extractTokenFromEmail(mockSendEmail.mock.calls.length - 1);
  }

  it('resets the password with a valid token and allows login with the new password', async () => {
    const rawToken = await registerAndForgot('user@example.com');

    const res = await request(app.server)
      .post('/api/auth/reset-password')
      .send({ token: rawToken, password: 'newpassword123' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/Password has been reset/i);

    const loginRes = await request(app.server)
      .post('/api/auth/login')
      .send({ email: 'user@example.com', password: 'newpassword123' });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.token).toBeTruthy();
  });

  it('token is single-use: second attempt with the same token returns 400', async () => {
    const rawToken = await registerAndForgot('user@example.com');

    await request(app.server)
      .post('/api/auth/reset-password')
      .send({ token: rawToken, password: 'newpassword123' });

    const res = await request(app.server)
      .post('/api/auth/reset-password')
      .send({ token: rawToken, password: 'anotherpassword123' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid or expired reset token/i);
  });

  it('expired token returns 400', async () => {
    const rawToken = await registerAndForgot('user@example.com');

    await prisma.user.update({
      where: { email: 'user@example.com' },
      data: { passwordResetExpiresAt: new Date(Date.now() - 1000) },
    });

    const res = await request(app.server)
      .post('/api/auth/reset-password')
      .send({ token: rawToken, password: 'newpassword123' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid or expired reset token/i);
  });

  it('malformed or non-existent token returns 400', async () => {
    const res = await request(app.server)
      .post('/api/auth/reset-password')
      .send({ token: 'notavalidtoken', password: 'newpassword123' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid or expired reset token/i);
  });
});

describe('Rate limit: POST /api/auth/reset-password (max 5 / minute)', () => {
  let rateLimitedApp: FastifyInstance;

  beforeAll(async () => {
    await cleanDb();
    rateLimitedApp = await buildRateLimitedApp();
  });

  afterAll(async () => {
    await rateLimitedApp.close();
  });

  it('returns 429 on the 6th request within a minute', async () => {
    for (let i = 0; i < 5; i++) {
      await request(rateLimitedApp.server)
        .post('/api/auth/reset-password')
        .send({ token: `faketoken${i}`, password: 'newpassword123' });
    }

    const res = await request(rateLimitedApp.server)
      .post('/api/auth/reset-password')
      .send({ token: 'faketoken5', password: 'newpassword123' });

    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  });
});
