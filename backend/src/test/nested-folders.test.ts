/**
 * MAS-710: Nested folder hierarchy API integration tests.
 *
 * Coverage:
 *  - GET /api/folders/tree — nested assembly, ?folderId subtree, 404
 *  - GET /api/folders/:id/path — breadcrumb root → self, 404
 *  - GET /api/files?folderId=<id>[&includeDescendants=true] — composes with q
 *  - Trashed assets excluded from folder asset listings, asset_count, and tree
 *  - Trash → restore round-trip preserves folder membership (MAS-690 seam)
 *  - Purge removes membership rows via DB cascade
 *  - Bulk-delete across a nested subtree, then restore
 *  - Deleting a folder cascades descendant folders; assets always survive
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../app.js';
import { prisma } from '../db/client.js';

// assetTrash.ts drives trash/restore/purge through storage.move/storage.delete —
// mock the whole provider so no physical I/O happens.
vi.mock('../storage/index.js', () => ({
  getStorageProvider: vi.fn().mockResolvedValue({
    upload: vi.fn().mockResolvedValue(undefined),
    streamUpload: vi.fn().mockImplementation((_key: string, body: NodeJS.ReadableStream) =>
      new Promise<void>((resolve, reject) => {
        body.resume();
        body.on('end', resolve);
        body.on('error', reject);
      }),
    ),
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

const NIL_RECORD_UUID = '00000000-0000-4000-8000-000000000001';

describe('Nested folders API (MAS-710)', () => {
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
      .send({ email: 'nested@example.com', password: 'password123' });
    token = res.body.token;
    userId = res.body.user.id;
  });

  // Assets are seeded with uploadedBy so the trash/restore/purge ownership checks pass.
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

  async function createFolder(name: string, parentFolderId?: string) {
    const res = await request(app.server)
      .post('/api/folders')
      .set('Authorization', `Bearer ${token}`)
      .send({ name, ...(parentFolderId ? { parentFolderId } : {}) });
    expect(res.status).toBe(201);
    return res.body as { id: string };
  }

  async function addToFolder(folderId: string, assetIds: string[]) {
    const res = await request(app.server)
      .post(`/api/folders/${folderId}/assets`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assetIds });
    expect(res.status).toBe(200);
  }

  /** Creates A(root) → B → C plus root D, one asset in each of A/B/C. */
  async function seedSubtree() {
    const a = await createFolder('A');
    const b = await createFolder('B', a.id);
    const c = await createFolder('C', b.id);
    const d = await createFolder('D');
    const assetA = await seedAsset('in-a.bin');
    const assetB = await seedAsset('in-b.bin');
    const assetC = await seedAsset('in-c.bin');
    await addToFolder(a.id, [assetA.id]);
    await addToFolder(b.id, [assetB.id]);
    await addToFolder(c.id, [assetC.id]);
    return { a, b, c, d, assetA, assetB, assetC };
  }

  // ─── Tree endpoint ─────────────────────────────────────────────────────────

  it('GET /api/folders/tree — returns the nested forest', async () => {
    const { a, b, c, d } = await seedSubtree();

    const res = await request(app.server)
      .get('/api/folders/tree')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2); // roots A and D, name-sorted
    expect(res.body[0].id).toBe(a.id);
    expect(res.body[1].id).toBe(d.id);
    expect(res.body[0].children.length).toBe(1);
    expect(res.body[0].children[0].id).toBe(b.id);
    expect(res.body[0].children[0].children[0].id).toBe(c.id);
    expect(res.body[0].children[0].children[0].children).toEqual([]);
    expect(res.body[0].asset_count).toBe(1);
  });

  it('GET /api/folders/tree?folderId=<id> — returns only that subtree', async () => {
    const { b, c } = await seedSubtree();

    const res = await request(app.server)
      .get(`/api/folders/tree?folderId=${b.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].id).toBe(b.id);
    expect(res.body[0].children[0].id).toBe(c.id);
  });

  it('GET /api/folders/tree?folderId=<unknown> — 404', async () => {
    const res = await request(app.server)
      .get(`/api/folders/tree?folderId=${NIL_RECORD_UUID}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  // ─── Breadcrumb path ───────────────────────────────────────────────────────

  it('GET /api/folders/:id/path — returns root → self breadcrumb', async () => {
    const { a, b, c } = await seedSubtree();

    const res = await request(app.server)
      .get(`/api/folders/${c.id}/path`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.map((f: { id: string }) => f.id)).toEqual([a.id, b.id, c.id]);
    expect(res.body[0].parent_folder_id).toBeNull();
  });

  it('GET /api/folders/:id/path — 404 for unknown folder', async () => {
    const res = await request(app.server)
      .get(`/api/folders/${NIL_RECORD_UUID}/path`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  // ─── folderId filter on GET /api/files ─────────────────────────────────────

  it('GET /api/files?folderId=<id> — returns only that folder’s assets', async () => {
    const { a, assetA } = await seedSubtree();

    const res = await request(app.server)
      .get(`/api/files?folderId=${a.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.map((x: { id: string }) => x.id)).toEqual([assetA.id]);
    expect(res.body.total).toBe(1);
  });

  it('GET /api/files?folderId=<id>&includeDescendants=true — covers the subtree', async () => {
    const { a, assetA, assetB, assetC } = await seedSubtree();

    const res = await request(app.server)
      .get(`/api/files?folderId=${a.id}&includeDescendants=true`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const ids = res.body.data.map((x: { id: string }) => x.id).sort();
    expect(ids).toEqual([assetA.id, assetB.id, assetC.id].sort());
    expect(res.body.total).toBe(3);
  });

  it('GET /api/files — folderId composes with q search', async () => {
    const { a } = await seedSubtree();
    const inFolder = await seedAsset('wolf-logo.png');
    await seedAsset('wolf-banner.png'); // matches q but is not in the folder
    await addToFolder(a.id, [inFolder.id]);

    const res = await request(app.server)
      .get(`/api/files?q=wolf&folderId=${a.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.map((x: { id: string }) => x.id)).toEqual([inFolder.id]);
  });

  // ─── Trash lifecycle across the hierarchy (MAS-690 seam) ───────────────────

  it('trashed assets disappear from folder listings, counts, tree, and folderId filter', async () => {
    const { a, assetA } = await seedSubtree();

    const del = await request(app.server)
      .delete(`/api/files/${assetA.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(204);

    const listing = await request(app.server)
      .get(`/api/folders/${a.id}/assets`)
      .set('Authorization', `Bearer ${token}`);
    expect(listing.body.assets.length).toBe(0);

    const folders = await request(app.server)
      .get('/api/folders?parentFolderId=root')
      .set('Authorization', `Bearer ${token}`);
    const folderA = folders.body.find((f: { id: string }) => f.id === a.id);
    expect(folderA.asset_count).toBe(0);

    const tree = await request(app.server)
      .get(`/api/folders/tree?folderId=${a.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(tree.body[0].asset_count).toBe(0);

    const files = await request(app.server)
      .get(`/api/files?folderId=${a.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(files.body.total).toBe(0);
  });

  it('restore puts a trashed asset back into its folder', async () => {
    const { a, assetA } = await seedSubtree();

    await request(app.server)
      .delete(`/api/files/${assetA.id}`)
      .set('Authorization', `Bearer ${token}`);

    const restore = await request(app.server)
      .post(`/api/files/${assetA.id}/restore`)
      .set('Authorization', `Bearer ${token}`);
    expect(restore.status).toBe(200);

    const listing = await request(app.server)
      .get(`/api/folders/${a.id}/assets`)
      .set('Authorization', `Bearer ${token}`);
    expect(listing.body.assets.map((x: { id: string }) => x.id)).toEqual([assetA.id]);

    const folders = await request(app.server)
      .get('/api/folders?parentFolderId=root')
      .set('Authorization', `Bearer ${token}`);
    expect(folders.body.find((f: { id: string }) => f.id === a.id).asset_count).toBe(1);
  });

  it('purge removes the asset and its membership rows entirely', async () => {
    const { assetA } = await seedSubtree();

    await request(app.server)
      .delete(`/api/files/${assetA.id}`)
      .set('Authorization', `Bearer ${token}`);

    const purge = await request(app.server)
      .delete(`/api/files/${assetA.id}/purge`)
      .set('Authorization', `Bearer ${token}`);
    expect(purge.status).toBe(204);

    expect(await prisma.asset.count({ where: { id: assetA.id } })).toBe(0);
    expect(await prisma.folderAsset.count({ where: { assetId: assetA.id } })).toBe(0);
  });

  it('bulk-delete across a nested subtree trashes everywhere; restore brings all back', async () => {
    const { a, b, c, assetA, assetB, assetC } = await seedSubtree();
    const ids = [assetA.id, assetB.id, assetC.id];

    const bulk = await request(app.server)
      .post('/api/files/bulk-delete')
      .set('Authorization', `Bearer ${token}`)
      .send({ ids });
    expect(bulk.status).toBe(200);

    // Every folder in the subtree is now visibly empty
    const subtreeFiles = await request(app.server)
      .get(`/api/files?folderId=${a.id}&includeDescendants=true`)
      .set('Authorization', `Bearer ${token}`);
    expect(subtreeFiles.body.total).toBe(0);
    for (const folderId of [a.id, b.id, c.id]) {
      const listing = await request(app.server)
        .get(`/api/folders/${folderId}/assets`)
        .set('Authorization', `Bearer ${token}`);
      expect(listing.body.assets.length).toBe(0);
    }
    // Memberships survive the trash round-trip
    expect(await prisma.folderAsset.count({ where: { assetId: { in: ids } } })).toBe(3);

    for (const id of ids) {
      const restore = await request(app.server)
        .post(`/api/files/${id}/restore`)
        .set('Authorization', `Bearer ${token}`);
      expect(restore.status).toBe(200);
    }

    const restored = await request(app.server)
      .get(`/api/files?folderId=${a.id}&includeDescendants=true`)
      .set('Authorization', `Bearer ${token}`);
    expect(restored.body.total).toBe(3);
  });

  it('deleting a folder cascades descendant folders; assets survive untrashed', async () => {
    const { a, d, assetA, assetB, assetC } = await seedSubtree();

    const del = await request(app.server)
      .delete(`/api/folders/${a.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(204);

    // B and C are gone with A; D remains
    const folders = await request(app.server)
      .get('/api/folders')
      .set('Authorization', `Bearer ${token}`);
    expect(folders.body.map((f: { id: string }) => f.id)).toEqual([d.id]);

    // All three assets are still live in the library (never trashed)
    const files = await request(app.server)
      .get('/api/files')
      .set('Authorization', `Bearer ${token}`);
    const liveIds = files.body.data.map((x: { id: string }) => x.id);
    for (const id of [assetA.id, assetB.id, assetC.id]) {
      expect(liveIds).toContain(id);
    }
    expect(await prisma.folderAsset.count()).toBe(0);
  });
});
