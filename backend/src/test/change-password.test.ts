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

async function registerAndLogin(email: string, password: string) {
  const count = await request(app.server).post('/api/auth/register').send({ email, password });
  return count.body.token as string;
}

async function adminCreateUser(adminToken: string, email: string, password: string) {
  return request(app.server)
    .post('/api/admin/users')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ email, password });
}

describe('POST /api/auth/change-password', () => {
  let token: string;

  beforeEach(async () => {
    token = await registerAndLogin('user@example.com', 'oldpass123');
  });

  it('happy path: changes password and clears mustChangePassword', async () => {
    const res = await request(app.server)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'oldpass123', newPassword: 'newpass456' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Password changed.');

    // Verify new password works for login
    const loginRes = await request(app.server)
      .post('/api/auth/login')
      .send({ email: 'user@example.com', password: 'newpass456' });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user.mustChangePassword).toBe(false);
  });

  it('returns 401 on wrong current password', async () => {
    const res = await request(app.server)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'wrongpassword', newPassword: 'newpass456' });

    expect(res.status).toBe(401);
  });

  it('returns 400 when new password is same as current', async () => {
    const res = await request(app.server)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'oldpass123', newPassword: 'oldpass123' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when new password is shorter than 8 chars', async () => {
    const res = await request(app.server)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'oldpass123', newPassword: 'short' });

    expect(res.status).toBe(400);
  });

  it('returns 401 without auth token', async () => {
    const res = await request(app.server)
      .post('/api/auth/change-password')
      .send({ currentPassword: 'oldpass123', newPassword: 'newpass456' });

    expect(res.status).toBe(401);
  });
});

describe('mustChangePassword gate', () => {
  let adminToken: string;

  beforeEach(async () => {
    // Admin is self-registered — mustChangePassword: false
    adminToken = await registerAndLogin('admin@example.com', 'adminpass123');
  });

  it('admin-created user gets 403 on protected endpoint before changing password', async () => {
    await adminCreateUser(adminToken, 'newuser@example.com', 'initial123');

    const loginRes = await request(app.server)
      .post('/api/auth/login')
      .send({ email: 'newuser@example.com', password: 'initial123' });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user.mustChangePassword).toBe(true);
    const newUserToken = loginRes.body.token as string;

    // Should be blocked on a protected route
    const blockedRes = await request(app.server)
      .get('/api/files')
      .set('Authorization', `Bearer ${newUserToken}`);
    expect(blockedRes.status).toBe(403);
    expect(blockedRes.body.error).toMatch(/password change required/i);
  });

  it('admin-created user can reach GET /api/auth/me while mustChangePassword is true', async () => {
    await adminCreateUser(adminToken, 'newuser@example.com', 'initial123');

    const loginRes = await request(app.server)
      .post('/api/auth/login')
      .send({ email: 'newuser@example.com', password: 'initial123' });
    const newUserToken = loginRes.body.token as string;

    const meRes = await request(app.server)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${newUserToken}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.mustChangePassword).toBe(true);
  });

  it('admin-created user can call change-password and is unblocked afterward', async () => {
    await adminCreateUser(adminToken, 'newuser@example.com', 'initial123');

    const loginRes = await request(app.server)
      .post('/api/auth/login')
      .send({ email: 'newuser@example.com', password: 'initial123' });
    const newUserToken = loginRes.body.token as string;

    // Change password while mustChangePassword is true
    const changeRes = await request(app.server)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${newUserToken}`)
      .send({ currentPassword: 'initial123', newPassword: 'myNewPass99' });
    expect(changeRes.status).toBe(200);

    // Now a protected route should be accessible
    const filesRes = await request(app.server)
      .get('/api/files')
      .set('Authorization', `Bearer ${newUserToken}`);
    expect(filesRes.status).toBe(200);
  });

  it('self-registered user is not affected by mustChangePassword gate', async () => {
    // adminToken is a self-registered user — should access protected routes freely
    const res = await request(app.server)
      .get('/api/files')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });
});
