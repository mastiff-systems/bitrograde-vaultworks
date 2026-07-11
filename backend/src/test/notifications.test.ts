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

let app: FastifyInstance;
let token: string;
let userId: string;
let otherToken: string;
let otherUserId: string;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  // Notifications FK to users — delete before cleanDb
  await prisma.notification.deleteMany();
  await cleanDb();

  // First registration becomes admin
  await request(app.server)
    .post('/api/auth/register')
    .send({ email: 'admin@example.com', password: 'password123' });

  const userRes = await request(app.server)
    .post('/api/auth/register')
    .send({ email: 'user@example.com', password: 'password123' });
  token = userRes.body.token;
  userId = userRes.body.user.id;

  const otherRes = await request(app.server)
    .post('/api/auth/register')
    .send({ email: 'other@example.com', password: 'password123' });
  otherToken = otherRes.body.token;
  otherUserId = otherRes.body.user.id;
});

async function createNotification(
  forUserId: string,
  overrides: { title?: string; body?: string; type?: string; read?: boolean } = {},
) {
  return prisma.notification.create({
    data: {
      userId: forUserId,
      type: overrides.type ?? 'info',
      title: overrides.title ?? 'Test notification',
      body: overrides.body ?? 'Test body',
      read: overrides.read ?? false,
    },
  });
}

// ─── GET /api/notifications ──────────────────────────────────────────────────

describe('GET /api/notifications', () => {
  it('returns empty array when user has no notifications', async () => {
    const res = await request(app.server)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns only the current user\'s notifications', async () => {
    await createNotification(userId, { title: 'Mine' });
    await createNotification(otherUserId, { title: 'Not mine' });

    const res = await request(app.server)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe('Mine');
  });

  it('returns notifications with expected fields', async () => {
    await createNotification(userId, { title: 'Field check', body: 'Body text', type: 'upload' });

    const res = await request(app.server)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const n = res.body[0];
    expect(n).toHaveProperty('id');
    expect(n).toHaveProperty('user_id', userId);
    expect(n).toHaveProperty('type', 'upload');
    expect(n).toHaveProperty('title', 'Field check');
    expect(n).toHaveProperty('body', 'Body text');
    expect(n).toHaveProperty('read', false);
    expect(n).toHaveProperty('created_at');
  });

  it('returns unread notifications before read ones', async () => {
    await createNotification(userId, { title: 'Read notif', read: true });
    await createNotification(userId, { title: 'Unread notif', read: false });

    const res = await request(app.server)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].title).toBe('Unread notif');
    expect(res.body[1].title).toBe('Read notif');
  });

  it('returns at most 50 notifications', async () => {
    await Promise.all(
      Array.from({ length: 55 }, (_, i) =>
        createNotification(userId, { title: `Notif ${i}` }),
      ),
    );

    const res = await request(app.server)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeLessThanOrEqual(50);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app.server).get('/api/notifications');
    expect(res.status).toBe(401);
  });
});

// ─── PATCH /api/notifications/:id/read ──────────────────────────────────────

describe('PATCH /api/notifications/:id/read', () => {
  it('marks a notification as read and returns updated record', async () => {
    const notif = await createNotification(userId, { read: false });

    const res = await request(app.server)
      .patch(`/api/notifications/${notif.id}/read`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(notif.id);
    expect(res.body.read).toBe(true);
  });

  it('is idempotent — marking already-read notification returns 200', async () => {
    const notif = await createNotification(userId, { read: true });

    const res = await request(app.server)
      .patch(`/api/notifications/${notif.id}/read`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.read).toBe(true);
  });

  it('returns 404 for a notification belonging to another user', async () => {
    const notif = await createNotification(otherUserId, { title: 'Other user notif' });

    const res = await request(app.server)
      .patch(`/api/notifications/${notif.id}/read`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('returns 404 for unknown notification ID', async () => {
    const res = await request(app.server)
      .patch('/api/notifications/00000000-0000-0000-0000-000000000000/read')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('returns 400 for non-UUID notification ID', async () => {
    const res = await request(app.server)
      .patch('/api/notifications/not-a-uuid/read')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  it('returns 401 without auth', async () => {
    const notif = await createNotification(userId);

    const res = await request(app.server)
      .patch(`/api/notifications/${notif.id}/read`);

    expect(res.status).toBe(401);
  });
});

// ─── PATCH /api/notifications/read-all ──────────────────────────────────────

describe('PATCH /api/notifications/read-all', () => {
  it('marks all unread notifications as read and returns 204', async () => {
    await createNotification(userId, { title: 'Unread 1', read: false });
    await createNotification(userId, { title: 'Unread 2', read: false });

    const res = await request(app.server)
      .patch('/api/notifications/read-all')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(204);

    const remaining = await prisma.notification.findMany({
      where: { userId, read: false },
    });
    expect(remaining).toHaveLength(0);
  });

  it('does not affect another user\'s notifications', async () => {
    await createNotification(otherUserId, { title: 'Other unread', read: false });

    await request(app.server)
      .patch('/api/notifications/read-all')
      .set('Authorization', `Bearer ${token}`);

    const otherNotif = await prisma.notification.findFirst({
      where: { userId: otherUserId },
    });
    expect(otherNotif?.read).toBe(false);
  });

  it('returns 204 even when there are no unread notifications', async () => {
    const res = await request(app.server)
      .patch('/api/notifications/read-all')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(204);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app.server).patch('/api/notifications/read-all');
    expect(res.status).toBe(401);
  });
});
