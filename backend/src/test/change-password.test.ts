import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { FastifyInstance } from 'fastify';
import { buildApp, cleanDb } from './helpers.js';
import { prisma } from '../db/client.js';

// MAS-660 regression coverage below exercises the ?token= media/SSE routes,
// which stream through getStorageProvider() — mock it so tests don't need
// real object storage.
vi.mock('../storage/index.js', () => ({
  getStorageProvider: vi.fn().mockResolvedValue({
    upload: vi.fn().mockResolvedValue(undefined),
    streamUpload: vi.fn().mockResolvedValue(undefined),
    download: vi.fn().mockResolvedValue({
      stream: Buffer.from('file-content'),
      contentType: 'text/plain',
      contentLength: 12,
    }),
    delete: vi.fn().mockResolvedValue(undefined),
    copy: vi.fn().mockResolvedValue(undefined),
    move: vi.fn().mockResolvedValue(undefined),
  }),
  invalidateStorageCache: vi.fn(),
}));

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

// MAS-660: the global preHandler's mustChangePassword gate (backend/src/app.ts)
// exempts ?token= media/SSE routes so <img>/<video>/EventSource requests can
// authenticate without an Authorization header. That exemption previously
// skipped the mustChangePassword check entirely, letting a forced-change
// account read/download real asset content and receive live notifications
// before ever changing its password. Fixed via authenticateQueryToken()
// (backend/src/auth/middleware.ts), reused by files.ts, versions.ts, and
// notifications.ts.
describe('mustChangePassword gate — ?token= media/SSE routes (MAS-660)', () => {
  let adminToken: string;
  let newUserToken: string;
  let assetId: string;
  let versionId: string;

  beforeEach(async () => {
    adminToken = await registerAndLogin('admin2@example.com', 'adminpass123');
    await adminCreateUser(adminToken, 'newuser2@example.com', 'initial123');
    const loginRes = await request(app.server)
      .post('/api/auth/login')
      .send({ email: 'newuser2@example.com', password: 'initial123' });
    newUserToken = loginRes.body.token as string;
    expect(loginRes.body.user.mustChangePassword).toBe(true);

    const asset = await prisma.asset.create({
      data: {
        originalName: 'secret.txt',
        storageKey: 'assets/secret.txt',
        assetType: 'other',
        thumbnailKey: 'assets/secret-thumb.webp',
      },
    });
    assetId = asset.id;

    const version = await prisma.assetVersion.create({
      data: {
        assetId: asset.id,
        versionNumber: 1,
        storageKey: 'assets/secret.txt',
        mimeType: 'text/plain',
      },
    });
    versionId = version.id;
  });

  it('blocks GET /api/files/:id/download?token= for a must-change-password user', async () => {
    const res = await request(app.server).get(`/api/files/${assetId}/download?token=${newUserToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/password change required/i);
  });

  it('blocks GET /api/files/:id/stream?token= for a must-change-password user', async () => {
    const res = await request(app.server).get(`/api/files/${assetId}/stream?token=${newUserToken}`);
    expect(res.status).toBe(403);
  });

  it('blocks GET /api/files/:id/thumbnail?token= for a must-change-password user', async () => {
    const res = await request(app.server).get(`/api/files/${assetId}/thumbnail?token=${newUserToken}`);
    expect(res.status).toBe(403);
  });

  it('blocks GET /api/files/:id/versions/:versionId/download?token= for a must-change-password user', async () => {
    const res = await request(app.server).get(
      `/api/files/${assetId}/versions/${versionId}/download?token=${newUserToken}`,
    );
    expect(res.status).toBe(403);
  });

  it('blocks GET /api/files/:id/versions/:versionId/preview?token= for a must-change-password user', async () => {
    const res = await request(app.server).get(
      `/api/files/${assetId}/versions/${versionId}/preview?token=${newUserToken}`,
    );
    expect(res.status).toBe(403);
  });

  it('blocks GET /api/notifications/stream?token= for a must-change-password user', async () => {
    const res = await request(app.server).get(`/api/notifications/stream?token=${newUserToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/password change required/i);
  });

  it('still allows GET /api/files/:id/download?token= once the password has been changed', async () => {
    const changeRes = await request(app.server)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${newUserToken}`)
      .send({ currentPassword: 'initial123', newPassword: 'myNewPass99' });
    expect(changeRes.status).toBe(200);

    const res = await request(app.server).get(`/api/files/${assetId}/download?token=${newUserToken}`);
    expect(res.status).toBe(200);
  });

  it('still allows a normal (non-must-change) user to use the media token routes', async () => {
    const res = await request(app.server).get(`/api/files/${assetId}/download?token=${adminToken}`);
    expect(res.status).toBe(200);
  });
});
