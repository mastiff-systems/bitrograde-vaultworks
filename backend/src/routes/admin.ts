import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { Prisma, AuditAction } from '@prisma/client';
import { prisma } from '../db/client.js';
import { getAllSettings, upsertSettings } from '../db/settings.js';
import { invalidateStorageCache } from '../storage/index.js';
import { requireAdmin } from '../auth/middleware.js';
import { parseBody, parseParams } from '../lib/validate.js';
import { logAudit } from '../lib/audit.js';

const MASKED = '••••••••';
const SECRET_KEYS = new Set(['s3_secret_key', 'smtp_password']);

const UuidParams = z.object({ id: z.string().uuid('Invalid ID') });

const AuditLogsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  action: z.nativeEnum(AuditAction).optional(),
  userId: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

const PAGE_SIZE = 50;

const SettingsBody = z.record(z.string(), z.string());

const UserRoleBody = z.object({
  role: z.enum(['admin', 'user'], { message: 'role must be "admin" or "user"' }),
});

const CreateUserBody = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role: z.enum(['admin', 'user']).default('user'),
});

function maskSecrets(settings: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(settings).map(([k, v]) => [k, SECRET_KEYS.has(k) && v ? MASKED : v]),
  );
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  const opts = {
    preHandler: [requireAdmin],
    config: { rateLimit: { max: process.env.VITEST ? 10000 : 10, timeWindow: '1 minute' } },
  };

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
  app.put('/api/admin/settings', {
    ...opts,
    schema: {
      body: {
        type: 'object',
        additionalProperties: { type: 'string' },
      },
    },
  }, async (req, reply) => {
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
    invalidateStorageCache();
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

  // POST /api/admin/users
  app.post('/api/admin/users', {
    ...opts,
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        additionalProperties: false,
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 8 },
          role: { type: 'string', enum: ['admin', 'user'] },
        },
      },
    },
  }, async (req, reply) => {
    const body = parseBody(CreateUserBody, req.body, reply);
    if (!body) return;

    const email = body.email.trim().toLowerCase();
    const passwordHash = await bcrypt.hash(body.password, 12);

    try {
      const user = await prisma.user.create({
        data: { email, passwordHash, role: body.role, mustChangePassword: true },
        select: { id: true, email: true, role: true, mustChangePassword: true, createdAt: true },
      });

      void logAudit({
        userId: req.user.userId,
        action: AuditAction.USER_CREATED,
        details: { createdUserId: user.id, role: user.role },
        ipAddress: req.ip,
      });

      return reply.status(201).send({
        id: user.id,
        email: user.email,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
        created_at: user.createdAt,
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.status(409).send({ error: 'Email already registered' });
      }
      throw err;
    }
  });

  // PATCH /api/admin/users/:id/role
  app.patch<{ Params: { id: string } }>('/api/admin/users/:id/role', {
    ...opts,
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        required: ['role'],
        additionalProperties: false,
        properties: {
          role: { type: 'string', enum: ['admin', 'user'] },
        },
      },
    },
  }, async (req, reply) => {
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

  // GET /api/admin/audit-logs
  app.get('/api/admin/audit-logs', opts, async (req, reply) => {
    const q = AuditLogsQuery.safeParse(req.query);
    if (!q.success) return reply.status(400).send({ error: 'Invalid query', details: q.error.flatten() });
    const { page, action, userId, from, to } = q.data;

    const where: Prisma.AuditLogWhereInput = {};
    if (action) where.action = action;
    if (userId) where.userId = userId;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        where.createdAt.lte = toDate;
      }
    }

    const [total, logs] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          action: true,
          assetId: true,
          assetName: true,
          userName: true,
          ipAddress: true,
          details: true,
          createdAt: true,
          userId: true,
          user: { select: { email: true } },
        },
      }),
    ]);

    return reply.send({
      total,
      page,
      pageSize: PAGE_SIZE,
      totalPages: Math.ceil(total / PAGE_SIZE),
      logs: logs.map((l) => ({
        id: l.id,
        action: l.action,
        asset_id: l.assetId,
        asset_name: l.assetName,
        user_id: l.userId,
        user_name: l.userName,
        user_email: l.user?.email ?? null,
        ip_address: l.ipAddress,
        details: l.details,
        created_at: l.createdAt,
      })),
    });
  });

  // GET /api/admin/audit-users — user list for audit log filter dropdowns
  app.get('/api/admin/audit-users', opts, async (_req, reply) => {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, firstName: true, lastName: true },
      orderBy: { createdAt: 'asc' },
    });
    return reply.send(users.map((u) => ({
      id: u.id,
      email: u.email,
      name: [u.firstName, u.lastName].filter(Boolean).join(' ') || null,
    })));
  });
}
