import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma, AuditAction } from '@prisma/client';
import { prisma } from '../db/client.js';
import { requireAdmin } from '../auth/middleware.js';

const AuditLogsQuerySchema = z.object({
  page:      z.coerce.number().int().min(1).default(1),
  limit:     z.coerce.number().int().min(1).max(200).default(50),
  userId:    z.string().uuid().optional(),
  action:    z.nativeEnum(AuditAction).optional(),
  assetId:   z.string().uuid().optional(),
  startDate: z.string().datetime().optional(),
  endDate:   z.string().datetime().optional(),
});

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/audit-logs', {
    preHandler: [requireAdmin],
    schema: {
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          page:      { type: 'integer', minimum: 1, default: 1 },
          limit:     { type: 'integer', minimum: 1, maximum: 200, default: 50 },
          userId:    { type: 'string', format: 'uuid' },
          action:    { type: 'string', enum: ['UPLOAD', 'DOWNLOAD', 'VIEW', 'UPDATE', 'UPDATE_METADATA', 'DELETE', 'SHARE', 'REVOKE_SHARE'] },
          assetId:   { type: 'string', format: 'uuid' },
          startDate: { type: 'string', format: 'date-time' },
          endDate:   { type: 'string', format: 'date-time' },
        },
      },
    },
    config: { rateLimit: { max: process.env.VITEST ? 10000 : 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const parsed = AuditLogsQuerySchema.safeParse(req.query);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid query', details: parsed.error.flatten() });
    const { page, limit, userId, action, assetId, startDate, endDate } = parsed.data;

    const where: Prisma.AuditLogWhereInput = {};
    if (userId)  where.userId  = userId;
    if (action)  where.action  = action;
    if (assetId) where.assetId = assetId;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate)   where.createdAt.lte = new Date(endDate);
    }

    const [total, data] = await prisma.$transaction([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip:  (page - 1) * limit,
        take:  limit,
        include: {
          user:  { select: { email: true } },
          asset: { select: { originalName: true } },
        },
      }),
    ]);

    return reply.send({
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  });
}
