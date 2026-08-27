import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/client.js';
import { copyS3Object, deleteFromS3, getS3ObjectStream, moveS3Object } from '../storage/s3.js';
import { parseParams } from '../lib/validate.js';
import { verifyLocalToken } from '../auth/tokens.js';
import { verifyKeycloakToken } from '../auth/keycloak.js';
import { generateDuplicateName } from '../lib/filename.js';
import { logAudit, AuditAction } from '../lib/audit.js';

async function authenticateToken(token: string | undefined, reply: Parameters<typeof parseParams>[2]): Promise<boolean> {
  if (!token) { reply.status(401).send({ error: 'token required' }); return false; }
  try {
    const provider = process.env.AUTH_PROVIDER ?? 'local';
    if (provider === 'keycloak') { await verifyKeycloakToken(token); } else { verifyLocalToken(token); }
    return true;
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
      // Soft-deleted assets are excluded: AND a.deleted_at IS NULL
      const rankedIds = await prisma.$queryRaw<{ id: string }[]>`
        SELECT a.id
        FROM assets a
        LEFT JOIN asset_tags jat ON jat.asset_id = a.id
        LEFT JOIN tags t ON t.id = jat.tag_id
        WHERE a.deleted_at IS NULL
        AND (
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
        where: { id: { in: ids }, deletedAt: null },
        select: assetSelect,
      });

      // Restore ranked order from phase 1
      const orderMap = new Map(ids.map((id, i) => [id, i]));
      const sorted = assets.sort(
        (a, b) => (orderMap.get(a.id) ?? 999) - (orderMap.get(b.id) ?? 999),
      );

      return reply.send(sorted.map(formatAsset));
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
  app.get<{ Params: { id: string } }>('/api/files/:id/download', async (req, reply) => {
    const token = (req.query as Record<string, string>).token;
    if (!await authenticateToken(token, reply)) return;

    const params = parseParams(UuidParams, req.params, reply);
    if (!params) return;

    const asset = await prisma.asset.findUnique({
      where: { id: params.id },
      select: { storageKey: true, originalName: true, mimeType: true, deletedAt: true },
    });
    if (!asset || asset.deletedAt !== null) return reply.status(404).send({ error: 'Not found' });

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
    const token = (req.query as Record<string, string>).token;
    if (!await authenticateToken(token, reply)) return;

    const params = parseParams(UuidParams, req.params, reply);
    if (!params) return;

    const asset = await prisma.asset.findUnique({
      where: { id: params.id },
      select: { storageKey: true, mimeType: true, deletedAt: true },
    });
    if (!asset || asset.deletedAt !== null) return reply.status(404).send({ error: 'Not found' });

    const { stream, contentType, contentLength } = await getS3ObjectStream(asset.storageKey);

    reply.header('Content-Type', contentType ?? asset.mimeType ?? 'application/octet-stream');
    if (contentLength) reply.header('Content-Length', contentLength);

    return reply.send(stream);
  });

  // Streams the generated thumbnail — 404 if no thumbnail exists for this asset
  app.get<{ Params: { id: string } }>('/api/files/:id/thumbnail', async (req, reply) => {
    const token = (req.query as Record<string, string>).token;
    if (!await authenticateToken(token, reply)) return;

    const params = parseParams(UuidParams, req.params, reply);
    if (!params) return;

    const asset = await prisma.asset.findUnique({
      where: { id: params.id },
      select: { thumbnailKey: true, deletedAt: true },
    });
    if (!asset || asset.deletedAt !== null || !asset.thumbnailKey) return reply.status(404).send({ error: 'No thumbnail available' });

    const { stream, contentType, contentLength } = await getS3ObjectStream(asset.thumbnailKey);

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

    await copyS3Object(source.storageKey, storageKey);

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

  // Soft-delete: marks the asset as trashed (sets deleted_at/deleted_by) and moves
  // its S3 objects to the trash/ prefix so live and trashed objects are distinguishable.
  // The 30-day auto-purge job (trashPurge.ts) uses storageKey from the DB, so keeping
  // the DB in sync here is all that is needed for purge to work correctly.
  app.delete<{ Params: { id: string } }>('/api/files/:id', async (req, reply) => {
    const params = parseParams(UuidParams, req.params, reply);
    if (!params) return;

    // Step 1: Fetch current asset (live only) — need storageKey/thumbnailKey for S3 moves
    const existing = await prisma.asset.findFirst({
      where: { id: params.id, deletedAt: null },
      select: { originalName: true, storageKey: true, thumbnailKey: true },
    });
    if (!existing) return reply.status(404).send({ error: 'Not found' });

    // Step 2: Compute trash keys
    const trashKey = `trash/${params.id}/${existing.originalName}`;
    const trashThumbnailKey = existing.thumbnailKey ? `trash/${params.id}/thumbnail.webp` : null;

    // Step 3: Move main S3 object (fail-hard — nothing has changed yet if this throws)
    await moveS3Object(existing.storageKey, trashKey);

    // Step 4: Move thumbnail (best-effort — log failure, do not abort)
    let thumbnailMoved = false;
    if (existing.thumbnailKey && trashThumbnailKey) {
      try {
        await moveS3Object(existing.thumbnailKey, trashThumbnailKey);
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

    // Step 1: Fetch current asset (trashed only) — need storageKey/thumbnailKey for S3 moves.
    // assetSelect does not include internal S3 fields, so we fetch them separately here.
    const existing = await prisma.asset.findFirst({
      where: { id: params.id, deletedAt: { not: null } },
      select: { originalName: true, storageKey: true, thumbnailKey: true },
    });
    if (!existing) return reply.status(404).send({ error: 'Not found or not in trash' });

    // Step 2: Compute restore keys
    const restoreKey = `assets/${params.id}/${existing.originalName}`;
    const restoreThumbnailKey = existing.thumbnailKey ? `assets/${params.id}/thumbnail.webp` : null;

    // Step 3: Move main S3 object (fail-hard — nothing has changed yet if this throws).
    // Skip the move if storageKey is already at the restore path (e.g. legacy data never trashed).
    if (existing.storageKey !== restoreKey) {
      await moveS3Object(existing.storageKey, restoreKey);
    }

    // Step 4: Move thumbnail (best-effort — log failure, do not abort)
    let thumbnailMoved = false;
    if (existing.thumbnailKey && restoreThumbnailKey && existing.thumbnailKey !== restoreThumbnailKey) {
      try {
        await moveS3Object(existing.thumbnailKey, restoreThumbnailKey);
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

    void logAudit({
      userId: req.user.userId,
      action: AuditAction.DELETE,
      assetId: params.id,
      assetName: assetForS3.originalName,
      ipAddress: req.ip,
    });

    // Await S3 deletions so failures are surfaced to the caller instead of silently orphaning objects.
    // S3 DeleteObject is idempotent — returns success for non-existent keys.
    await deleteFromS3(assetForS3.storageKey);
    if (assetForS3.thumbnailKey) {
      await deleteFromS3(assetForS3.thumbnailKey);
    }

    return reply.status(204).send();
  });
}
