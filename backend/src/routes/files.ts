import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/client.js';
import { deleteFromS3, getS3ObjectStream } from '../storage/s3.js';
import { parseParams } from '../lib/validate.js';

const UuidParams = z.object({ id: z.string().uuid('Invalid file ID') });

type AssetSelect = {
  id: string;
  originalName: string;
  mimeType: string | null;
  sizeBytes: bigint | null;
  assetType: string | null;
  uploadedAt: Date;
};

function formatAsset(a: AssetSelect) {
  return {
    id: a.id,
    original_name: a.originalName,
    mime_type: a.mimeType,
    size_bytes: a.sizeBytes !== null ? Number(a.sizeBytes) : null,
    asset_type: a.assetType,
    uploaded_at: a.uploadedAt,
  };
}

const assetSelect = {
  id: true,
  originalName: true,
  mimeType: true,
  sizeBytes: true,
  assetType: true,
  uploadedAt: true,
} as const;

export async function filesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/files', async (_req, reply) => {
    const assets = await prisma.asset.findMany({
      select: assetSelect,
      orderBy: { uploadedAt: 'desc' },
    });
    return reply.send(assets.map(formatAsset));
  });

  app.get<{ Params: { id: string } }>('/api/files/:id', async (req, reply) => {
    const params = parseParams(UuidParams, req.params, reply);
    if (!params) return;

    const asset = await prisma.asset.findUnique({ where: { id: params.id }, select: assetSelect });
    if (!asset) return reply.status(404).send({ error: 'Not found' });
    return reply.send(formatAsset(asset));
  });

  // Streams the file through the backend — avoids exposing internal S3/MinIO URLs to clients
  app.get<{ Params: { id: string } }>('/api/files/:id/download', async (req, reply) => {
    const params = parseParams(UuidParams, req.params, reply);
    if (!params) return;

    const asset = await prisma.asset.findUnique({
      where: { id: params.id },
      select: { storageKey: true, originalName: true, mimeType: true },
    });
    if (!asset) return reply.status(404).send({ error: 'Not found' });

    const { stream, contentType, contentLength } = await getS3ObjectStream(asset.storageKey);

    const mime = contentType ?? asset.mimeType ?? 'application/octet-stream';
    const filename = encodeURIComponent(asset.originalName);

    reply.header('Content-Type', mime);
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    if (contentLength) reply.header('Content-Length', contentLength);

    return reply.send(stream);
  });

  // Inline stream for previews — no Content-Disposition attachment
  app.get<{ Params: { id: string } }>('/api/files/:id/stream', async (req, reply) => {
    const params = parseParams(UuidParams, req.params, reply);
    if (!params) return;

    const asset = await prisma.asset.findUnique({
      where: { id: params.id },
      select: { storageKey: true, mimeType: true },
    });
    if (!asset) return reply.status(404).send({ error: 'Not found' });

    const { stream, contentType, contentLength } = await getS3ObjectStream(asset.storageKey);

    reply.header('Content-Type', contentType ?? asset.mimeType ?? 'application/octet-stream');
    if (contentLength) reply.header('Content-Length', contentLength);

    return reply.send(stream);
  });

  app.delete<{ Params: { id: string } }>('/api/files/:id', async (req, reply) => {
    const params = parseParams(UuidParams, req.params, reply);
    if (!params) return;

    try {
      const asset = await prisma.asset.delete({
        where: { id: params.id },
        select: { storageKey: true },
      });
      await deleteFromS3(asset.storageKey);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return reply.status(404).send({ error: 'Not found' });
      }
      throw err;
    }
    return reply.status(204).send();
  });
}
