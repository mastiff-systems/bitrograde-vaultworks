import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/client.js';
import { requireAdmin } from '../auth/middleware.js';
import { parseBody, parseParams } from '../lib/validate.js';

const UuidParams = z.object({ id: z.string().uuid('Invalid ID') });
const CreateTagBody = z.object({ name: z.string().min(1).max(100) });
const SetTagsBody = z.object({ tags: z.array(z.string().min(1).max(100)) });

export async function tagsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/tags', {
    config: { rateLimit: { max: process.env.VITEST ? 10000 : 60, timeWindow: '1 minute' } },
  }, async (_req, reply) => {
    const tags = await prisma.tag.findMany({
      select: {
        id: true,
        name: true,
        createdAt: true,
        _count: { select: { assets: true } },
      },
      orderBy: { name: 'asc' },
    });
    return reply.send(
      tags.map((t) => ({
        id: t.id,
        name: t.name,
        created_at: t.createdAt,
        asset_count: t._count.assets,
      })),
    );
  });

  app.post('/api/tags', {
    config: { rateLimit: { max: process.env.VITEST ? 10000 : 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = parseBody(CreateTagBody, req.body, reply);
    if (!body) return;

    const name = body.name.trim().toLowerCase();

    try {
      const tag = await prisma.tag.create({
        data: { name },
        select: { id: true, name: true, createdAt: true },
      });
      return reply.status(201).send({ id: tag.id, name: tag.name, created_at: tag.createdAt, asset_count: 0 });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.status(409).send({ error: 'Tag already exists' });
      }
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>('/api/tags/:id', {
    preHandler: [requireAdmin],
    config: { rateLimit: { max: process.env.VITEST ? 10000 : 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const params = parseParams(UuidParams, req.params, reply);
    if (!params) return;

    try {
      await prisma.tag.delete({ where: { id: params.id } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return reply.status(404).send({ error: 'Tag not found' });
      }
      throw err;
    }
    return reply.status(204).send();
  });

  app.put<{ Params: { id: string } }>('/api/files/:id/tags', {
    config: { rateLimit: { max: process.env.VITEST ? 10000 : 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const params = parseParams(UuidParams, req.params, reply);
    if (!params) return;

    const body = parseBody(SetTagsBody, req.body, reply);
    if (!body) return;

    const asset = await prisma.asset.findUnique({ where: { id: params.id }, select: { id: true, uploadedBy: true } });
    if (!asset) return reply.status(404).send({ error: 'Asset not found' });

    const { userId, role } = req.user;
    if (role !== 'admin' && asset.uploadedBy !== userId) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const tagNames = [...new Set(body.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];

    await prisma.$transaction(async (tx) => {
      for (const name of tagNames) {
        await tx.tag.upsert({ where: { name }, create: { name }, update: {} });
      }

      const tags = tagNames.length
        ? await tx.tag.findMany({ where: { name: { in: tagNames } }, select: { id: true } })
        : [];

      await tx.assetTag.deleteMany({ where: { assetId: params.id } });

      if (tags.length > 0) {
        await tx.assetTag.createMany({
          data: tags.map((t) => ({ assetId: params.id, tagId: t.id })),
        });
      }
    });

    const updated = await prisma.asset.findUnique({
      where: { id: params.id },
      select: { tags: { select: { tag: { select: { id: true, name: true } } } } },
    });

    return reply.send({ tags: updated?.tags.map((at) => at.tag) ?? [] });
  });
}
