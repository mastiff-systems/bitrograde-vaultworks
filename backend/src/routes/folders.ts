/**
 * MAS-368: Folder feature — REST endpoints.
 * MAS-710: nested hierarchy — tree/breadcrumb endpoints, trashed assets excluded
 * from listings and counts.
 * MAS-715: folder trash lifecycle — DELETE is now a soft-delete (deletedAt) of the
 * folder and its whole live subtree; trashed folders are invisible to every read
 * path (treated as nonexistent) until restored or purged. Assets are never trashed
 * by folder operations: folder_assets memberships are M2M and persist untouched so
 * a restore reproduces the exact structure.
 *
 * Routes:
 *   GET    /api/folders                      — list folders (with asset count; trashed excluded)
 *   GET    /api/folders/tree                 — full nested tree (or one subtree via ?folderId; trashed excluded)
 *   POST   /api/folders                      — create folder (trashed parent rejected as nonexistent)
 *   GET    /api/folders/:id/path             — breadcrumb ancestors, root → self (404 if trashed)
 *   PATCH  /api/folders/:id                  — rename / reparent (guards circular ancestor; trashed parent rejected)
 *   DELETE /api/folders/:id                  — trash: soft-deletes the folder + all live descendants in one
 *                                              transaction; memberships persist, assets untouched
 *   POST   /api/folders/:id/restore          — restore a trashed folder + all its trashed descendants;
 *                                              re-parents to root if its own parent is trashed/gone
 *   POST   /api/folders/:id/purge            — hard-delete a trashed folder; DB cascade removes descendants
 *                                              + memberships, assets persist (admin or folder creator)
 *   GET    /api/trash/folders                — top-level trashed folders with descendant counts
 *   GET    /api/folders/:id/assets           — cursor-paginated asset list (404 if folder trashed)
 *   POST   /api/folders/:id/assets           — add assets (bulk, skipDuplicates)
 *   DELETE /api/folders/:id/assets/:assetId  — remove one membership
 */
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
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
  assetId: z.string().uuid().optional(), // filter to folders containing this asset
});

const ListAssetsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional(),
});

const TreeQuery = z.object({
  folderId: z.string().uuid().optional(), // return only this folder's subtree
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

// asset_count excludes trashed assets so folder badges match what listings show
const folderSelect = {
  id: true,
  name: true,
  description: true,
  createdByUserId: true,
  parentFolderId: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { assets: { where: { asset: { deletedAt: null } } } } },
} as const;

// ─── Subtree walk ────────────────────────────────────────────────────────────

/**
 * Collect `rootId` plus all descendant folder IDs whose trash state matches
 * `state` ('live' → deletedAt null, 'trashed' → deletedAt set). App-level BFS:
 * folder counts are small (MAS-708 §2), so iterative queries beat a recursive
 * CTE and keep the walk inside the caller's transaction client.
 */
async function collectSubtreeIds(
  tx: Pick<typeof prisma, 'folder'>,
  rootId: string,
  state: 'live' | 'trashed',
): Promise<string[]> {
  const deletedAt = state === 'live' ? null : { not: null };
  const ids = [rootId];
  const visited = new Set(ids);
  let frontier = ids;
  while (frontier.length > 0) {
    const children = await tx.folder.findMany({
      where: { parentFolderId: { in: frontier }, deletedAt },
      select: { id: true },
    });
    frontier = children.map((c) => c.id).filter((id) => !visited.has(id));
    for (const id of frontier) {
      visited.add(id);
      ids.push(id);
    }
  }
  return ids;
}

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
  // Supports ?parentFolderId=root|<uuid> and ?assetId=<uuid> (folders containing the asset)
  app.get('/api/folders', async (req, reply) => {
    const qResult = ListFoldersQuery.safeParse(req.query);
    if (!qResult.success) return reply.status(400).send({ error: 'Invalid query' });
    const { parentFolderId, assetId } = qResult.data;

    // Build where clause: parentFolderId filter + optional assetId membership filter.
    // Trashed folders are invisible to listings (MAS-715).
    const where: Record<string, unknown> = {
      deletedAt: null,
      ...(parentFolderId === 'root'
        ? { parentFolderId: null }
        : parentFolderId
          ? { parentFolderId }
          : {}),
    };

    if (assetId) {
      where.assets = { some: { assetId } };
    }

    const folders = await prisma.folder.findMany({ where, select: folderSelect, orderBy: { name: 'asc' } });
    return reply.send(folders.map(formatFolder));
  });

  // GET /api/folders/tree
  // Returns the full folder forest as nested nodes (children sorted by name),
  // or a single subtree when ?folderId=<uuid> is given. Folder counts are tiny,
  // so fetch-all + in-memory assembly beats a recursive CTE for now (MAS-708 §2).
  app.get('/api/folders/tree', async (req, reply) => {
    const qResult = TreeQuery.safeParse(req.query);
    if (!qResult.success) return reply.status(400).send({ error: 'Invalid query' });
    const { folderId } = qResult.data;

    const folders = await prisma.folder.findMany({
      where: { deletedAt: null },
      select: folderSelect,
      orderBy: { name: 'asc' },
    });

    type TreeNode = ReturnType<typeof formatFolder> & { children: TreeNode[] };
    const nodes = new Map<string, TreeNode>(
      folders.map((f) => [f.id, { ...formatFolder(f), children: [] as TreeNode[] }]),
    );
    const roots: TreeNode[] = [];
    for (const f of folders) {
      const node = nodes.get(f.id)!;
      const parent = f.parentFolderId ? nodes.get(f.parentFolderId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }

    if (folderId) {
      const subtree = nodes.get(folderId);
      if (!subtree) return reply.status(404).send({ error: 'Folder not found' });
      return reply.send([subtree]);
    }
    return reply.send(roots);
  });

  // GET /api/folders/:id/path
  // Breadcrumb: ancestor chain ordered root → … → the folder itself.
  app.get('/api/folders/:id/path', async (req, reply) => {
    const params = parseParams(FolderIdParams, req.params, reply);
    if (!params) return;

    // Trashed folders are nonexistent to reads (MAS-715). Ancestors of a live
    // folder are live by invariant (trash cascades down), so only the target
    // itself needs the check.
    const target = await prisma.folder.findFirst({
      where: { id: params.id, deletedAt: null },
      select: { id: true },
    });
    if (!target) return reply.status(404).send({ error: 'Folder not found' });

    const path: { id: string; name: string; parent_folder_id: string | null }[] = [];
    let current: string | null = params.id;
    const visited = new Set<string>(); // safety guard against pre-existing cycles
    while (current !== null && !visited.has(current)) {
      visited.add(current);
      const row: { id: string; name: string; parentFolderId: string | null } | null =
        await prisma.folder.findUnique({
          where: { id: current },
          select: { id: true, name: true, parentFolderId: true },
        });
      if (!row) break;
      path.unshift({ id: row.id, name: row.name, parent_folder_id: row.parentFolderId });
      current = row.parentFolderId;
    }

    if (path.length === 0) return reply.status(404).send({ error: 'Folder not found' });
    return reply.send(path);
  });

  // POST /api/folders
  app.post('/api/folders', async (req, reply) => {
    const body = parseBody(CreateFolderBody, req.body, reply);
    if (!body) return;

    // Verify parentFolderId exists (and is not trashed) if provided
    if (body.parentFolderId) {
      const parent = await prisma.folder.findFirst({
        where: { id: body.parentFolderId, deletedAt: null },
        select: { id: true },
      });
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

    const existing = await prisma.folder.findFirst({
      where: { id: params.id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) return reply.status(404).send({ error: 'Folder not found' });

    // Guard against circular parent reference
    if (body.parentFolderId) {
      if (body.parentFolderId === params.id) {
        return reply.status(409).send({ error: 'A folder cannot be its own parent' });
      }
      const cycle = await wouldCreateCycle(params.id, body.parentFolderId);
      if (cycle) return reply.status(409).send({ error: 'Circular parent reference detected' });

      // Trashed parent rejected the same way as a nonexistent one (MAS-715)
      const parent = await prisma.folder.findFirst({
        where: { id: body.parentFolderId, deletedAt: null },
        select: { id: true },
      });
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
  // Trash (soft-delete): stamps deletedAt/deletedByUserId on the folder and every
  // live descendant in ONE transaction. Assets are NOT trashed — folder_assets
  // memberships are M2M and persist untouched, so restore reproduces the exact
  // structure. 404 if the folder is already trashed or nonexistent.
  app.delete('/api/folders/:id', async (req, reply) => {
    const params = parseParams(FolderIdParams, req.params, reply);
    if (!params) return;

    const userId = req.user?.userId ?? null;

    const trashed = await prisma.$transaction(async (tx) => {
      const existing = await tx.folder.findFirst({
        where: { id: params.id, deletedAt: null },
        select: { id: true },
      });
      if (!existing) return false;

      const ids = await collectSubtreeIds(tx, params.id, 'live');
      await tx.folder.updateMany({
        where: { id: { in: ids }, deletedAt: null },
        data: { deletedAt: new Date(), deletedByUserId: userId },
      });
      return true;
    });

    if (!trashed) return reply.status(404).send({ error: 'Folder not found' });
    return reply.status(204).send();
  });

  // POST /api/folders/:id/restore
  // Clears deletedAt/deletedByUserId on the folder and ALL its trashed descendants
  // (one transaction). If the folder's own parent is trashed or gone, it is
  // re-parented to root so restore always succeeds — same principle as asset
  // restore. Deliberate simplification (MAS-715): a descendant trashed separately
  // BEFORE its ancestor is also resurrected by the ancestor's restore.
  app.post('/api/folders/:id/restore', async (req, reply) => {
    const params = parseParams(FolderIdParams, req.params, reply);
    if (!params) return;

    const restored = await prisma.$transaction(async (tx) => {
      const folder = await tx.folder.findFirst({
        where: { id: params.id, deletedAt: { not: null } },
        select: { id: true, parentFolderId: true },
      });
      if (!folder) return null;

      const ids = await collectSubtreeIds(tx, params.id, 'trashed');
      await tx.folder.updateMany({
        where: { id: { in: ids } },
        data: { deletedAt: null, deletedByUserId: null },
      });

      // Re-parent to root when the original parent no longer exists as a live
      // folder (trashed or hard-deleted); the parent is never part of the
      // restored subtree, so its state is unaffected by the updateMany above.
      if (folder.parentFolderId) {
        const parent = await tx.folder.findFirst({
          where: { id: folder.parentFolderId, deletedAt: null },
          select: { id: true },
        });
        if (!parent) {
          await tx.folder.update({ where: { id: params.id }, data: { parentFolderId: null } });
        }
      }

      return tx.folder.findUniqueOrThrow({ where: { id: params.id }, select: folderSelect });
    });

    if (!restored) return reply.status(404).send({ error: 'Not found or not in trash' });
    return reply.status(200).send(formatFolder(restored));
  });

  // POST /api/folders/:id/purge
  // Hard-delete of a TRASHED folder row; the DB cascade removes descendant folders
  // and folder_assets memberships, assets persist. Same authz as asset purge:
  // admin or the folder's creator. 404 if the folder is not in the trash.
  app.post('/api/folders/:id/purge', async (req, reply) => {
    const params = parseParams(FolderIdParams, req.params, reply);
    if (!params) return;

    const { userId, role } = req.user;

    const folder = await prisma.folder.findFirst({
      where: { id: params.id, deletedAt: { not: null } },
      select: { id: true, createdByUserId: true },
    });
    if (!folder) return reply.status(404).send({ error: 'Not found or not in trash' });

    if (role !== 'admin' && folder.createdByUserId !== userId) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    // The where clause re-asserts deletedAt so a concurrent restore between the
    // fetch and here cannot purge a live folder (P2025 → 404).
    try {
      await prisma.folder.delete({ where: { id: params.id, deletedAt: { not: null } } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return reply.status(404).send({ error: 'Not found or not in trash' });
      }
      throw err;
    }

    return reply.status(204).send();
  });

  // GET /api/trash/folders
  // Top-level trashed folders only (parent null, live, or gone), each with its
  // trashed-descendant count. Separate route from GET /api/trash so the asset
  // trash response shape stays untouched.
  app.get('/api/trash/folders', async (_req, reply) => {
    const all = await prisma.folder.findMany({
      where: { deletedAt: { not: null } },
      select: { id: true, name: true, parentFolderId: true, deletedAt: true, deletedByUserId: true },
      orderBy: { deletedAt: 'desc' },
    });

    const trashedIds = new Set(all.map((f) => f.id));
    const childrenOf = new Map<string, string[]>();
    for (const f of all) {
      if (f.parentFolderId && trashedIds.has(f.parentFolderId)) {
        const siblings = childrenOf.get(f.parentFolderId) ?? [];
        siblings.push(f.id);
        childrenOf.set(f.parentFolderId, siblings);
      }
    }

    function countDescendants(id: string): number {
      const kids = childrenOf.get(id) ?? [];
      return kids.length + kids.reduce((sum, kid) => sum + countDescendants(kid), 0);
    }

    const topLevel = all.filter((f) => !f.parentFolderId || !trashedIds.has(f.parentFolderId));
    return reply.send(
      topLevel.map((f) => ({
        id: f.id,
        name: f.name,
        deleted_at: f.deletedAt,
        deleted_by: f.deletedByUserId,
        descendant_count: countDescendants(f.id),
      })),
    );
  });

  // GET /api/folders/:id/assets
  app.get('/api/folders/:id/assets', async (req, reply) => {
    const params = parseParams(FolderIdParams, req.params, reply);
    if (!params) return;
    const qResult = ListAssetsQuery.safeParse(req.query);
    if (!qResult.success) return reply.status(400).send({ error: 'Invalid query' });
    const { limit, cursor } = qResult.data;

    const folder = await prisma.folder.findFirst({
      where: { id: params.id, deletedAt: null },
      select: { id: true },
    });
    if (!folder) return reply.status(404).send({ error: 'Folder not found' });

    // Cursor-based pagination: WHERE asset_id > cursor ORDER BY asset_id ASC LIMIT limit+1
    // Trashed assets stay members (restore puts them back) but never appear here.
    const rows = await prisma.folderAsset.findMany({
      where: {
        folderId: params.id,
        asset: { deletedAt: null },
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

    const folder = await prisma.folder.findFirst({
      where: { id: params.id, deletedAt: null },
      select: { id: true },
    });
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

  // POST /api/folders/:id/assets/remove — bulk-remove assets from a folder.
  // POST-with-verb (not DELETE-with-body) matches the codebase's bulk convention
  // (see collections.ts). Removal is set-subtraction: ids that aren't members
  // (or don't exist) are silent no-ops, so the response is 200 { removed: n }
  // even when n is 0, and repeat calls are idempotent.
  app.post('/api/folders/:id/assets/remove', async (req, reply) => {
    const params = parseParams(FolderIdParams, req.params, reply);
    if (!params) return;
    const body = parseBody(AddAssetsBody, req.body, reply);
    if (!body) return;

    // Trashed folders are invisible to membership routes (MAS-715)
    const folder = await prisma.folder.findFirst({
      where: { id: params.id, deletedAt: null },
      select: { id: true },
    });
    if (!folder) return reply.status(404).send({ error: 'Folder not found' });

    const deleted = await prisma.folderAsset.deleteMany({
      where: { folderId: params.id, assetId: { in: body.assetIds } },
    });

    return reply.send({ removed: deleted.count });
  });

  // DELETE /api/folders/:id/assets/:assetId
  app.delete('/api/folders/:id/assets/:assetId', async (req, reply) => {
    const params = parseParams(FolderAssetParams, req.params, reply);
    if (!params) return;

    // Membership lookups treat trashed folders as nonexistent (MAS-715)
    const membership = await prisma.folderAsset.findFirst({
      where: { folderId: params.id, assetId: params.assetId, folder: { deletedAt: null } },
      select: { folderId: true },
    });
    if (!membership) return reply.status(404).send({ error: 'Folder or membership not found' });

    await prisma.folderAsset.delete({
      where: { folderId_assetId: { folderId: params.id, assetId: params.assetId } },
    });
    return reply.status(204).send();
  });
}
