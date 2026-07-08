import crypto from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { getS3ObjectStream } from '../storage/s3.js';
import { parseBody, parseParams } from '../lib/validate.js';
import { authenticate } from '../auth/middleware.js';
import { logAudit } from '../lib/audit.js';

const UuidParams = z.object({ id: z.string().uuid('Invalid file ID') });
const TokenParams = z.object({ token: z.string().length(64) });

const CreateShareSchema = z.object({
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

export async function shareRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/files/:id/share — create or replace share link for asset
  app.post<{ Params: { id: string } }>(
    '/api/files/:id/share',
    { preHandler: [authenticate] },
    async (req, reply) => {
      const params = parseParams(UuidParams, req.params, reply);
      if (!params) return;

      const body = req.body ? parseBody(CreateShareSchema, req.body, reply) : {};
      if (body === null) return;

      const asset = await prisma.asset.findUnique({
        where: { id: params.id },
        select: { id: true, originalName: true },
      });
      if (!asset) return reply.status(404).send({ error: 'Not found' });

      const expiresInDays = (body as { expiresInDays?: number }).expiresInDays ?? 30;
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expiresInDays);

      const token = crypto.randomBytes(32).toString('hex');
      const userId = req.user.userId;

      // Upsert: delete existing then create new (@@unique([assetId]) means one per asset)
      await prisma.shareLink.deleteMany({ where: { assetId: params.id } });
      await prisma.shareLink.create({
        data: {
          token,
          assetId: params.id,
          createdByUserId: userId,
          expiresAt,
        },
      });

      const baseUrl = process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3001}`;
      const url = `${baseUrl}/api/share/${token}`;

      logAudit({
        prisma,
        userId,
        assetId:   params.id,
        assetName: asset.originalName,
        ipAddress: req.ip,
        action:    'SHARE',
        metadata:  { userAgent: req.headers['user-agent'], expiresInDays },
      });

      return reply.status(201).send({ token, url, expiresAt: expiresAt.toISOString() });
    },
  );

  // GET /api/share/:token — public; streams the asset file (no auth)
  app.get<{ Params: { token: string } }>('/api/share/:token', async (req, reply) => {
    const params = parseParams(TokenParams, req.params, reply);
    if (!params) return;

    const link = await prisma.shareLink.findUnique({
      where: { token: params.token },
      include: { asset: { select: { storageKey: true, originalName: true, mimeType: true } } },
    });

    if (!link) return reply.status(404).send({ error: 'Not found' });
    if (link.expiresAt !== null && link.expiresAt < new Date()) {
      return reply.status(404).send({ error: 'Not found' });
    }

    const { stream, contentType, contentLength } = await getS3ObjectStream(link.asset.storageKey);

    const mime = contentType ?? link.asset.mimeType ?? 'application/octet-stream';
    const filename = encodeURIComponent(link.asset.originalName);

    reply.header('Content-Type', mime);
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    if (contentLength) reply.header('Content-Length', contentLength);

    return reply.send(stream);
  });

  // GET /api/files/:id/share — list active share links for asset (auth required)
  app.get<{ Params: { id: string } }>(
    '/api/files/:id/share',
    { preHandler: [authenticate] },
    async (req, reply) => {
      const params = parseParams(UuidParams, req.params, reply);
      if (!params) return;

      const asset = await prisma.asset.findUnique({
        where: { id: params.id },
        select: { id: true },
      });
      if (!asset) return reply.status(404).send({ error: 'Not found' });

      const now = new Date();
      const links = await prisma.shareLink.findMany({
        where: {
          assetId: params.id,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        select: { id: true, token: true, expiresAt: true, createdAt: true, createdByUserId: true },
        orderBy: { createdAt: 'desc' },
      });

      const baseUrl = process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3001}`;
      return reply.send(
        links.map((l) => ({
          id: l.id,
          token: l.token,
          url: `${baseUrl}/api/share/${l.token}`,
          expiresAt: l.expiresAt?.toISOString() ?? null,
          createdAt: l.createdAt.toISOString(),
          createdByUserId: l.createdByUserId,
        })),
      );
    },
  );

  // DELETE /api/files/:id/share — revoke all share links for asset owned by requester
  app.delete<{ Params: { id: string } }>(
    '/api/files/:id/share',
    { preHandler: [authenticate] },
    async (req, reply) => {
      const params = parseParams(UuidParams, req.params, reply);
      if (!params) return;

      const asset = await prisma.asset.findUnique({
        where: { id: params.id },
        select: { id: true, originalName: true },
      });
      if (!asset) return reply.status(404).send({ error: 'Not found' });

      const { userId, role } = req.user;

      const where = role === 'admin'
        ? { assetId: params.id }
        : { assetId: params.id, createdByUserId: userId };

      await prisma.shareLink.deleteMany({ where });

      logAudit({
        prisma,
        userId,
        assetId:   params.id,
        assetName: asset.originalName,
        ipAddress: req.ip,
        action:    'REVOKE_SHARE',
        metadata:  { userAgent: req.headers['user-agent'] },
      });

      return reply.status(204).send();
    },
  );
}
