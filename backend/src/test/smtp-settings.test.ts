import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { FastifyInstance } from 'fastify';
import { buildApp, cleanDb } from './helpers.js';

vi.mock('../services/email.service.js', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

import { sendEmail } from '../services/email.service.js';
const mockSendEmail = vi.mocked(sendEmail);

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
  mockSendEmail.mockReset();
  mockSendEmail.mockResolvedValue(undefined);

  // First registration becomes admin
  const adminRes = await request(app.server)
    .post('/api/auth/register')
    .send({ email: 'admin@example.com', password: 'password123' });
  adminToken = adminRes.body.token;

  // Second registration is a regular user
  const userRes = await request(app.server)
    .post('/api/auth/register')
    .send({ email: 'user@example.com', password: 'password123' });
  userToken = userRes.body.token;
});

// ─── GET /api/settings/smtp ───────────────────────────────────────────────────

describe('GET /api/settings/smtp', () => {
  it('returns masked settings — smtp_password is never returned in plaintext', async () => {
    // Seed a password via POST first so the GET has something to mask
    await request(app.server)
      .post('/api/settings/smtp')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ smtp_host: 'smtp.example.com', smtp_password: 'secret123' });

    const res = await request(app.server)
      .get('/api/settings/smtp')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.smtp_password).not.toBe('secret123');
    expect(res.body.smtp_password).toBe('••••••••');
  });

  it('returns 401 when no token is provided', async () => {
    const res = await request(app.server).get('/api/settings/smtp');
    expect(res.status).toBe(401);
  });

  it('returns 403 when a non-admin user calls the endpoint', async () => {
    const res = await request(app.server)
      .get('/api/settings/smtp')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });
});

// ─── POST /api/settings/smtp ──────────────────────────────────────────────────

describe('POST /api/settings/smtp', () => {
  it('persists settings and returns them masked', async () => {
    const res = await request(app.server)
      .post('/api/settings/smtp')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        smtp_host: 'mail.example.com',
        smtp_port: '587',
        smtp_username: 'mailuser',
        smtp_password: 'realpassword',
        smtp_from_address: 'noreply@example.com',
        smtp_encryption: 'starttls',
      });

    expect(res.status).toBe(200);
    expect(res.body.smtp_host).toBe('mail.example.com');
    expect(res.body.smtp_port).toBe('587');
    expect(res.body.smtp_username).toBe('mailuser');
    expect(res.body.smtp_from_address).toBe('noreply@example.com');
    expect(res.body.smtp_encryption).toBe('starttls');
    // Password is masked in response
    expect(res.body.smtp_password).toBe('••••••••');
    expect(res.body.smtp_password).not.toBe('realpassword');
  });

  it('does NOT overwrite an existing password when the masked sentinel is submitted', async () => {
    // Set a real password first
    await request(app.server)
      .post('/api/settings/smtp')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ smtp_host: 'mail.example.com', smtp_password: 'originalpassword' });

    // Re-POST with the masked sentinel (simulating the UI sending back what GET returned)
    const res = await request(app.server)
      .post('/api/settings/smtp')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ smtp_host: 'updated.example.com', smtp_password: '••••••••' });

    expect(res.status).toBe(200);
    expect(res.body.smtp_host).toBe('updated.example.com');
    // Masked sentinel in response confirms the password was preserved (not wiped)
    expect(res.body.smtp_password).toBe('••••••••');

    // Verify via GET that the password is still there (masked, not empty)
    const getRes = await request(app.server)
      .get('/api/settings/smtp')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(getRes.body.smtp_password).toBe('••••••••');
  });

  it('returns 401 when no token is provided', async () => {
    const res = await request(app.server)
      .post('/api/settings/smtp')
      .send({ smtp_host: 'mail.example.com' });
    expect(res.status).toBe(401);
  });

  it('returns 403 when a non-admin user calls the endpoint', async () => {
    const res = await request(app.server)
      .post('/api/settings/smtp')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ smtp_host: 'mail.example.com' });
    expect(res.status).toBe(403);
  });
});

// ─── POST /api/settings/smtp/test ────────────────────────────────────────────

describe('POST /api/settings/smtp/test', () => {
  it('returns { success: true } when sendEmail resolves', async () => {
    mockSendEmail.mockResolvedValue(undefined);

    const res = await request(app.server)
      .post('/api/settings/smtp/test')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockSendEmail).toHaveBeenCalledOnce();
    // Test email should be sent to the admin's email address
    expect(mockSendEmail.mock.calls[0][0].to).toBe('admin@example.com');
  });

  it('returns { success: false, error: "..." } and HTTP 200 when sendEmail throws', async () => {
    mockSendEmail.mockRejectedValue(new Error('Connection refused'));

    const res = await request(app.server)
      .post('/api/settings/smtp/test')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Connection refused');
  });

  it('returns 401 when no token is provided', async () => {
    const res = await request(app.server).post('/api/settings/smtp/test');
    expect(res.status).toBe(401);
  });

  it('returns 403 when a non-admin user calls the endpoint', async () => {
    const res = await request(app.server)
      .post('/api/settings/smtp/test')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });
});
