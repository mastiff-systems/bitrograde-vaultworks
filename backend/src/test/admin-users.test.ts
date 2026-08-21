import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { FastifyInstance } from 'fastify';
import { buildApp, cleanDb } from './helpers.js';
import { prisma } from '../db/client.js';

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

  // Create admin (first user)
  const adminReg = await request(app.server)
    .post('/api/auth/register')
    .send({ email: 'admin@example.com', password: 'adminpass123' });
  adminToken = adminReg.body.token;

  // Create regular user
  const userReg = await request(app.server)
    .post('/api/auth/register')
    .send({ email: 'user@example.com', password: 'userpass123' });
  userToken = userReg.body.token;
});

describe('POST /api/admin/users', () => {
  it('happy path: admin creates user → 201, correct fields, mustChangePassword: true', async () => {
    const res = await request(app.server)
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'newuser@example.com', password: 'newpass123' });

    expect(res.status).toBe(201);
    expect(res.body.email).toBe('newuser@example.com');
    expect(res.body.role).toBe('user');
    expect(res.body.mustChangePassword).toBe(true);
    expect(res.body.id).toBeTruthy();
    expect(res.body.created_at).toBeTruthy();
    expect(res.body.passwordHash).toBeUndefined();
    expect(res.body.token).toBeUndefined();
  });

  it('creates user with admin role when specified', async () => {
    const res = await request(app.server)
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'newadmin@example.com', password: 'newpass123', role: 'admin' });

    expect(res.status).toBe(201);
    expect(res.body.role).toBe('admin');
    expect(res.body.mustChangePassword).toBe(true);
  });

  it('returns 400 on invalid email', async () => {
    const res = await request(app.server)
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'not-an-email', password: 'validpass123' });

    expect(res.status).toBe(400);
  });

  it('returns 400 on password shorter than 8 chars', async () => {
    const res = await request(app.server)
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'shortpw@example.com', password: 'short' });

    expect(res.status).toBe(400);
  });

  it('returns 403 when called by a non-admin user', async () => {
    const res = await request(app.server)
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ email: 'forbidden@example.com', password: 'validpass123' });

    expect(res.status).toBe(403);
  });

  it('returns 401 when called without token', async () => {
    const res = await request(app.server)
      .post('/api/admin/users')
      .send({ email: 'unauth@example.com', password: 'validpass123' });

    expect(res.status).toBe(401);
  });

  it('returns 409 on duplicate email', async () => {
    await request(app.server)
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'dup@example.com', password: 'validpass123' });

    const res = await request(app.server)
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'dup@example.com', password: 'anotherpass123' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already registered/i);
  });

  it('writes a USER_CREATED audit log entry on successful user creation', async () => {
    const res = await request(app.server)
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'audited@example.com', password: 'validpass123' });

    expect(res.status).toBe(201);

    // Allow the fire-and-forget audit write to complete
    await new Promise((r) => setTimeout(r, 50));

    const log = await prisma.auditLog.findFirst({
      where: { action: 'USER_CREATED' },
    });

    expect(log).not.toBeNull();
    expect((log!.details as Record<string, unknown>).createdUserId).toBe(res.body.id);
  });
});

describe('POST /api/auth/login mustChangePassword', () => {
  it('login response includes mustChangePassword: false for self-registered user', async () => {
    const res = await request(app.server)
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'adminpass123' });

    expect(res.status).toBe(200);
    expect(res.body.user.mustChangePassword).toBe(false);
  });

  it('login response includes mustChangePassword: true for admin-created user', async () => {
    await request(app.server)
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'created@example.com', password: 'createdpass123' });

    const res = await request(app.server)
      .post('/api/auth/login')
      .send({ email: 'created@example.com', password: 'createdpass123' });

    expect(res.status).toBe(200);
    expect(res.body.user.mustChangePassword).toBe(true);
  });
});
