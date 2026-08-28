import crypto from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/client.js';
import { getStorageProvider } from '../storage/index.js';
import { StorageNotFoundError } from '../storage/provider.js';
import { parseParams, parseBody } from '../lib/validate.js';
import { verifyLocalToken } from '../auth/tokens.js';
import { verifyKeycloakToken } from '../auth/keycloak.js';
import { generateDuplicateName } from '../lib/filename.js';
import { logAudit, AuditAction } from '../lib/audit.js';
import { ZipArchive } from 'archiver';

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
  exact_name: z.string().optional(),
  tags: z.string().optional(),
  assetType: z.string().optional(),
  mimeType: z.string().optional(),
  categoryId: z.string().uuid().optional(),
  subcategoryId: z.string().uuid().optional(),
  format: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
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

function makeEtag(data: string): string {
  return '"' + crypto.createHash('sha1').update(data).digest('hex') + '"';
}

export async function filesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/files', {
    schema: {
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          q: { type: 'string' },
          tags: { type: 'string' },
          assetType: { type: 'string' },
          mimeType: { type: 'string' },
          categoryId: { type: 'string', format: 'uuid' },
          subcategoryId: { type: 'string', format: 'uuid' },
          format: { type: 'string' },
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
        },
      },
    },
    config: {
      rateLimit: {
        max: process.env.VITEST ? 10000 : 60,
        timeWindow: '1 minute',
      },
    },
  }, async (req, reply) => {
    const query = FilesQuerySchema.safeParse(req.query);
    if (!query.success) return reply.status(400).send({ error: 'Invalid query parameters', details: query.error.flatten() });
    const params = query.data;

    // Exact-name conflict lookup — used by drag-and-drop overwrite detection (MAS-342)
    // Returns [{id, original_name}] for every asset whose originalName exactly matches
    // (case-sensitive PostgreSQL =), or [] if none. Bypasses all other filters.
    if (params.exact_name) {
      const matches = await prisma.asset.findMany({
        where: { originalName: params.exact_name, deletedAt: null },
        select: { id: true, originalName: true },
      });
      return reply.send(matches.map((a) => ({ id: a.id, original_name: a.originalName })));
    }

    const limit = params.limit ?? 50;
    const page  = params.page  ?? 1;
    const tagNames = params.tags
      ? params.tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
      : [];

    if (params.q) {
      const q = params.q.trim();
      if (!q) {
        const body = { data: [], total: 0, page, limit, totalPages: 0 };
        const etag = makeEtag(JSON.stringify(body));
        reply.header('ETag', etag).header('Cache-Control', 'no-cache');
        if (req.headers['if-none-match'] === etag) return reply.status(304).send();
        return reply.send(body);
      }

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

      const skip = (page - 1) * limit;

      // Phase 1: count + ranked ID list in one transaction
      const [countResult, rankedIds] = await prisma.$transaction([
        prisma.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(DISTINCT a.id) AS count
          FROM assets a
          LEFT JOIN asset_tags jat ON jat.asset_id = a.id
          LEFT JOIN tags t ON t.id = jat.tag_id
          WHERE a.deleted_at IS NULL
          AND (
            public.similarity(a.original_name, ${q}) > 0.3
            OR a.original_name ILIKE ${like}
            OR a.description ILIKE ${like}
            OR (t.name IS NOT NULL AND (public.similarity(t.name, ${q}) > 0.3 OR t.name ILIKE ${like}))
          )
          ${extraFilters}
        `,
        prisma.$queryRaw<{ id: string }[]>`
          SELECT a.id
          FROM assets a
          LEFT JOIN asset_tags jat ON jat.asset_id = a.id
          LEFT JOIN tags t ON t.id = jat.tag_id
          WHERE a.deleted_at IS NULL
          AND (
            public.similarity(a.original_name, ${q}) > 0.3
            OR a.original_name ILIKE ${like}
            OR a.description ILIKE ${like}
            OR (t.name IS NOT NULL AND (public.similarity(t.name, ${q}) > 0.3 OR t.name ILIKE ${like}))
          )
          ${extraFilters}
          GROUP BY a.id, a.original_name, a.description
          ORDER BY
            MIN(CASE
              WHEN public.similarity(a.original_name, ${q}) > 0.3 OR a.original_name ILIKE ${like} THEN 1
              WHEN t.name IS NOT NULL AND (public.similarity(t.name, ${q}) > 0.3 OR t.name ILIKE ${like}) THEN 2
              WHEN a.description ILIKE ${like} THEN 3
              ELSE 4
            END) ASC,
            public.similarity(a.original_name, ${q}) DESC,
            a.id ASC
          LIMIT ${limit}
          OFFSET ${skip}
        `,
      ]);
      const total = Number(countResult[0].count);

      if (rankedIds.length === 0) {
        const body = { data: [], total, page, limit, totalPages: Math.ceil(total / limit) || 0 };
        const etag = makeEtag(JSON.stringify(body));
        reply.header('ETag', etag).header('Cache-Control', 'no-cache');
        if (req.headers['if-none-match'] === etag) return reply.status(304).send();
        return reply.send(body);
      }

      const ids = rankedIds.map((r) => r.id);

      // Phase 2: fetch full asset data (including all tags) for matched IDs
      const assets = await prisma.asset.findMany({
        where: { id: { in: ids }, deletedAt: null },
        select: assetSelect,
      });

      // Restore ranked order from phase 1
      const orderMap = new Map(ids.map((id, i) => [id, i]));
      const sorted = assets.sort(
        (a, b) => (orderMap.get(a.id) ?? 999) - (orderMap.get(b.id) ?? 999),
      );

      const searchBody = { data: sorted.map(formatAsset), total, page, limit, totalPages: Math.ceil(total / limit) };
      const searchEtag = makeEtag(JSON.stringify(searchBody));
      reply.header('ETag', searchEtag).header('Cache-Control', 'no-cache');
      if (req.headers['if-none-match'] === searchEtag) return reply.status(304).send();
      return reply.send(searchBody);
    }

    // No query: standard filtered list — exclude soft-deleted assets
    const conditions: Prisma.AssetWhereInput[] = [{ deletedAt: null }];

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

    const where: Prisma.AssetWhereInput = { AND: conditions };

    const [total, assets] = await prisma.$transaction([
      prisma.asset.count({ where }),
      prisma.asset.findMany({
        where,
        select: assetSelect,
        orderBy: { uploadedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const listBody = { data: assets.map(formatAsset), total, page, limit, totalPages: Math.ceil(total / limit) };
    const listEtag = makeEtag(JSON.stringify(listBody));
    reply.header('ETag', listEtag).header('Cache-Control', 'no-cache');
    if (req.headers['if-none-match'] === listEtag) return reply.status(304).send();
    return reply.send(listBody);
  });

  app.get<{ Params: { id: string } }>('/api/files/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
    },
    config: {
      rateLimit: {
        max: process.env.VITEST ? 10000 : 120,
        timeWindow: '1 minute',
      },
    },
  }, async (req, reply) => {
    const params = parseParams(UuidParams, req.params, reply);
    if (!params) return;

    const asset = await prisma.asset.findUnique({
      where: { id: params.id },
      select: {
        ...assetSelect,
        uploadedBy: true,
        deletedAt: true,
        uploader: { select: { firstName: true, lastName: true, email: true } },
      },
    });
    if (!asset) return reply.status(404).send({ error: 'Not found' });
    // Trashed assets are not accessible through the normal file endpoint
    if (asset.deletedAt !== null) return reply.status(404).send({ error: 'Not found' });

    // Resolve uploader display name
    let createdByName: string | null = null;
    let createdByEmail: string | null = null;
    if (asset.uploader) {
      const parts = [asset.uploader.firstName, asset.uploader.lastName].filter(Boolean);
      createdByName = parts.length > 0 ? parts.join(' ') : null;
      createdByEmail = asset.uploader.email;
    }

    // Most recent update event for this asset from audit_logs
    const lastUpdate = await prisma.auditLog.findFirst({
      where: {
        assetId: params.id,
        action: { in: [AuditAction.UPDATE, AuditAction.UPDATE_METADATA, AuditAction.RESTORE] },
      },
      orderBy: { createdAt: 'desc' },
      select: { userName: true, userId: true, createdAt: true },
    });

    let updatedByName: string | null = null;
    let updatedByEmail: string | null = null;
    let updatedAt: Date | null = null;
    if (lastUpdate) {
      updatedByName = lastUpdate.userName ?? null;
      if (!updatedByName && lastUpdate.userId) {
        const u = await prisma.user.findUnique({
          where: { id: lastUpdate.userId },
          select: { email: true },
        });
        updatedByEmail = u?.email ?? null;
      }
      updatedAt = lastUpdate.createdAt;
    }

    return reply.send({
      ...formatAsset(asset),
      created_by_name: createdByName,
      created_by_email: createdByEmail,
      updated_by_name: updatedByName,
      updated_by_email: updatedByEmail,
      updated_at: updatedAt,
    });
  });

  // Streams the file through the backend — avoids exposing internal S3/MinIO URLs to clients
  app.get<{ Params: { id: string } }>('/api/files/:id/download', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          token: { type: 'string' },
        },
      },
    },
    config: {
      rateLimit: {
        max: process.env.VITEST ? 10000 : 30,
        timeWindow: '1 minute',
      },
    },
  }, async (req, reply) => {
    const token = (req.query as Record<string, string>).token;
    const authResult = await authenticateToken(token, reply);
    if (authResult === false) return;

    const params = parseParams(UuidParams, req.params, reply);
    if (!params) return;

    const asset = await prisma.asset.findUnique({
      where: { id: params.id },
      select: { storageKey: true, originalName: true, mimeType: true, deletedAt: true },
    });
    if (!asset || asset.deletedAt !== null) return reply.status(404).send({ error: 'Not found' });

    const storage = await getStorageProvider();
    const { stream, contentType, contentLength } = await storage.download(asset.storageKey);

    const mime = contentType ?? asset.mimeType ?? 'application/octet-stream';
    const filename = encodeURIComponent(asset.originalName);

    reply.header('Content-Type', mime);
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    if (contentLength) reply.header('Content-Length', contentLength);

    logAudit({
      userId:    authResult ?? undefined,
      assetId:   params.id,
      assetName: asset.originalName,
      ipAddress: req.ip,
      action:    'DOWNLOAD',
      details:   { userAgent: req.headers['user-agent'] },
    });

    return reply.send(stream);
  });

  // Inline stream for previews — no Content-Disposition attachment
  app.get<{ Params: { id: string } }>('/api/files/:id/stream', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          token: { type: 'string' },
        },
      },
    },
    config: {
      rateLimit: {
        max: process.env.VITEST ? 10000 : 20,
        timeWindow: '1 minute',
      },
    },
  }, async (req, reply) => {
    const token = (req.query as Record<string, string>).token;
    if (await authenticateToken(token, reply) === false) return;

    const params = parseParams(UuidParams, req.params, reply);
    if (!params) return;

    const asset = await prisma.asset.findUnique({
      where: { id: params.id },
      select: { storageKey: true, mimeType: true, deletedAt: true },
    });
    if (!asset || asset.deletedAt !== null) return reply.status(404).send({ error: 'Not found' });

    const storage = await getStorageProvider();
    const { stream, contentType, contentLength } = await storage.download(asset.storageKey);

    reply.header('Content-Type', contentType ?? asset.mimeType ?? 'application/octet-stream');
    if (contentLength) reply.header('Content-Length', contentLength);

    return reply.send(stream);
  });

  // Streams the generated thumbnail — 404 if no thumbnail exists for this asset
  app.get<{ Params: { id: string } }>('/api/files/:id/thumbnail', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          token: { type: 'string' },
        },
      },
    },
    config: {
      rateLimit: {
        max: process.env.VITEST ? 10000 : 60,
        timeWindow: '1 minute',
      },
    },
  }, async (req, reply) => {
    const token = (req.query as Record<string, string>).token;
    if (await authenticateToken(token, reply) === false) return;

    const params = parseParams(UuidParams, req.params, reply);
    if (!params) return;

    const asset = await prisma.asset.findUnique({
      where: { id: params.id },
      select: { thumbnailKey: true, deletedAt: true },
    });
    if (!asset || asset.deletedAt !== null || !asset.thumbnailKey) return reply.status(404).send({ error: 'No thumbnail available' });

    const storage = await getStorageProvider();
    const { stream, contentType, contentLength } = await storage.download(asset.thumbnailKey);

    reply.header('Content-Type', contentType ?? 'image/webp');
    if (contentLength) reply.header('Content-Length', contentLength);

    return reply.send(stream);
  });

  // Creates a copy of an asset with a non-conflicting suffixed name.
  // Returns the new asset record (same shape as GET /api/files/:id).
  app.post<{ Params: { id: string } }>('/api/files/:id/duplicate', async (req, reply) => {
    const params = parseParams(UuidParams, req.params, reply);
    if (!params) return;

    // Fetch the source asset — cannot duplicate a trashed asset
    const source = await prisma.asset.findUnique({
      where: { id: params.id },
      select: {
        ...assetSelect,
        storageKey: true,
        mimeType: true,
        deletedAt: true,
      },
    });
    if (!source || source.deletedAt !== null) return reply.status(404).send({ error: 'Not found' });

    // Gather all existing (non-deleted) names to avoid conflicts
    const allNames = await prisma.asset.findMany({
      where: { deletedAt: null },
      select: { originalName: true },
    });
    const existingNames = allNames.map((a) => a.originalName);

    // Derive the new name using the duplicate-suffix logic
    const newName = generateDuplicateName(existingNames, source.originalName);

    // Copy the S3 object under a new key
    const newId = uuidv4();
    const storageKey = `assets/${newId}/${newName}`;

    const storage = await getStorageProvider();
    await storage.copy(source.storageKey, storageKey);

    // Persist the new asset, copying all metadata from the source
    const newAsset = await prisma.asset.create({
      data: {
        id: newId,
        originalName: newName,
        mimeType: source.mimeType,
        sizeBytes: source.sizeBytes,
        storageKey,
        assetType: source.assetType,
        // Thumbnail is intentionally not copied — it is keyed to the source asset's path.
        // A fresh thumbnail would require re-processing the image.
        description: source.description,
        categoryId: source.categoryId,
        subcategoryId: source.subcategoryId,
        license: source.license,
        resolutionW: source.resolutionW,
        resolutionH: source.resolutionH,
        durationSeconds: source.durationSeconds,
      },
      select: assetSelect,
    });

    return reply.status(201).send(formatAsset(newAsset));
  });

  const UpdateFileSchema = z.object({
    name: z.string().min(1).optional(),
    description: z.string().max(2000).nullable().optional(),
    categoryId: z.string().uuid().nullable().optional(),
    subcategoryId: z.string().uuid().nullable().optional(),
    tags: z.array(z.string().min(1).max(100)).optional(),
  });

  // Rename / metadata edit. Tags are replaced wholesale when provided (not appended).
  app.patch<{ Params: { id: string } }>(
    '/api/files/:id',
    {
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
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1 },
            description: { type: ['string', 'null'], maxLength: 2000 },
            categoryId: { type: ['string', 'null'], format: 'uuid' },
            subcategoryId: { type: ['string', 'null'], format: 'uuid' },
            tags: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 100 } },
          },
        },
      },
      config: {
        rateLimit: {
          max: process.env.VITEST ? 10000 : 20,
          timeWindow: '1 minute',
        },
      },
    },
    async (req, reply) => {
      const params = parseParams(UuidParams, req.params, reply);
      if (!params) return;

      const body = parseBody(UpdateFileSchema, req.body, reply);
      if (!body) return;

      const existing = await prisma.asset.findUnique({
        where: { id: params.id },
        select: { id: true, uploadedBy: true, deletedAt: true },
      });
      if (!existing || existing.deletedAt !== null) return reply.status(404).send({ error: 'Not found' });

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

      void logAudit({
        userId:    req.user.userId,
        assetId:   params.id,
        assetName: updated.originalName,
        ipAddress: req.ip,
        action:    AuditAction.UPDATE_METADATA,
        details:   { userAgent: req.headers['user-agent'] },
      });

      return reply.send(formatAsset(updated));
    },
  );

  const BulkIdsSchema = z.object({
    ids: z.array(z.string().uuid()).min(1).max(100),
  });

  // Bulk soft-delete: marks each asset as trashed (sets deleted_at/deleted_by) and moves
  // its S3 objects to the trash/ prefix — same per-asset semantics as DELETE /api/files/:id.
  // Per-asset error model: unauthorized/missing IDs and per-asset storage/DB failures land
  // in errors[]; one asset's failure never aborts the rest. Trashed assets flow into
  // GET /api/trash and the 30-day auto-purge job like single-file deletes.
  app.post('/api/files/bulk-delete', {
    schema: {
      body: {
        type: 'object',
        required: ['ids'],
        additionalProperties: false,
        properties: {
          ids: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
            minItems: 1,
            maxItems: 100,
          },
        },
      },
    },
    config: {
      rateLimit: {
        max: process.env.VITEST ? 10000 : 20,
        timeWindow: '1 minute',
      },
    },
  }, async (req, reply) => {
    const body = parseBody(BulkIdsSchema, req.body, reply);
    if (!body) return;

    const { userId, role } = req.user;
    const ids = [...new Set(body.ids)];

    // Trashed assets are invisible to bulk ops — they report as Not found
    const assets = await prisma.asset.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, storageKey: true, thumbnailKey: true, uploadedBy: true, originalName: true },
    });

    const deleted: string[] = [];
    const errors: { id: string; reason: string }[] = [];

    const authorizedAssets: typeof assets = [];
    for (const id of ids) {
      const asset = assets.find((a) => a.id === id);
      if (!asset) { errors.push({ id, reason: 'Not found' }); continue; }
      if (role !== 'admin' && asset.uploadedBy !== userId) { errors.push({ id, reason: 'Unauthorized' }); continue; }
      authorizedAssets.push(asset);
    }

    const storage = await getStorageProvider();

    for (const asset of authorizedAssets) {
      const trashKey = `trash/${asset.id}/${asset.originalName}`;
      const trashThumbnailKey = asset.thumbnailKey ? `trash/${asset.id}/thumbnail.webp` : null;

      // Move main storage object. A missing source object is tolerated: the DB is the
      // source of truth, and refusing to trash an asset whose bytes are already gone
      // would leave an undeletable ghost. Any other storage error fails this asset only —
      // the DB row is untouched, so it must not proceed to the update below.
      try {
        await storage.move(asset.storageKey, trashKey);
      } catch (err) {
        if (!(err instanceof StorageNotFoundError)) {
          req.log.error({ assetId: asset.id, storageKey: asset.storageKey, err }, 'bulk-delete: storage move to trash failed');
          errors.push({ id: asset.id, reason: 'Storage error' });
          continue;
        }
        req.log.warn({ assetId: asset.id, storageKey: asset.storageKey }, 'bulk-delete: storage object already missing — trashing DB record only');
      }

      // Move thumbnail (best-effort — log failure, do not abort)
      let thumbnailMoved = false;
      if (asset.thumbnailKey && trashThumbnailKey) {
        try {
          await storage.move(asset.thumbnailKey, trashThumbnailKey);
          thumbnailMoved = true;
        } catch (err) {
          req.log.warn({ assetId: asset.id, err }, 'bulk-delete: failed to move thumbnail to trash');
        }
      }

      // Soft-delete in DB — storageKey always reflects the successful main move;
      // thumbnailKey only updated to the new trash path if the thumbnail move succeeded.
      // deletedAt: null in the where clause guards the race where another request
      // trashed the asset between our findMany and this update (P2025 → Not found).
      try {
        await prisma.asset.update({
          where: { id: asset.id, deletedAt: null },
          data: {
            deletedAt: new Date(),
            deletedBy: userId,
            storageKey: trashKey,
            thumbnailKey: thumbnailMoved ? trashThumbnailKey : asset.thumbnailKey,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
          errors.push({ id: asset.id, reason: 'Not found' });
        } else {
          errors.push({ id: asset.id, reason: err instanceof Error ? err.message : 'Unknown error' });
        }
        continue;
      }

      void logAudit({
        userId,
        assetId: asset.id,
        assetName: asset.originalName,
        ipAddress: req.ip,
        action:    AuditAction.DELETE,
        details:   { userAgent: req.headers['user-agent'], deletedAssetId: asset.id },
      });

      deleted.push(asset.id);
    }

    return reply.send({ deleted, errors });
  });

  // Bulk download: streams the requested assets as a single ZIP archive.
  // Non-admins must own every requested asset (all-or-nothing 403).
  app.post('/api/files/bulk-download', {
    schema: {
      body: {
        type: 'object',
        required: ['ids'],
        additionalProperties: false,
        properties: {
          ids: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
            minItems: 1,
            maxItems: 100,
          },
        },
      },
    },
    config: {
      rateLimit: {
        max: process.env.VITEST ? 10000 : 10,
        timeWindow: '1 minute',
      },
    },
  }, async (req, reply) => {
    const body = parseBody(BulkIdsSchema, req.body, reply);
    if (!body) return;

    const { userId, role } = req.user;
    const ids = [...new Set(body.ids)];

    const assets = await prisma.asset.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, storageKey: true, originalName: true, uploadedBy: true },
    });

    if (role !== 'admin') {
      for (const asset of assets) {
        if (asset.uploadedBy !== userId) {
          return reply.status(403).send({ error: 'Forbidden: you do not own all requested assets' });
        }
      }
    }

    // Resolve the provider before hijacking so a storage config error can still
    // produce a normal 500 response.
    const storage = await getStorageProvider();

    reply.hijack();
    reply.raw.setHeader('Content-Type', 'application/zip');
    reply.raw.setHeader('Content-Disposition', 'attachment; filename=assets.zip');

    const archive = new ZipArchive({ zlib: { level: 6 } });
    archive.pipe(reply.raw);
    archive.on('error', (err) => reply.raw.destroy(err));

    // After hijack() no normal reply can be sent — any storage failure must
    // destroy the socket, otherwise the client hangs forever waiting for a
    // response that will never come.
    try {
      const nameCounts = new Map<string, number>();
      for (const asset of assets) {
        const { stream } = await storage.download(asset.storageKey);
        const count = nameCounts.get(asset.originalName) ?? 0;
        nameCounts.set(asset.originalName, count + 1);
        let archiveName: string;
        if (count === 0) {
          archiveName = asset.originalName;
        } else {
          const dotIdx = asset.originalName.lastIndexOf('.');
          archiveName = dotIdx === -1
            ? `${asset.originalName} (${count})`
            : `${asset.originalName.slice(0, dotIdx)} (${count})${asset.originalName.slice(dotIdx)}`;
        }
        archive.append(stream, { name: archiveName });

        void logAudit({
          userId,
          assetId:   asset.id,
          assetName: asset.originalName,
          ipAddress: req.ip,
          action:    AuditAction.DOWNLOAD,
          details:   { userAgent: req.headers['user-agent'], bulk: true },
        });
      }

      await archive.finalize();
    } catch (err) {
      req.log.error({ err }, 'bulk-download: storage error after hijack — destroying socket');
      archive.destroy();
      reply.raw.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  });

  // Soft-delete: marks the asset as trashed (sets deleted_at/deleted_by) and moves
  // its S3 objects to the trash/ prefix so live and trashed objects are distinguishable.
  // The 30-day auto-purge job (trashPurge.ts) uses storageKey from the DB, so keeping
  // the DB in sync here is all that is needed for purge to work correctly.
  app.delete<{ Params: { id: string } }>('/api/files/:id', {
    config: {
      rateLimit: {
        max: process.env.VITEST ? 10000 : 10,
        timeWindow: '1 minute',
      },
    },
  }, async (req, reply) => {
    const params = parseParams(UuidParams, req.params, reply);
    if (!params) return;

    const { userId, role } = req.user;

    // Step 1: Fetch current asset (live only) — need storageKey/thumbnailKey for S3 moves
    const existing = await prisma.asset.findFirst({
      where: { id: params.id, deletedAt: null },
      select: { originalName: true, storageKey: true, thumbnailKey: true, uploadedBy: true },
    });
    if (!existing) return reply.status(404).send({ error: 'Not found' });

    // Ownership check: only admin or the uploader can delete
    if (role !== 'admin' && existing.uploadedBy !== userId) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    // Step 2: Compute trash keys
    const trashKey = `trash/${params.id}/${existing.originalName}`;
    const trashThumbnailKey = existing.thumbnailKey ? `trash/${params.id}/thumbnail.webp` : null;

    // Step 3: Move main storage object (fail-hard — nothing has changed yet if this throws).
    // A missing source object is tolerated: the DB is the source of truth, and refusing
    // to trash an asset whose bytes are already gone would leave an undeletable ghost.
    const storage = await getStorageProvider();
    try {
      await storage.move(existing.storageKey, trashKey);
    } catch (err) {
      if (!(err instanceof StorageNotFoundError)) throw err;
      req.log.warn({ assetId: params.id, storageKey: existing.storageKey }, 'soft-delete: storage object already missing — trashing DB record only');
    }

    // Step 4: Move thumbnail (best-effort — log failure, do not abort)
    let thumbnailMoved = false;
    if (existing.thumbnailKey && trashThumbnailKey) {
      try {
        await storage.move(existing.thumbnailKey, trashThumbnailKey);
        thumbnailMoved = true;
      } catch (err) {
        console.error(`[files] soft-delete: failed to move thumbnail for asset ${params.id}:`, err);
      }
    }

    // Step 5: Update DB — storageKey always reflects the successful main move;
    // thumbnailKey only updated to the new trash path if the thumbnail move succeeded.
    let asset: { originalName: string };
    try {
      asset = await prisma.asset.update({
        where: { id: params.id, deletedAt: null },
        data: {
          deletedAt: new Date(),
          deletedBy: req.user.userId,
          storageKey: trashKey,
          thumbnailKey: thumbnailMoved ? trashThumbnailKey : existing.thumbnailKey,
        },
        select: { originalName: true },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        // Race condition: another request deleted the asset between our findFirst and update
        return reply.status(404).send({ error: 'Not found' });
      }
      throw err;
    }

    // Step 6: Log audit and return 204
    void logAudit({
      userId: req.user.userId,
      action: AuditAction.DELETE,
      assetId: params.id,
      assetName: asset.originalName,
      ipAddress: req.ip,
    });

    return reply.status(204).send();
  });

  // Returns all soft-deleted assets for the current user's company, ordered by deletion date.
  app.get('/api/trash', async (req, reply) => {
    const assets = await prisma.asset.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
      select: {
        id: true,
        originalName: true,
        mimeType: true,
        sizeBytes: true,
        thumbnailKey: true,
        deletedAt: true,
        deletedBy: true,
        storageKey: true,
        assetType: true,
      },
    });

    return reply.send(
      assets.map((a) => ({
        id: a.id,
        original_name: a.originalName,
        mime_type: a.mimeType,
        size_bytes: a.sizeBytes !== null ? Number(a.sizeBytes) : null,
        asset_type: a.assetType,
        thumbnail_key: a.thumbnailKey,
        deleted_at: a.deletedAt,
        deleted_by: a.deletedBy,
        storage_key: a.storageKey,
      })),
    );
  });

  // Restores a soft-deleted asset: moves S3 objects back to assets/ prefix,
  // clears deleted_at/deleted_by, and logs RESTORE.
  app.post<{ Params: { id: string } }>('/api/files/:id/restore', async (req, reply) => {
    const params = parseParams(UuidParams, req.params, reply);
    if (!params) return;

    const { userId, role } = req.user;

    // Step 1: Fetch current asset (trashed only) — need storageKey/thumbnailKey for S3 moves.
    // assetSelect does not include internal S3 fields, so we fetch them separately here.
    const existing = await prisma.asset.findFirst({
      where: { id: params.id, deletedAt: { not: null } },
      select: { originalName: true, storageKey: true, thumbnailKey: true, uploadedBy: true },
    });
    if (!existing) return reply.status(404).send({ error: 'Not found or not in trash' });

    // Ownership check: only admin or the uploader can restore (mirrors the soft-delete handler)
    if (role !== 'admin' && existing.uploadedBy !== userId) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    // Step 2: Compute restore keys
    const restoreKey = `assets/${params.id}/${existing.originalName}`;
    const restoreThumbnailKey = existing.thumbnailKey ? `assets/${params.id}/thumbnail.webp` : null;

    // Step 3: Move main storage object (fail-hard — nothing has changed yet if this throws).
    // Skip the move if storageKey is already at the restore path (e.g. legacy data never trashed).
    const storage = await getStorageProvider();
    if (existing.storageKey !== restoreKey) {
      await storage.move(existing.storageKey, restoreKey);
    }

    // Step 4: Move thumbnail (best-effort — log failure, do not abort)
    let thumbnailMoved = false;
    if (existing.thumbnailKey && restoreThumbnailKey && existing.thumbnailKey !== restoreThumbnailKey) {
      try {
        await storage.move(existing.thumbnailKey, restoreThumbnailKey);
        thumbnailMoved = true;
      } catch (err) {
        console.error(`[files] restore: failed to move thumbnail for asset ${params.id}:`, err);
      }
    }

    // Step 5: Update DB — restore asset, update storage keys to match S3 state.
    // thumbnailKey only updated to the restore path if the thumbnail move succeeded.
    let asset: { originalName: string } & AssetSelect;
    try {
      asset = await prisma.asset.update({
        where: { id: params.id, deletedAt: { not: null } },
        data: {
          deletedAt: null,
          deletedBy: null,
          storageKey: restoreKey,
          thumbnailKey: thumbnailMoved ? restoreThumbnailKey : existing.thumbnailKey,
        },
        select: { ...assetSelect, originalName: true },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        // Race condition: another request restored or purged the asset between our findFirst and update
        return reply.status(404).send({ error: 'Not found or not in trash' });
      }
      throw err;
    }

    // Step 6: Log audit and return 200
    void logAudit({
      userId: req.user.userId,
      action: AuditAction.RESTORE,
      assetId: params.id,
      assetName: asset.originalName,
      ipAddress: req.ip,
    });

    return reply.status(200).send(formatAsset(asset));
  });

  // Hard-deletes an asset: removes the DB record AND the S3 object(s).
  // Requires the asset to already be soft-deleted (in the trash).
  // Use this to permanently purge a trashed asset before the 30-day auto-purge window.
  app.delete<{ Params: { id: string } }>('/api/files/:id/purge', async (req, reply) => {
    const params = parseParams(UuidParams, req.params, reply);
    if (!params) return;

    const { userId, role } = req.user;

    // Step 1: Fetch BEFORE deleting. Purge is irreversible, so the ownership check
    // must run while the row still exists — deleting first destroys the very data
    // the check depends on (and the asset itself) for unauthorized callers.
    const existing = await prisma.asset.findFirst({
      where: { id: params.id, deletedAt: { not: null } },
      select: { uploadedBy: true },
    });
    if (!existing) return reply.status(404).send({ error: 'Not found or not in trash' });

    // Step 2: Ownership check: only admin or the uploader can purge (mirrors the soft-delete handler)
    if (role !== 'admin' && existing.uploadedBy !== userId) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    // Step 3: Delete. The where clause still re-asserts deletedAt so a concurrent
    // restore between the fetch and here cannot purge a live asset.
    let assetForS3: { storageKey: string; thumbnailKey: string | null; originalName: string };
    try {
      // Only allow purging assets that are already in the trash
      assetForS3 = await prisma.asset.delete({
        where: { id: params.id, deletedAt: { not: null } },
        select: { storageKey: true, thumbnailKey: true, originalName: true },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return reply.status(404).send({ error: 'Not found or not in trash' });
      }
      throw err;
    }

    // assetId must go in details: the asset row is already deleted, so a real
    // assetId FK reference would make the audit insert fail.
    void logAudit({
      userId: req.user.userId,
      action: AuditAction.DELETE,
      assetName: assetForS3.originalName,
      ipAddress: req.ip,
      details: { purgedAssetId: params.id },
    });

    // Await storage deletions so failures are surfaced to the caller instead of silently orphaning objects.
    // Both providers treat deleting a non-existent key as success (S3 DeleteObject is idempotent; disk tolerates ENOENT).
    const storage = await getStorageProvider();
    await storage.delete(assetForS3.storageKey);
    if (assetForS3.thumbnailKey) {
      await storage.delete(assetForS3.thumbnailKey);
    }

    return reply.status(204).send();
  });
}
