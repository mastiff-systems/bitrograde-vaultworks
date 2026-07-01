import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/client.js';
import { deleteFromS3, getS3ObjectStream } from '../storage/s3.js';
import { parseParams, parseBody } from '../lib/validate.js';
import { verifyLocalToken } from '../auth/tokens.js';
import { verifyKeycloakToken } from '../auth/keycloak.js';
import { authenticate } from '../auth/middleware.js';
import { logAudit } from '../lib/audit.js';

async function authenticateToken(token: string | undefined, reply: Parameters<typeof parseParams>[2]): Promise<string | null | false> {
  if (!token) { reply.status(401).send({ error: 'token required' }); return false; }
  try {
    const provider = process.env.AUTH_PROVIDER ?? 'local';
    if (provider === 'keycloak') {
      await verifyKeycloakToken(token);
      return null; // keycloak path doesn't return userId easily
    } else {
      const payload = verifyLocalToken(token);
      return payload.userId;
    }
  } catch { reply.status(401).send({ error: 'Invalid token' }); return false; }
}

const UuidParams = z.object({ id: z.string().uuid('Invalid file ID') });

const FilesQuerySchema = z.object({
  q: z.string().optional(),
  tags: z.string().optional(),
  assetType: z.string().optional(),
  mimeType: z.string().optional(),
  categoryId: z.string().uuid().optional(),
  subcategoryId: z.string().uuid().optional(),
  format: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

type TagInfo = { id: string; name: string };

type AssetSelect = {
  id: string;
  originalName: string;
  mimeType: string | null;
  sizeBytes: bigint | null;
  assetType: string | null;
  thumbnailKey: string | null;
  description: string | null;
  uploadedAt: Date;
  updatedAt: Date;
  categoryId: string | null;
  subcategoryId: string | null;
  license: string | null;
  resolutionW: number | null;
  resolutionH: number | null;
  durationSeconds: number | null;
  tags: { tag: TagInfo }[];
};

function formatAsset(a: AssetSelect) {
  return {
    id: a.id,
    original_name: a.originalName,
    mime_type: a.mimeType,
    size_bytes: a.sizeBytes !== null ? Number(a.sizeBytes) : null,
    asset_type: a.assetType,
    thumbnail_key: a.thumbnailKey,
    description: a.description,
    uploaded_at: a.uploadedAt,
    updated_at: a.updatedAt,
    category_id: a.categoryId,
    subcategory_id: a.subcategoryId,
    license: a.license,
    resolution_w: a.resolutionW,
    resolution_h: a.resolutionH,
    duration_seconds: a.durationSeconds,
    tags: a.tags.map((at) => at.tag),
  };
}

const assetSelect = {
  id: true,
  originalName: true,
  mimeType: true,
  sizeBytes: true,
  assetType: true,
  thumbnailKey: true,
  description: true,
  uploadedAt: true,
  updatedAt: true,
  categoryId: true,
  subcategoryId: true,
  license: true,
  resolutionW: true,
  resolutionH: true,
  durationSeconds: true,
  tags: { select: { tag: { select: { id: true, name: true } } } },
} as const;

export async function filesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/files', async (req, reply) => {
    const query = FilesQuerySchema.safeParse(req.query);
    if (!query.success) return reply.status(400).send({ error: 'Invalid query parameters', details: query.error.flatten() });
    const params = query.data;

    const limit = params.limit ?? 50;
    const tagNames = params.tags
      ? params.tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
      : [];

    if (params.q) {
      const q = params.q.trim();
      if (!q) return reply.send([]);

      const like = `%${q}%`;

      // Build optional filter fragments for raw SQL
      let extraFilters: Prisma.Sql = Prisma.empty;
      if (params.assetType) {
        extraFilters = Prisma.sql`${extraFilters} AND a.asset_type = ${params.assetType}`;
      }
      if (params.mimeType) {
        extraFilters = Prisma.sql`${extraFilters} AND a.mime_type = ${params.mimeType}`;
      }
      if (params.categoryId) {
        extraFilters = Prisma.sql`${extraFilters} AND a.category_id = ${params.categoryId}::uuid`;
      }
      if (params.subcategoryId) {
        extraFilters = Prisma.sql`${extraFilters} AND a.subcategory_id = ${params.subcategoryId}::uuid`;
      }
      if (params.format) {
        const prefix = `${params.format}/%`;
        extraFilters = Prisma.sql`${extraFilters} AND a.mime_type LIKE ${prefix}`;
      }
      if (tagNames.length > 0) {
        extraFilters = Prisma.sql`${extraFilters} AND a.id IN (
          SELECT jat2.asset_id FROM asset_tags jat2
          JOIN tags t2 ON t2.id = jat2.tag_id
          WHERE t2.name = ANY(${tagNames})
          GROUP BY jat2.asset_id
          HAVING COUNT(DISTINCT t2.name) = ${tagNames.length}
        )`;
      }

      // Phase 1: ranked ID list via pg_trgm similarity + ILIKE fallback
      // Ranking: name match (1) > tag match (2) > description match (3)
      const rankedIds = await prisma.$queryRaw<{ id: string }[]>`
        SELECT a.id
        FROM assets a
        LEFT JOIN asset_tags jat ON jat.asset_id = a.id
        LEFT JOIN tags t ON t.id = jat.tag_id
        WHERE (
          similarity(a.original_name, ${q}) > 0.3
          OR a.original_name ILIKE ${like}
          OR a.description ILIKE ${like}
          OR (t.name IS NOT NULL AND (similarity(t.name, ${q}) > 0.3 OR t.name ILIKE ${like}))
        )
        ${extraFilters}
        GROUP BY a.id, a.original_name, a.description
        ORDER BY
          MIN(CASE
            WHEN similarity(a.original_name, ${q}) > 0.3 OR a.original_name ILIKE ${like} THEN 1
            WHEN t.name IS NOT NULL AND (similarity(t.name, ${q}) > 0.3 OR t.name ILIKE ${like}) THEN 2
            WHEN a.description ILIKE ${like} THEN 3
            ELSE 4
          END) ASC,
          similarity(a.original_name, ${q}) DESC
        LIMIT ${limit}
      `;

      if (rankedIds.length === 0) return reply.send([]);

      const ids = rankedIds.map((r) => r.id);

      // Phase 2: fetch full asset data (including all tags) for matched IDs
      const assets = await prisma.asset.findMany({
        where: { id: { in: ids } },
        select: assetSelect,
      });

      // Restore ranked order from phase 1
      const orderMap = new Map(ids.map((id, i) => [id, i]));
      const sorted = assets.sort(
        (a, b) => (orderMap.get(a.id) ?? 999) - (orderMap.get(b.id) ?? 999),
      );

      return reply.send(sorted.map(formatAsset));
    }

    // No query: standard filtered list
    const conditions: Prisma.AssetWhereInput[] = [];

    if (params.assetType) {
      conditions.push({ assetType: params.assetType });
    }
    if (params.mimeType) {
      conditions.push({ mimeType: params.mimeType });
    }
    if (params.categoryId) {
      conditions.push({ categoryId: params.categoryId });
    }
    if (params.subcategoryId) {
      conditions.push({ subcategoryId: params.subcategoryId });
    }
    if (params.format) {
      conditions.push({ mimeType: { startsWith: `${params.format}/` } });
    }
    for (const name of tagNames) {
      conditions.push({ tags: { some: { tag: { name } } } });
    }

    const where: Prisma.AssetWhereInput = conditions.length > 0 ? { AND: conditions } : {};

    const assets = await prisma.asset.findMany({
      where,
      select: assetSelect,
      orderBy: { uploadedAt: 'desc' },
      take: limit,
    });
    return reply.send(assets.map(formatAsset));
  });

  app.get<{ Params: { id: string } }>('/api/files/:id', async (req, reply) => {
    const params = parseParams(UuidParams, req.params, reply);
    if (!params) return;

    const asset = await prisma.asset.findUnique({ where: { id: params.id }, select: assetSelect });
    if (!asset) return reply.status(404).send({ error: 'Not found' });

    logAudit({
      prisma,
      userId:   req.user?.userId ?? null,
      assetId:  params.id,
      action:   'VIEW',
      metadata: { ip: req.ip, userAgent: req.headers['user-agent'] },
    });

    return reply.send(formatAsset(asset));
  });

  // Streams the file through the backend — avoids exposing internal S3/MinIO URLs to clients
  app.get<{ Params: { id: string } }>('/api/files/:id/download', async (req, reply) => {
    const token = (req.query as Record<string, string>).token;
    const authResult = await authenticateToken(token, reply);
    if (authResult === false) return;

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

    logAudit({
      prisma,
      userId:   authResult,
      assetId:  params.id,
      action:   'DOWNLOAD',
      metadata: { ip: req.ip, userAgent: req.headers['user-agent'] },
    });

    return reply.send(stream);
  });

  // Inline stream for previews — no Content-Disposition attachment
  app.get<{ Params: { id: string } }>('/api/files/:id/stream', async (req, reply) => {
    const token = (req.query as Record<string, string>).token;
    if (await authenticateToken(token, reply) === false) return;

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

  // Streams the generated thumbnail — 404 if no thumbnail exists for this asset
  app.get<{ Params: { id: string } }>('/api/files/:id/thumbnail', async (req, reply) => {
    const token = (req.query as Record<string, string>).token;
    if (await authenticateToken(token, reply) === false) return;

    const params = parseParams(UuidParams, req.params, reply);
    if (!params) return;

    const asset = await prisma.asset.findUnique({
      where: { id: params.id },
      select: { thumbnailKey: true },
    });
    if (!asset || !asset.thumbnailKey) return reply.status(404).send({ error: 'No thumbnail available' });

    const { stream, contentType, contentLength } = await getS3ObjectStream(asset.thumbnailKey);

    reply.header('Content-Type', contentType ?? 'image/webp');
    if (contentLength) reply.header('Content-Length', contentLength);

    return reply.send(stream);
  });

  const UpdateFileSchema = z.object({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    categoryId: z.string().uuid().nullable().optional(),
    subcategoryId: z.string().uuid().nullable().optional(),
    tags: z.array(z.string().min(1).max(100)).optional(),
  });

  app.patch<{ Params: { id: string } }>(
    '/api/files/:id',
    { preHandler: [authenticate] },
    async (req, reply) => {
      const params = parseParams(UuidParams, req.params, reply);
      if (!params) return;

      const body = parseBody(UpdateFileSchema, req.body, reply);
      if (!body) return;

      const existing = await prisma.asset.findUnique({ where: { id: params.id }, select: { id: true, uploadedBy: true } });
      if (!existing) return reply.status(404).send({ error: 'Not found' });

      const { userId, role } = req.user;
      if (role !== 'admin' && existing.uploadedBy !== userId) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const { tags, ...fields } = body;

      const updateData: Prisma.AssetUpdateInput = {};
      if (fields.name !== undefined) updateData.originalName = fields.name;
      if (fields.description !== undefined) updateData.description = fields.description;
      if (fields.categoryId !== undefined) {
        updateData.category = fields.categoryId ? { connect: { id: fields.categoryId } } : { disconnect: true };
      }
      if (fields.subcategoryId !== undefined) {
        updateData.subcategory = fields.subcategoryId ? { connect: { id: fields.subcategoryId } } : { disconnect: true };
      }

      if (tags !== undefined) {
        await prisma.$transaction(async (tx) => {
          const tagNames = [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
          for (const name of tagNames) {
            await tx.tag.upsert({ where: { name }, create: { name }, update: {} });
          }
          const tagRecords = tagNames.length
            ? await tx.tag.findMany({ where: { name: { in: tagNames } }, select: { id: true } })
            : [];
          await tx.assetTag.deleteMany({ where: { assetId: params.id } });
          if (tagRecords.length > 0) {
            await tx.assetTag.createMany({
              data: tagRecords.map((t) => ({ assetId: params.id, tagId: t.id })),
            });
          }
          await tx.asset.update({ where: { id: params.id }, data: updateData });
        });
      } else {
        await prisma.asset.update({ where: { id: params.id }, data: updateData });
      }

      const updated = await prisma.asset.findUnique({ where: { id: params.id }, select: assetSelect });
      if (!updated) return reply.status(404).send({ error: 'Not found' });

      logAudit({
        prisma,
        userId:   req.user.userId,
        assetId:  params.id,
        action:   'UPDATE',
        metadata: { ip: req.ip, userAgent: req.headers['user-agent'] },
      });

      return reply.send(formatAsset(updated));
    },
  );

  app.delete<{ Params: { id: string } }>('/api/files/:id', async (req, reply) => {
    const params = parseParams(UuidParams, req.params, reply);
    if (!params) return;

    try {
      // Log before delete so the asset FK still exists when the audit INSERT runs.
      logAudit({
        prisma,
        userId:   req.user?.userId ?? null,
        assetId:  params.id,
        action:   'DELETE',
        metadata: { ip: req.ip, userAgent: req.headers['user-agent'] },
      });

      const asset = await prisma.asset.delete({
        where: { id: params.id },
        select: { storageKey: true, thumbnailKey: true },
      });
      await deleteFromS3(asset.storageKey);
      if (asset.thumbnailKey) await deleteFromS3(asset.thumbnailKey);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return reply.status(404).send({ error: 'Not found' });
      }
      throw err;
    }

    return reply.status(204).send();
  });
}
