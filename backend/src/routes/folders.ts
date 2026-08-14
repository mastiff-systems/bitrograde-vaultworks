/**
 * MAS-368: Folder feature — all 7 REST endpoints.
 *
 * Routes:
 *   GET    /api/folders                      — list folders (with asset count)
 *   POST   /api/folders                      — create folder
 *   PATCH  /api/folders/:id                  — rename / reparent (guards circular ancestor)
 *   DELETE /api/folders/:id                  — hard delete; memberships cascade, assets persist
 *   GET    /api/folders/:id/assets           — cursor-paginated asset list
 *   POST   /api/folders/:id/assets           — add assets (bulk, skipDuplicates)
 *   DELETE /api/folders/:id/assets/:assetId  — remove one membership
 */
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { parseBody, parseParams } from '../lib/validate.js';

// ─── Param schemas ──────────────────────────────────────────────────────────

const FolderIdParams = z.object({ id: z.string().uuid('Invalid folder ID') });
const FolderAssetParams = z.object({
  id: z.string().uuid('Invalid folder ID'),
  assetId: z.string().uuid('Invalid asset ID'),
});

// ─── Body schemas ────────────────────────────────────────────────────────────

const CreateFolderBody = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  parentFolderId: z.string().uuid().optional(),
});

const UpdateFolderBody = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).nullable().optional(),
  parentFolderId: z.string().uuid().nullable().optional(),
});

const AddAssetsBody = z.object({
  assetIds: z.array(z.string().uuid()).min(1).max(100),
});

// ─── Query schemas ───────────────────────────────────────────────────────────

const ListFoldersQuery = z.object({
  parentFolderId: z.string().optional(), // uuid | "root" | undefined
});

const ListAssetsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional(),
});

// ─── Shared asset select (mirrors files.ts) ──────────────────────────────────

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

type AssetRow = {
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
  tags: { tag: { id: string; name: string } }[];
};

function formatAsset(a: AssetRow) {
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

// ─── Folder formatter ────────────────────────────────────────────────────────

function formatFolder(f: {
  id: string;
  name: string;
  description: string | null;
  createdByUserId: string | null;
  parentFolderId: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count: { assets: number };
}) {
  return {
    id: f.id,
    name: f.name,
    description: f.description,
    parent_folder_id: f.parentFolderId,
    created_by_user_id: f.createdByUserId,
    asset_count: f._count.assets,
    created_at: f.createdAt,
    updated_at: f.updatedAt,
  };
}

const folderSelect = {
  id: true,
  name: true,
  description: true,
  createdByUserId: true,
  parentFolderId: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { assets: true } },
} as const;

// ─── Circular ancestor guard ─────────────────────────────────────────────────

/**
 * Returns true if `candidateParentId` is a descendant of `folderId`
 * (or IS `folderId`), which would create a cycle.
 */
async function wouldCreateCycle(folderId: string, candidateParentId: string): Promise<boolean> {
  // Walk up the ancestor chain of candidateParentId; if we ever reach folderId, it's a cycle.
  let current: string | null = candidateParentId;
  const visited = new Set<string>();
  while (current !== null) {
    if (current === folderId) return true;
    if (visited.has(current)) break; // safety guard against existing corruption
    visited.add(current);
    const row: { parentFolderId: string | null } | null = await prisma.folder.findUnique({
      where: { id: current },
      select: { parentFolderId: true },
    });
    current = row?.parentFolderId ?? null;
  }
  return false;
}

// ─── Plugin ──────────────────────────────────────────────────────────────────

export async function foldersRoutes(app: FastifyInstance) {
  // GET /api/folders
  app.get('/api/folders', async (req, reply) => {
    const qResult = ListFoldersQuery.safeParse(req.query);
    if (!qResult.success) return reply.status(400).send({ error: 'Invalid query' });
    const { parentFolderId } = qResult.data;

    const where =
      parentFolderId === 'root'
        ? { parentFolderId: null }
        : parentFolderId
          ? { parentFolderId }
          : {};

    const folders = await prisma.folder.findMany({ where, select: folderSelect, orderBy: { name: 'asc' } });
    return reply.send(folders.map(formatFolder));
  });

  // POST /api/folders
  app.post('/api/folders', async (req, reply) => {
    const body = parseBody(CreateFolderBody, req.body, reply);
    if (!body) return;

    // Verify parentFolderId exists if provided
    if (body.parentFolderId) {
      const parent = await prisma.folder.findUnique({ where: { id: body.parentFolderId }, select: { id: true } });
      if (!parent) return reply.status(404).send({ error: 'Parent folder not found' });
    }

    const userId = req.user?.userId ?? null;

    const folder = await prisma.folder.create({
      data: {
        name: body.name,
        description: body.description,
        parentFolderId: body.parentFolderId ?? null,
        createdByUserId: userId,
      },
      select: folderSelect,
    });

    return reply.status(201).send(formatFolder(folder));
  });

  // PATCH /api/folders/:id
  app.patch('/api/folders/:id', async (req, reply) => {
    const params = parseParams(FolderIdParams, req.params, reply);
    if (!params) return;
    const body = parseBody(UpdateFolderBody, req.body, reply);
    if (!body) return;

    const existing = await prisma.folder.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!existing) return reply.status(404).send({ error: 'Folder not found' });

    // Guard against circular parent reference
    if (body.parentFolderId) {
      if (body.parentFolderId === params.id) {
        return reply.status(409).send({ error: 'A folder cannot be its own parent' });
      }
      const cycle = await wouldCreateCycle(params.id, body.parentFolderId);
      if (cycle) return reply.status(409).send({ error: 'Circular parent reference detected' });

      const parent = await prisma.folder.findUnique({ where: { id: body.parentFolderId }, select: { id: true } });
      if (!parent) return reply.status(404).send({ error: 'Parent folder not found' });
    }

    const updateData: {
      name?: string;
      description?: string | null;
      parentFolderId?: string | null;
    } = {};
    if (body.name !== undefined) updateData.name = body.name;
    if ('description' in body) updateData.description = body.description ?? null;
    if ('parentFolderId' in body) updateData.parentFolderId = body.parentFolderId ?? null;

    const folder = await prisma.folder.update({
      where: { id: params.id },
      data: updateData,
      select: folderSelect,
    });

    return reply.send(formatFolder(folder));
  });

  // DELETE /api/folders/:id
  app.delete('/api/folders/:id', async (req, reply) => {
    const params = parseParams(FolderIdParams, req.params, reply);
    if (!params) return;

    const existing = await prisma.folder.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!existing) return reply.status(404).send({ error: 'Folder not found' });

    await prisma.folder.delete({ where: { id: params.id } });
    return reply.status(204).send();
  });

  // GET /api/folders/:id/assets
  app.get('/api/folders/:id/assets', async (req, reply) => {
    const params = parseParams(FolderIdParams, req.params, reply);
    if (!params) return;
    const qResult = ListAssetsQuery.safeParse(req.query);
    if (!qResult.success) return reply.status(400).send({ error: 'Invalid query' });
    const { limit, cursor } = qResult.data;

    const folder = await prisma.folder.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!folder) return reply.status(404).send({ error: 'Folder not found' });

    // Cursor-based pagination: WHERE asset_id > cursor ORDER BY asset_id ASC LIMIT limit+1
    const rows = await prisma.folderAsset.findMany({
      where: {
        folderId: params.id,
        ...(cursor ? { assetId: { gt: cursor } } : {}),
      },
      orderBy: { assetId: 'asc' },
      take: limit + 1,
      select: { asset: { select: assetSelect } },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? page[page.length - 1].asset.id : null;

    return reply.send({
      assets: page.map((r) => formatAsset(r.asset)),
      nextCursor,
    });
  });

  // POST /api/folders/:id/assets
  app.post('/api/folders/:id/assets', async (req, reply) => {
    const params = parseParams(FolderIdParams, req.params, reply);
    if (!params) return;
    const body = parseBody(AddAssetsBody, req.body, reply);
    if (!body) return;

    const folder = await prisma.folder.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!folder) return reply.status(404).send({ error: 'Folder not found' });

    // Validate all assetIds exist
    const foundAssets = await prisma.asset.findMany({
      where: { id: { in: body.assetIds } },
      select: { id: true },
    });
    if (foundAssets.length !== body.assetIds.length) {
      return reply.status(422).send({ error: 'One or more asset IDs do not exist' });
    }

    const result = await prisma.folderAsset.createMany({
      data: body.assetIds.map((assetId) => ({ folderId: params.id, assetId })),
      skipDuplicates: true,
    });

    return reply.send({ added: result.count });
  });

  // DELETE /api/folders/:id/assets/:assetId
  app.delete('/api/folders/:id/assets/:assetId', async (req, reply) => {
    const params = parseParams(FolderAssetParams, req.params, reply);
    if (!params) return;

    const membership = await prisma.folderAsset.findUnique({
      where: { folderId_assetId: { folderId: params.id, assetId: params.assetId } },
      select: { folderId: true },
    });
    if (!membership) return reply.status(404).send({ error: 'Folder or membership not found' });

    await prisma.folderAsset.delete({
      where: { folderId_assetId: { folderId: params.id, assetId: params.assetId } },
    });
    return reply.status(204).send();
  });
}
