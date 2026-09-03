/**
 * MAS-715: Folder trash lifecycle integration tests.
 *
 * Coverage (mirrors the MAS-690 asset lifecycle style):
 *  - DELETE /api/folders/:id — soft-deletes the folder + live descendants in one
 *    transaction; assets and memberships untouched; 404 when already trashed
 *  - Read exclusion — trashed folders vanish from list/tree/path/:id/assets and
 *    the ?folderId= files filter; trashed parent rejected on create/move
 *  - GET /api/trash/folders — top-level trashed folders with descendant counts
 *  - POST /api/folders/:id/restore — full-subtree restore, re-parent to root when
 *    the original parent is trashed/gone
 *  - POST /api/folders/:id/purge — hard-delete of a trashed subtree; memberships
 *    cascade away, assets survive; admin-or-creator authz
 *  - purgeExpiredFolders — 30-day auto-purge, top-level-first
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../app.js';
import { prisma } from '../db/client.js';
import { purgeExpiredFolders } from '../jobs/trashPurge.js';

// No physical I/O in folder trash ops, but asset seeding paths touch storage —
// mock the provider like the other folder suites.
vi.mock('../storage/index.js', () => ({
  getStorageProvider: vi.fn().mockResolvedValue({
    upload: vi.fn().mockResolvedValue(undefined),
    streamUpload: vi.fn().mockResolvedValue(undefined),
    download: vi.fn().mockResolvedValue({
      stream: Buffer.from(''),
      contentType: 'application/octet-stream',
      contentLength: 0,
    }),
    delete: vi.fn().mockResolvedValue(undefined),
    copy: vi.fn().mockResolvedValue(undefined),
    move: vi.fn().mockResolvedValue(undefined),
  }),
  invalidateStorageCache: vi.fn(),
}));

const THIRTY_ONE_DAYS_MS = 31 * 24 * 60 * 60 * 1000;

describe('Folder trash lifecycle (MAS-715)', () => {
  let app: FastifyInstance;
  let token: string;
  let userId: string;

  beforeAll(async () => {
    app = await createApp();
    await app.listen({ port: 0 });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.folderAsset.deleteMany();
    await prisma.folder.deleteMany();
    await prisma.assetTag.deleteMany();
    await prisma.notification.deleteMany();
    await prisma.assetVersion.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.asset.deleteMany();
    await prisma.tag.deleteMany();
    await prisma.user.deleteMany();
    await prisma.setting.deleteMany();
    await prisma.subcategory.deleteMany();
    await prisma.category.deleteMany();

    const res = await request(app.server)
      .post('/api/auth/register')
      .send({ email: 'foldertrash@example.com', password: 'password123' });
    token = res.body.token;
    userId = res.body.user.id;
  });

  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

  async function createFolder(name: string, parentFolderId?: string) {
    const res = await auth(request(app.server).post('/api/folders')).send({
      name,
      ...(parentFolderId ? { parentFolderId } : {}),
    });
    expect(res.status).toBe(201);
    return res.body as { id: string };
  }

  async function seedAsset(name: string) {
    return prisma.asset.create({
      data: {
        originalName: name,
        storageKey: `assets/${name}`,
        mimeType: 'application/octet-stream',
        sizeBytes: 100n,
        uploadedBy: userId,
      },
    });
  }

  /** L1 → L2 → L3, with one asset a member of L3 (the MAS-715 repro shape). */
  async function seedRepro() {
    const l1 = await createFolder('L1');
    const l2 = await createFolder('L2', l1.id);
    const l3 = await createFolder('L3', l2.id);
    const asset = await seedAsset('in-l3.bin');
    const add = await auth(request(app.server).post(`/api/folders/${l3.id}/assets`)).send({
      assetIds: [asset.id],
    });
    expect(add.status).toBe(200);
    return { l1, l2, l3, asset };
  }

  async function trashFolder(id: string, expected = 204) {
    const res = await auth(request(app.server).delete(`/api/folders/${id}`));
    expect(res.status).toBe(expected);
  }

  // ─── Trash ───────────────────────────────────────────────────────────────

  it('DELETE trashes the whole subtree; reads 404; asset + membership survive', async () => {
    const { l1, l2, l3, asset } = await seedRepro();

    await trashFolder(l1.id);

    // All three rows still exist, all stamped with deletedAt/deletedByUserId
    const rows = await prisma.folder.findMany({ orderBy: { name: 'asc' } });
    expect(rows.length).toBe(3);
    for (const row of rows) {
      expect(row.deletedAt).not.toBeNull();
      expect(row.deletedByUserId).toBe(userId);
    }

    // Absent from list and tree
    const list = await auth(request(app.server).get('/api/folders'));
    expect(list.body).toEqual([]);
    const tree = await auth(request(app.server).get('/api/folders/tree'));
    expect(tree.body).toEqual([]);

    // path / assets / subtree reads 404 for every level
    for (const id of [l1.id, l2.id, l3.id]) {
      expect((await auth(request(app.server).get(`/api/folders/${id}/path`))).status).toBe(404);
      expect((await auth(request(app.server).get(`/api/folders/${id}/assets`))).status).toBe(404);
      expect((await auth(request(app.server).get(`/api/folders/tree?folderId=${id}`))).status).toBe(404);
    }

    // The asset is untouched: still live and still a member of L3
    const files = await auth(request(app.server).get('/api/files'));
    expect(files.body.data.map((a: { id: string }) => a.id)).toContain(asset.id);
    const membership = await prisma.folderAsset.findMany();
    expect(membership).toEqual([{ folderId: l3.id, assetId: asset.id }]);
  });

  it('DELETE returns 404 for an already-trashed or unknown folder', async () => {
    const { l1 } = await seedRepro();
    await trashFolder(l1.id);
    await trashFolder(l1.id, 404); // already trashed → nonexistent
    await trashFolder('00000000-0000-4000-8000-000000000001', 404);
  });

  it('trashing a mid-tree folder leaves ancestors live', async () => {
    const { l1, l2, l3 } = await seedRepro();

    await trashFolder(l2.id);

    const list = await auth(request(app.server).get('/api/folders'));
    expect(list.body.map((f: { id: string }) => f.id)).toEqual([l1.id]);
    const l2Row = await prisma.folder.findUnique({ where: { id: l2.id } });
    const l3Row = await prisma.folder.findUnique({ where: { id: l3.id } });
    expect(l2Row!.deletedAt).not.toBeNull();
    expect(l3Row!.deletedAt).not.toBeNull();
  });

  // ─── Read exclusion ──────────────────────────────────────────────────────

  it('trashed parent is rejected on create and move like a nonexistent one', async () => {
    const { l1 } = await seedRepro();
    const other = await createFolder('Other');

    await trashFolder(l1.id);

    const create = await auth(request(app.server).post('/api/folders')).send({
      name: 'Child of trashed',
      parentFolderId: l1.id,
    });
    expect(create.status).toBe(404);

    const move = await auth(request(app.server).patch(`/api/folders/${other.id}`)).send({
      parentFolderId: l1.id,
    });
    expect(move.status).toBe(404);

    // PATCH on the trashed folder itself is a 404 too
    const rename = await auth(request(app.server).patch(`/api/folders/${l1.id}`)).send({
      name: 'Zombie',
    });
    expect(rename.status).toBe(404);
  });

  it('?folderId=<trashed> behaves like a nonexistent folder in GET /api/files', async () => {
    const { l3, asset } = await seedRepro();

    // Live: filter finds the asset
    const before = await auth(request(app.server).get(`/api/files?folderId=${l3.id}`));
    expect(before.body.data.map((a: { id: string }) => a.id)).toEqual([asset.id]);

    await trashFolder(l3.id);

    const after = await auth(request(app.server).get(`/api/files?folderId=${l3.id}`));
    expect(after.status).toBe(200);
    expect(after.body.data).toEqual([]);

    // Same response shape and content as a nonexistent folder
    const ghost = await auth(
      request(app.server).get('/api/files?folderId=00000000-0000-4000-8000-000000000001'),
    );
    expect(after.body).toEqual(ghost.body);
  });

  // ─── Trash listing ───────────────────────────────────────────────────────

  it('GET /api/trash/folders lists top-level trashed folders with descendant counts', async () => {
    const { l1 } = await seedRepro();
    const solo = await createFolder('Solo');

    await trashFolder(l1.id);
    await trashFolder(solo.id);

    const res = await auth(request(app.server).get('/api/trash/folders'));
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2); // L1 (with L2/L3 nested) and Solo — never L2/L3

    const byId = new Map(res.body.map((f: { id: string }) => [f.id, f]));
    const l1Entry = byId.get(l1.id) as {
      name: string;
      deleted_at: string;
      deleted_by: string;
      descendant_count: number;
    };
    expect(l1Entry.name).toBe('L1');
    expect(l1Entry.descendant_count).toBe(2);
    expect(l1Entry.deleted_by).toBe(userId);
    expect(l1Entry.deleted_at).toBeTruthy();
    expect((byId.get(solo.id) as { descendant_count: number }).descendant_count).toBe(0);

    // The asset trash listing shape is untouched (no folders mixed in)
    const assetTrash = await auth(request(app.server).get('/api/trash'));
    expect(assetTrash.status).toBe(200);
    expect(assetTrash.body).toEqual([]);
  });

  // ─── Restore ─────────────────────────────────────────────────────────────

  it('restore brings back the full subtree with identical structure', async () => {
    const { l1, l2, l3, asset } = await seedRepro();
    await trashFolder(l1.id);

    const res = await auth(request(app.server).post(`/api/folders/${l1.id}/restore`));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(l1.id);
    expect(res.body.parent_folder_id).toBeNull();

    // Structure identical: L1 → L2 → L3
    const tree = await auth(request(app.server).get('/api/folders/tree'));
    expect(tree.body.length).toBe(1);
    expect(tree.body[0].id).toBe(l1.id);
    expect(tree.body[0].children[0].id).toBe(l2.id);
    expect(tree.body[0].children[0].children[0].id).toBe(l3.id);

    // deletedBy stamps cleared everywhere
    const rows = await prisma.folder.findMany();
    for (const row of rows) {
      expect(row.deletedAt).toBeNull();
      expect(row.deletedByUserId).toBeNull();
    }

    // L3 still contains the asset
    const l3Assets = await auth(request(app.server).get(`/api/folders/${l3.id}/assets`));
    expect(l3Assets.status).toBe(200);
    expect(l3Assets.body.assets.map((a: { id: string }) => a.id)).toEqual([asset.id]);
  });

  it('restoring a mid-tree folder re-parents it to root while the ancestor stays trashed', async () => {
    const { l1, l2, l3 } = await seedRepro();
    await trashFolder(l1.id);

    const res = await auth(request(app.server).post(`/api/folders/${l2.id}/restore`));
    expect(res.status).toBe(200);
    expect(res.body.parent_folder_id).toBeNull(); // re-parented to root

    // L2 is a root now, L3 restored under it; L1 still trashed
    const tree = await auth(request(app.server).get('/api/folders/tree'));
    expect(tree.body.length).toBe(1);
    expect(tree.body[0].id).toBe(l2.id);
    expect(tree.body[0].children[0].id).toBe(l3.id);

    const l1Row = await prisma.folder.findUnique({ where: { id: l1.id } });
    expect(l1Row!.deletedAt).not.toBeNull();

    // L1 remains restorable on its own and no longer owns L2 in the live tree
    const restoreL1 = await auth(request(app.server).post(`/api/folders/${l1.id}/restore`));
    expect(restoreL1.status).toBe(200);
    const forest = await auth(request(app.server).get('/api/folders/tree'));
    expect(forest.body.map((f: { id: string }) => f.id).sort()).toEqual([l1.id, l2.id].sort());
  });

  it('restore returns 404 for live or unknown folders', async () => {
    const { l1 } = await seedRepro();
    const live = await auth(request(app.server).post(`/api/folders/${l1.id}/restore`));
    expect(live.status).toBe(404);
    const ghost = await auth(
      request(app.server).post('/api/folders/00000000-0000-4000-8000-000000000001/restore'),
    );
    expect(ghost.status).toBe(404);
  });

  // ─── Purge ───────────────────────────────────────────────────────────────

  it('purge hard-deletes the trashed subtree; asset survives, memberships cascade away', async () => {
    const { l1, asset } = await seedRepro();
    await trashFolder(l1.id);

    const res = await auth(request(app.server).post(`/api/folders/${l1.id}/purge`));
    expect(res.status).toBe(204);

    expect(await prisma.folder.count()).toBe(0);
    expect(await prisma.folderAsset.count()).toBe(0);

    const files = await auth(request(app.server).get('/api/files'));
    expect(files.body.data.map((a: { id: string }) => a.id)).toContain(asset.id);
  });

  it('purge returns 404 for live or unknown folders', async () => {
    const { l1 } = await seedRepro();
    const live = await auth(request(app.server).post(`/api/folders/${l1.id}/purge`));
    expect(live.status).toBe(404);
    const ghost = await auth(
      request(app.server).post('/api/folders/00000000-0000-4000-8000-000000000001/purge'),
    );
    expect(ghost.status).toBe(404);
  });

  it('purge is forbidden for a non-admin who is not the creator', async () => {
    const { l1 } = await seedRepro();
    await trashFolder(l1.id);

    const other = await request(app.server)
      .post('/api/auth/register')
      .send({ email: 'stranger@example.com', password: 'password123' });

    const res = await request(app.server)
      .post(`/api/folders/${l1.id}/purge`)
      .set('Authorization', `Bearer ${other.body.token}`);
    expect(res.status).toBe(403);

    // The creator (non-admin) may purge their own folder
    const own = await auth(request(app.server).post(`/api/folders/${l1.id}/purge`));
    expect(own.status).toBe(204);
  });

  // ─── Auto-purge job ──────────────────────────────────────────────────────

  it('purgeExpiredFolders removes only expired subtrees, top-level first', async () => {
    const { l1, asset } = await seedRepro();
    const fresh = await createFolder('Fresh');

    await trashFolder(l1.id);
    await trashFolder(fresh.id);

    // Age the L1 subtree past the retention window; "Fresh" stays recent
    const expiredAt = new Date(Date.now() - THIRTY_ONE_DAYS_MS);
    await prisma.folder.updateMany({
      where: { id: { not: fresh.id } },
      data: { deletedAt: expiredAt },
    });

    await purgeExpiredFolders();

    const remaining = await prisma.folder.findMany();
    expect(remaining.map((f) => f.id)).toEqual([fresh.id]);
    expect(await prisma.folderAsset.count()).toBe(0);

    // Assets are never touched by folder purge
    expect(await prisma.asset.count({ where: { deletedAt: null } })).toBe(1);
    expect((await prisma.asset.findFirst())!.id).toBe(asset.id);
  });
});
