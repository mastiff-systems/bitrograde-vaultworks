import crypto from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/client.js';
import { getStorageProvider } from '../storage/index.js';
import { parseParams } from '../lib/validate.js';
import { verifyLocalToken } from '../auth/tokens.js';
import { verifyKeycloakToken } from '../auth/keycloak.js';
import { generateDuplicateName } from '../lib/filename.js';
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
        where: { originalName: params.exact_name },
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
          WHERE (
            similarity(a.original_name, ${q}) > 0.3
            OR a.original_name ILIKE ${like}
            OR a.description ILIKE ${like}
            OR (t.name IS NOT NULL AND (similarity(t.name, ${q}) > 0.3 OR t.name ILIKE ${like}))
          )
          ${extraFilters}
        `,
        prisma.$queryRaw<{ id: string }[]>`
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
            similarity(a.original_name, ${q}) DESC,
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
        where: { id: { in: ids } },
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

    const asset = await prisma.asset.findUnique({ where: { id: params.id }, select: assetSelect });
    if (!asset) return reply.status(404).send({ error: 'Not found' });

    const etag = makeEtag(`${asset.id}:${asset.updatedAt.toISOString()}`);
    const lastModified = asset.updatedAt.toUTCString();
    reply.header('ETag', etag);
    reply.header('Last-Modified', lastModified);
    reply.header('Cache-Control', 'no-cache');

    const ifNoneMatch = req.headers['if-none-match'];
    if (ifNoneMatch && ifNoneMatch === etag) return reply.status(304).send();

    const ifModifiedSince = req.headers['if-modified-since'];
    if (ifModifiedSince) {
      const since = new Date(ifModifiedSince);
      if (!isNaN(since.getTime())) {
        const updatedAtSec = Math.floor(asset.updatedAt.getTime() / 1000);
        const sinceSec = Math.floor(since.getTime() / 1000);
        if (updatedAtSec <= sinceSec) return reply.status(304).send();
      }
    }

    logAudit({
      prisma,
      userId:    req.user?.userId ?? null,
      assetId:   params.id,
      assetName: asset.originalName,
      ipAddress: req.ip,
      action:    'VIEW',
      metadata:  { userAgent: req.headers['user-agent'] },
    });

    return reply.send(formatAsset(asset));
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
      select: { storageKey: true, originalName: true, mimeType: true },
    });
    if (!asset) return reply.status(404).send({ error: 'Not found' });

    const storage = await getStorageProvider();
    const { stream, contentType, contentLength } = await storage.download(asset.storageKey);

    const mime = contentType ?? asset.mimeType ?? 'application/octet-stream';
    const filename = encodeURIComponent(asset.originalName);

    reply.header('Content-Type', mime);
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    if (contentLength) reply.header('Content-Length', contentLength);

    logAudit({
      prisma,
      userId:    authResult,
      assetId:   params.id,
      assetName: asset.originalName,
      ipAddress: req.ip,
      action:    'DOWNLOAD',
      metadata:  { userAgent: req.headers['user-agent'] },
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
      select: { storageKey: true, mimeType: true },
    });
    if (!asset) return reply.status(404).send({ error: 'Not found' });

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
      select: { thumbnailKey: true },
    });
    if (!asset || !asset.thumbnailKey) return reply.status(404).send({ error: 'No thumbnail available' });

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

    // Fetch the source asset
    const source = await prisma.asset.findUnique({
      where: { id: params.id },
      select: {
        ...assetSelect,
        storageKey: true,
        mimeType: true,
      },
    });
    if (!source) return reply.status(404).send({ error: 'Not found' });

    // Gather all existing names to avoid conflicts
    const allNames = await prisma.asset.findMany({ select: { originalName: true } });
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

  app.delete<{ Params: { id: string } }>('/api/files/:id', async (req, reply) => {
    const params = parseParams(UuidParams, req.params, reply);
    if (!params) return;

    const { userId, role } = req.user;

    const existing = await prisma.asset.findUnique({
      where: { id: params.id },
      select: { storageKey: true, thumbnailKey: true, uploadedBy: true, originalName: true },
    });
    if (!existing) return reply.status(404).send({ error: 'Not found' });
    if (role !== 'admin' && existing.uploadedBy !== userId) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const storage = await getStorageProvider();
    try {
      await prisma.asset.delete({ where: { id: params.id } });
      await storage.delete(existing.storageKey);
      if (existing.thumbnailKey) await storage.delete(existing.thumbnailKey);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return reply.status(404).send({ error: 'Not found' });
      }
      throw err;
    }

    logAudit({
      prisma,
      userId,
      assetId:   null,
      assetName: existing.originalName,
      ipAddress: req.ip,
      action:    'DELETE',
      metadata:  { userAgent: req.headers['user-agent'], deletedAssetId: params.id },
    });

    return reply.status(204).send();
  });
}
