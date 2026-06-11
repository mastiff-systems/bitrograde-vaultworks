import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { FastifyInstance } from 'fastify';
import { buildApp, cleanDb } from './helpers.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await cleanDb();
});

describe('POST /api/auth/register', () => {
  it('registers first user as admin', async () => {
    const res = await request(app.server)
      .post('/api/auth/register')
      .send({ email: 'admin@example.com', password: 'password123' });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('admin');
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe('admin@example.com');
  });

  it('registers subsequent users as regular users', async () => {
    await request(app.server)
      .post('/api/auth/register')
      .send({ email: 'first@example.com', password: 'password123' });

    const res = await request(app.server)
      .post('/api/auth/register')
      .send({ email: 'second@example.com', password: 'password123' });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('user');
  });

  it('returns 409 on duplicate email', async () => {
    await request(app.server)
      .post('/api/auth/register')
      .send({ email: 'dup@example.com', password: 'password123' });

    const res = await request(app.server)
      .post('/api/auth/register')
      .send({ email: 'dup@example.com', password: 'password123' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already registered/i);
  });

  it('returns 400 for invalid email', async () => {
    const res = await request(app.server)
      .post('/api/auth/register')
      .send({ email: 'not-an-email', password: 'password123' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for short password', async () => {
    const res = await request(app.server)
      .post('/api/auth/register')
      .send({ email: 'user@example.com', password: 'short' });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await request(app.server)
      .post('/api/auth/register')
      .send({ email: 'login@example.com', password: 'password123' });
  });

  it('returns token on valid credentials', async () => {
    const res = await request(app.server)
      .post('/api/auth/login')
      .send({ email: 'login@example.com', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe('login@example.com');
  });

  it('returns 401 on wrong password', async () => {
    const res = await request(app.server)
      .post('/api/auth/login')
      .send({ email: 'login@example.com', password: 'wrongpassword' });

    expect(res.status).toBe(401);
  });

  it('returns 401 for unknown email', async () => {
    const res = await request(app.server)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'password123' });

    expect(res.status).toBe(401);
  });

  it('is case-insensitive for email', async () => {
    const res = await request(app.server)
      .post('/api/auth/login')
      .send({ email: 'LOGIN@EXAMPLE.COM', password: 'password123' });

    expect(res.status).toBe(200);
  });
});

describe('GET /api/auth/me', () => {
  it('returns user info with valid token', async () => {
    const reg = await request(app.server)
      .post('/api/auth/register')
      .send({ email: 'me@example.com', password: 'password123' });

    const res = await request(app.server)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${reg.body.token}`);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe('me@example.com');
  });

  it('returns 401 without token', async () => {
    const res = await request(app.server).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns 401 with malformed token', async () => {
    const res = await request(app.server)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer not.a.real.token');

    expect(res.status).toBe(401);
  });
});
