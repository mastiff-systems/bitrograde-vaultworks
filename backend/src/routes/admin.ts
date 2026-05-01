import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/client.js';
import { getAllSettings, upsertSettings } from '../db/settings.js';
import { requireAdmin } from '../auth/middleware.js';
import { parseBody, parseParams } from '../lib/validate.js';

const MASKED = '••••••••';
const SECRET_KEYS = new Set(['s3_secret_key']);

const UuidParams = z.object({ id: z.string().uuid('Invalid ID') });

const SettingsBody = z.record(z.string(), z.string());

const UserRoleBody = z.object({
  role: z.enum(['admin', 'user'], { message: 'role must be "admin" or "user"' }),
});

function maskSecrets(settings: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(settings).map(([k, v]) => [k, SECRET_KEYS.has(k) && v ? MASKED : v]),
  );
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  const opts = { preHandler: [requireAdmin] };

  // GET /api/admin/stats
  app.get('/api/admin/stats', opts, async (_req, reply) => {
    const [userCount, adminCount, assetCount, assetSum] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { role: 'admin' } }),
      prisma.asset.count(),
      prisma.asset.aggregate({ _sum: { sizeBytes: true } }),
    ]);

    return reply.send({
      users: userCount,
      admins: adminCount,
      assets: assetCount,
      totalSizeBytes: Number(assetSum._sum.sizeBytes ?? 0n),
    });
  });

  // GET /api/admin/settings
  app.get('/api/admin/settings', opts, async (_req, reply) => {
    const all = await getAllSettings();
    return reply.send(maskSecrets(all));
  });

  // PUT /api/admin/settings
  app.put('/api/admin/settings', opts, async (req, reply) => {
    const body = parseBody(SettingsBody, req.body, reply);
    if (!body) return;

    // Strip masked secret values — keep existing if unchanged
    const existing = await getAllSettings();
    const updates: Record<string, string> = {};
    for (const [key, value] of Object.entries(body)) {
      if (SECRET_KEYS.has(key) && value === MASKED) {
        if (existing[key]) updates[key] = existing[key];
      } else {
        updates[key] = value;
      }
    }

    await upsertSettings(updates);
    const updated = await getAllSettings();
    return reply.send(maskSecrets(updated));
  });

  // GET /api/admin/users
  app.get('/api/admin/users', opts, async (_req, reply) => {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, role: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    return reply.send(users.map((u) => ({ id: u.id, email: u.email, role: u.role, created_at: u.createdAt })));
  });

  // PATCH /api/admin/users/:id/role
  app.patch<{ Params: { id: string } }>('/api/admin/users/:id/role', opts, async (req, reply) => {
    const params = parseParams(UuidParams, req.params, reply);
    if (!params) return;

    const body = parseBody(UserRoleBody, req.body, reply);
    if (!body) return;

    // Prevent demoting yourself
    if (params.id === req.user.userId && body.role !== 'admin') {
      return reply.status(400).send({ error: 'Cannot demote your own account' });
    }

    try {
      const user = await prisma.user.update({
        where: { id: params.id },
        data: { role: body.role },
        select: { id: true, email: true, role: true },
      });
      return reply.send(user);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return reply.status(404).send({ error: 'User not found' });
      }
      throw err;
    }
  });
}
