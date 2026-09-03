/**
 * MAS-368: Folder feature integration tests.
 *
 * Coverage:
 *  - CRUD lifecycle (create → list → update → delete)
 *  - Delete folder does NOT delete assets
 *  - Duplicate asset membership is idempotent (returns 200, not 4xx)
 *  - Cursor pagination returns correct pages
 *  - Circular ancestor guard returns 409
 *  - Removing a non-member asset returns 404
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../app.js';
import { prisma } from '../db/client.js';

// Routes now use getStorageProvider() from storage/index.js — mock that module
// instead of the old s3.js stubs.
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
  }),
  invalidateStorageCache: vi.fn(),
}));

// Non-existent UUID that passes Zod v4's RFC-4122 version+variant checks
// (version nibble = 4, variant nibble = 8)
const NIL_RECORD_UUID = '00000000-0000-4000-8000-000000000001';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function seedAsset(storageKey: string) {
  return prisma.asset.create({
    data: {
      originalName: `${storageKey}.bin`,
      storageKey,
      mimeType: 'application/octet-stream',
      sizeBytes: 100n,
    },
  });
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('Folders API', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    app = await createApp();
    await app.listen({ port: 0 });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clean slate — order respects FK constraints
    await prisma.folderAsset.deleteMany();
    await prisma.folder.deleteMany();
    await prisma.assetTag.deleteMany();
    await prisma.notification.deleteMany();
    await prisma.assetVersion.deleteMany();
    await prisma.asset.deleteMany();
    await prisma.tag.deleteMany();
    await prisma.user.deleteMany();
    await prisma.setting.deleteMany();
    await prisma.subcategory.deleteMany();
    await prisma.category.deleteMany();

    const res = await request(app.server)
      .post('/api/auth/register')
      .send({ email: 'folders@example.com', password: 'password123' });
    token = res.body.token;
  });

  // ─── Create ────────────────────────────────────────────────────────────────

  it('POST /api/folders — creates a folder and returns FolderSummary', async () => {
    const res = await request(app.server)
      .post('/api/folders')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Brand Assets', description: 'All brand files' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Brand Assets');
    expect(res.body.description).toBe('All brand files');
    expect(res.body.asset_count).toBe(0);
    expect(res.body.parent_folder_id).toBeNull();
    expect(res.body.id).toBeTruthy();
  });

  it('POST /api/folders — rejects missing name with 400', async () => {
    const res = await request(app.server)
      .post('/api/folders')
      .set('Authorization', `Bearer ${token}`)
      .send({ description: 'No name' });
    expect(res.status).toBe(400);
  });

  it('POST /api/folders — rejects non-existent parentFolderId with 404', async () => {
    const res = await request(app.server)
      .post('/api/folders')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Child', parentFolderId: NIL_RECORD_UUID });
    expect(res.status).toBe(404);
  });

  it('POST /api/folders — creates nested folder correctly', async () => {
    const parentRes = await request(app.server)
      .post('/api/folders')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Parent' });
    expect(parentRes.status).toBe(201);

    const childRes = await request(app.server)
      .post('/api/folders')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Child', parentFolderId: parentRes.body.id });
    expect(childRes.status).toBe(201);
    expect(childRes.body.parent_folder_id).toBe(parentRes.body.id);
  });

  // ─── List ──────────────────────────────────────────────────────────────────

  it('GET /api/folders — lists all folders', async () => {
    await request(app.server)
      .post('/api/folders')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Folder A' });
    await request(app.server)
      .post('/api/folders')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Folder B' });

    const res = await request(app.server)
      .get('/api/folders')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
  });

  it('GET /api/folders?parentFolderId=root — returns only root folders', async () => {
    const parentRes = await request(app.server)
      .post('/api/folders')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Root' });
    await request(app.server)
      .post('/api/folders')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Child', parentFolderId: parentRes.body.id });

    const res = await request(app.server)
      .get('/api/folders?parentFolderId=root')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].name).toBe('Root');
  });

  // ─── Update ────────────────────────────────────────────────────────────────

  it('PATCH /api/folders/:id — renames a folder', async () => {
    const createRes = await request(app.server)
      .post('/api/folders')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Old Name' });

    const res = await request(app.server)
      .patch(`/api/folders/${createRes.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'New Name' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('New Name');
  });

  it('PATCH /api/folders/:id — rejects circular parent with 409', async () => {
    const aRes = await request(app.server)
      .post('/api/folders')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'A' });
    const bRes = await request(app.server)
      .post('/api/folders')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'B', parentFolderId: aRes.body.id });

    // Try to make A a child of B (would create A→B→A cycle)
    const res = await request(app.server)
      .patch(`/api/folders/${aRes.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ parentFolderId: bRes.body.id });

    expect(res.status).toBe(409);
  });

  it('PATCH /api/folders/:id — rejects self-parenting with 409', async () => {
    const createRes = await request(app.server)
      .post('/api/folders')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Self' });

    const res = await request(app.server)
      .patch(`/api/folders/${createRes.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ parentFolderId: createRes.body.id });

    expect(res.status).toBe(409);
  });

  it('PATCH /api/folders/:id — moves folder to root when parentFolderId: null', async () => {
    const parentRes = await request(app.server)
      .post('/api/folders')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Parent' });
    const childRes = await request(app.server)
      .post('/api/folders')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Child', parentFolderId: parentRes.body.id });

    const res = await request(app.server)
      .patch(`/api/folders/${childRes.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ parentFolderId: null });

    expect(res.status).toBe(200);
    expect(res.body.parent_folder_id).toBeNull();
  });

  it('PATCH /api/folders/:id — returns 404 for unknown folder', async () => {
    const res = await request(app.server)
      .patch(`/api/folders/${NIL_RECORD_UUID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Ghost' });
    expect(res.status).toBe(404);
  });

  // ─── Delete folder ─────────────────────────────────────────────────────────

  it('DELETE /api/folders/:id — deletes a folder and returns 204', async () => {
    const createRes = await request(app.server)
      .post('/api/folders')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Temporary' });

    const del = await request(app.server)
      .delete(`/api/folders/${createRes.body.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(204);

    const list = await request(app.server)
      .get('/api/folders')
      .set('Authorization', `Bearer ${token}`);
    expect(list.body.length).toBe(0);
  });

  it('DELETE /api/folders/:id — assets survive folder deletion', async () => {
    const asset = await seedAsset('survivor-key');

    const folderRes = await request(app.server)
      .post('/api/folders')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'To Delete' });
    await request(app.server)
      .post(`/api/folders/${folderRes.body.id}/assets`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assetIds: [asset.id] });

    await request(app.server)
      .delete(`/api/folders/${folderRes.body.id}`)
      .set('Authorization', `Bearer ${token}`);

    // Asset still accessible via /api/files
    const filesRes = await request(app.server)
      .get('/api/files')
      .set('Authorization', `Bearer ${token}`);
    expect(filesRes.status).toBe(200);
    // GET /api/files returns the pagination envelope {data, total, page, limit, totalPages}
    expect(filesRes.body.data.some((a: { id: string }) => a.id === asset.id)).toBe(true);
  });

  it('DELETE /api/folders/:id — returns 404 for unknown folder', async () => {
    const res = await request(app.server)
      .delete(`/api/folders/${NIL_RECORD_UUID}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  // ─── Asset membership ──────────────────────────────────────────────────────

  it('POST /api/folders/:id/assets — adds assets to folder', async () => {
    const asset = await seedAsset('add-test-key');
    const folderRes = await request(app.server)
      .post('/api/folders')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Media' });

    const res = await request(app.server)
      .post(`/api/folders/${folderRes.body.id}/assets`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assetIds: [asset.id] });

    expect(res.status).toBe(200);
    expect(res.body.added).toBe(1);

    // Reflected in asset_count
    const getFolder = await request(app.server)
      .get('/api/folders')
      .set('Authorization', `Bearer ${token}`);
    expect(getFolder.body[0].asset_count).toBe(1);
  });

  it('POST /api/folders/:id/assets — duplicate membership is idempotent (200, not 4xx)', async () => {
    const asset = await seedAsset('dup-test-key');
    const folderRes = await request(app.server)
      .post('/api/folders')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Dupes' });

    const first = await request(app.server)
      .post(`/api/folders/${folderRes.body.id}/assets`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assetIds: [asset.id] });
    expect(first.status).toBe(200);
    expect(first.body.added).toBe(1);

    const second = await request(app.server)
      .post(`/api/folders/${folderRes.body.id}/assets`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assetIds: [asset.id] });
    expect(second.status).toBe(200);
    expect(second.body.added).toBe(0); // duplicate skipped
  });

  it('POST /api/folders/:id/assets — rejects non-existent assetId with 422', async () => {
    const folderRes = await request(app.server)
      .post('/api/folders')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Ghost Check' });

    const res = await request(app.server)
      .post(`/api/folders/${folderRes.body.id}/assets`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assetIds: [NIL_RECORD_UUID] });

    expect(res.status).toBe(422);
  });

  it('DELETE /api/folders/:id/assets/:assetId — removes membership', async () => {
    const asset = await seedAsset('remove-test-key');
    const folderRes = await request(app.server)
      .post('/api/folders')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'RemoveMe' });
    await request(app.server)
      .post(`/api/folders/${folderRes.body.id}/assets`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assetIds: [asset.id] });

    const del = await request(app.server)
      .delete(`/api/folders/${folderRes.body.id}/assets/${asset.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(204);

    // Folder asset list is now empty
    const assetsRes = await request(app.server)
      .get(`/api/folders/${folderRes.body.id}/assets`)
      .set('Authorization', `Bearer ${token}`);
    expect(assetsRes.body.assets.length).toBe(0);
  });

  it('DELETE /api/folders/:id/assets/:assetId — returns 404 when membership absent', async () => {
    const asset = await seedAsset('nonmember-key');
    const folderRes = await request(app.server)
      .post('/api/folders')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Empty' });

    const res = await request(app.server)
      .delete(`/api/folders/${folderRes.body.id}/assets/${asset.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  // ─── Bulk asset removal (MAS-834) ──────────────────────────────────────────

  async function makeFolderWith(assetIds: string[]) {
    const folderRes = await request(app.server)
      .post('/api/folders')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Bulk Remove ${Math.random().toString(36).slice(2)}` });
    if (assetIds.length > 0) {
      await request(app.server)
        .post(`/api/folders/${folderRes.body.id}/assets`)
        .set('Authorization', `Bearer ${token}`)
        .send({ assetIds });
    }
    return folderRes.body.id as string;
  }

  it('POST /api/folders/:id/assets/remove — removes multiple assets and returns the removed count', async () => {
    const a1 = await seedAsset('bulk-rm-1');
    const a2 = await seedAsset('bulk-rm-2');
    const a3 = await seedAsset('bulk-rm-3');
    const folderId = await makeFolderWith([a1.id, a2.id, a3.id]);

    const res = await request(app.server)
      .post(`/api/folders/${folderId}/assets/remove`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assetIds: [a1.id, a2.id] });

    expect(res.status).toBe(200);
    expect(res.body.removed).toBe(2);

    const remaining = await prisma.folderAsset.findMany({ where: { folderId } });
    expect(remaining.map((r) => r.assetId)).toEqual([a3.id]);
  });

  it('POST /api/folders/:id/assets/remove — mixed member/non-member ids removes members and counts only them', async () => {
    const member = await seedAsset('bulk-rm-member');
    const nonMember = await seedAsset('bulk-rm-outsider');
    const folderId = await makeFolderWith([member.id]);

    const res = await request(app.server)
      .post(`/api/folders/${folderId}/assets/remove`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assetIds: [member.id, nonMember.id, NIL_RECORD_UUID] });

    expect(res.status).toBe(200);
    expect(res.body.removed).toBe(1);

    const remaining = await prisma.folderAsset.findMany({ where: { folderId } });
    expect(remaining).toHaveLength(0);
  });

  it('POST /api/folders/:id/assets/remove — second identical call is an idempotent no-op (removed: 0)', async () => {
    const asset = await seedAsset('bulk-rm-idem');
    const folderId = await makeFolderWith([asset.id]);

    const first = await request(app.server)
      .post(`/api/folders/${folderId}/assets/remove`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assetIds: [asset.id] });
    expect(first.status).toBe(200);
    expect(first.body.removed).toBe(1);

    const second = await request(app.server)
      .post(`/api/folders/${folderId}/assets/remove`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assetIds: [asset.id] });
    expect(second.status).toBe(200);
    expect(second.body.removed).toBe(0);
  });

  it('POST /api/folders/:id/assets/remove — only removes membership from the targeted folder', async () => {
    const asset = await seedAsset('bulk-rm-shared');
    const folderA = await makeFolderWith([asset.id]);
    const folderB = await makeFolderWith([asset.id]);

    const res = await request(app.server)
      .post(`/api/folders/${folderA}/assets/remove`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assetIds: [asset.id] });

    expect(res.status).toBe(200);
    expect(res.body.removed).toBe(1);

    const inB = await prisma.folderAsset.findFirst({
      where: { folderId: folderB, assetId: asset.id },
    });
    expect(inB).not.toBeNull();
  });

  it('POST /api/folders/:id/assets/remove — returns 404 for unknown folder', async () => {
    const asset = await seedAsset('bulk-rm-ghost');

    const res = await request(app.server)
      .post(`/api/folders/${NIL_RECORD_UUID}/assets/remove`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assetIds: [asset.id] });

    expect(res.status).toBe(404);
  });

  it('POST /api/folders/:id/assets/remove — returns 404 for trashed folder (MAS-715)', async () => {
    const asset = await seedAsset('bulk-rm-trashed');
    const folderId = await makeFolderWith([asset.id]);
    await prisma.folder.update({ where: { id: folderId }, data: { deletedAt: new Date() } });

    const res = await request(app.server)
      .post(`/api/folders/${folderId}/assets/remove`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assetIds: [asset.id] });

    expect(res.status).toBe(404);

    // Membership row untouched — restore brings it back
    const membership = await prisma.folderAsset.findFirst({
      where: { folderId, assetId: asset.id },
    });
    expect(membership).not.toBeNull();
  });

  it('POST /api/folders/:id/assets/remove — rejects empty, oversized, and non-uuid assetIds with 400', async () => {
    const folderId = await makeFolderWith([]);

    const empty = await request(app.server)
      .post(`/api/folders/${folderId}/assets/remove`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assetIds: [] });
    expect(empty.status).toBe(400);

    const oversized = await request(app.server)
      .post(`/api/folders/${folderId}/assets/remove`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        assetIds: Array.from({ length: 101 }, (_, i) =>
          `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        ),
      });
    expect(oversized.status).toBe(400);

    const nonUuid = await request(app.server)
      .post(`/api/folders/${folderId}/assets/remove`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assetIds: ['not-a-uuid'] });
    expect(nonUuid.status).toBe(400);
  });

  it('POST /api/folders/:id/assets/remove — returns 401 without auth', async () => {
    const res = await request(app.server)
      .post(`/api/folders/${NIL_RECORD_UUID}/assets/remove`)
      .send({ assetIds: [NIL_RECORD_UUID] });

    expect(res.status).toBe(401);
  });

  // ─── Cursor pagination ─────────────────────────────────────────────────────

  it('GET /api/folders/:id/assets — cursor pagination returns correct pages', async () => {
    // Create 5 assets and add them all
    const assets = await Promise.all(
      Array.from({ length: 5 }, (_, i) => seedAsset(`page-key-${i}`)),
    );
    // Sort by id ascending to predict cursor behaviour
    assets.sort((a, b) => a.id.localeCompare(b.id));

    const folderRes = await request(app.server)
      .post('/api/folders')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Pager' });

    await request(app.server)
      .post(`/api/folders/${folderRes.body.id}/assets`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assetIds: assets.map((a) => a.id) });

    // Page 1: limit=2
    const page1 = await request(app.server)
      .get(`/api/folders/${folderRes.body.id}/assets?limit=2`)
      .set('Authorization', `Bearer ${token}`);
    expect(page1.status).toBe(200);
    expect(page1.body.assets.length).toBe(2);
    expect(page1.body.nextCursor).toBeTruthy();

    // Page 2: continue from cursor
    const page2 = await request(app.server)
      .get(`/api/folders/${folderRes.body.id}/assets?limit=2&cursor=${page1.body.nextCursor}`)
      .set('Authorization', `Bearer ${token}`);
    expect(page2.status).toBe(200);
    expect(page2.body.assets.length).toBe(2);
    expect(page2.body.nextCursor).toBeTruthy();

    // Page 3: last page (1 item)
    const page3 = await request(app.server)
      .get(`/api/folders/${folderRes.body.id}/assets?limit=2&cursor=${page2.body.nextCursor}`)
      .set('Authorization', `Bearer ${token}`);
    expect(page3.status).toBe(200);
    expect(page3.body.assets.length).toBe(1);
    expect(page3.body.nextCursor).toBeNull();

    // No overlapping ids between pages
    const ids1 = new Set(page1.body.assets.map((a: { id: string }) => a.id));
    const ids2 = new Set(page2.body.assets.map((a: { id: string }) => a.id));
    const ids3 = new Set(page3.body.assets.map((a: { id: string }) => a.id));
    for (const id of ids2) expect(ids1.has(id)).toBe(false);
    for (const id of ids3) expect(ids1.has(id) || ids2.has(id)).toBe(false);
  });

  // ─── assetId filter on GET /api/folders ────────────────────────────────────

  it('GET /api/folders?assetId=<id> — returns only folders containing that asset', async () => {
    const asset = await seedAsset('filter-asset-key');

    // Create two folders; add the asset to only one
    const folderA = await request(app.server)
      .post('/api/folders')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Folder With Asset' });
    const folderB = await request(app.server)
      .post('/api/folders')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Empty Folder' });

    await request(app.server)
      .post(`/api/folders/${folderA.body.id}/assets`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assetIds: [asset.id] });

    const res = await request(app.server)
      .get(`/api/folders?assetId=${asset.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].id).toBe(folderA.body.id);
    // Folder B must not appear
    const returnedIds = res.body.map((f: { id: string }) => f.id);
    expect(returnedIds).not.toContain(folderB.body.id);
  });
});
