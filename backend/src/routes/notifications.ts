import { PassThrough } from 'node:stream';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/client.js';
import { authenticateQueryToken } from '../auth/middleware.js';
import { parseParams } from '../lib/validate.js';
import { registerSseClient } from '../notifications/service.js';

const UuidParams = z.object({ id: z.string().uuid('Invalid notification ID') });

const notifSelect = {
  id: true,
  userId: true,
  type: true,
  title: true,
  body: true,
  resourceId: true,
  read: true,
  createdAt: true,
} as const;

function fmt(n: {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  resourceId: string | null;
  read: boolean;
  createdAt: Date;
}) {
  return {
    id: n.id,
    user_id: n.userId,
    type: n.type,
    title: n.title,
    body: n.body,
    resource_id: n.resourceId,
    read: n.read,
    created_at: n.createdAt,
  };
}

export async function notificationsRoutes(app: FastifyInstance): Promise<void> {
  // List notifications for current user — unread first, max 50
  app.get('/api/notifications', {
    config: { rateLimit: { max: process.env.VITEST ? 10000 : 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user.userId },
      select: notifSelect,
      orderBy: [{ read: 'asc' }, { createdAt: 'desc' }],
      take: 50,
    });
    return reply.send(notifications.map(fmt));
  });

  // Mark a single notification as read
  app.patch<{ Params: { id: string } }>('/api/notifications/:id/read', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
    },
    config: { rateLimit: { max: process.env.VITEST ? 10000 : 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const params = parseParams(UuidParams, req.params, reply);
    if (!params) return;

    try {
      const n = await prisma.notification.update({
        where: { id: params.id, userId: req.user.userId },
        data: { read: true },
        select: notifSelect,
      });
      return reply.send(fmt(n));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return reply.status(404).send({ error: 'Not found' });
      }
      throw err;
    }
  });

  // Mark all notifications as read
  app.patch('/api/notifications/read-all', {
    config: { rateLimit: { max: process.env.VITEST ? 10000 : 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    await prisma.notification.updateMany({
      where: { userId: req.user.userId, read: false },
      data: { read: true },
    });
    return reply.status(204).send();
  });

  // SSE stream — auth via ?token= since EventSource can't set headers
  app.get('/api/notifications/stream', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          token: { type: 'string' },
        },
      },
    },
    config: { rateLimit: { max: process.env.VITEST ? 10000 : 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const token = (req.query as Record<string, string>).token;
    const userId = await authenticateQueryToken(token, reply);
    if (userId === false) return;

    const stream = new PassThrough();
    const cleanup = registerSseClient(userId, stream);

    req.raw.on('close', () => {
      cleanup();
      stream.end();
    });

    reply.header('Content-Type', 'text/event-stream');
    reply.header('Cache-Control', 'no-cache');
    reply.header('Connection', 'keep-alive');
    reply.header('X-Accel-Buffering', 'no');

    stream.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

    return reply.send(stream);
  });
}
