import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma, AuditAction } from '@prisma/client';
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

  const AuditLogsQuerySchema = z.object({
    assetId:  z.string().uuid().optional(),
    userId:   z.string().uuid().optional(),
    action:   z.enum(['UPLOAD', 'DOWNLOAD', 'VIEW', 'UPDATE', 'DELETE']).optional(),
    from:     z.string().datetime().optional(),
    to:       z.string().datetime().optional(),
    limit:    z.coerce.number().int().min(1).max(200).default(50),
    cursor:   z.string().optional(),
  });

  // GET /api/admin/audit-logs
  app.get('/api/admin/audit-logs', opts, async (req, reply) => {
    const parsed = AuditLogsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid query parameters', details: parsed.error.flatten() });
    }
    const { assetId, userId, action, from, to, limit, cursor } = parsed.data;

    const where: Prisma.AuditLogWhereInput = {};
    if (assetId) where.assetId = assetId;
    if (userId)  where.userId  = userId;
    if (action)  where.action  = action as AuditAction;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to)   where.createdAt.lte = new Date(to);
    }

    // Keyset cursor: base64-encoded JSON { createdAt: string, id: string }
    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as { createdAt: string; id: string };
        where.OR = [
          { createdAt: { lt: new Date(decoded.createdAt) } },
          { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } },
        ];
      } catch {
        return reply.status(400).send({ error: 'Invalid cursor' });
      }
    }

    const rows = await prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const last = data[data.length - 1];
    const nextCursor = hasMore && last
      ? Buffer.from(JSON.stringify({ createdAt: last.createdAt.toISOString(), id: last.id })).toString('base64')
      : null;

    return reply.send({ data, nextCursor });
  });
}
