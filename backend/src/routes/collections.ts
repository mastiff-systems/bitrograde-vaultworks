import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { parseBody, parseParams } from '../lib/validate.js';
import { authenticate } from '../auth/middleware.js';

const UuidParams = z.object({ id: z.string().uuid('Invalid collection ID') });
const AssetUuidParams = z.object({
  id: z.string().uuid('Invalid collection ID'),
  assetId: z.string().uuid('Invalid asset ID'),
});

const CreateCollectionSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
});

const UpdateCollectionSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
});

const AddAssetsSchema = z.object({
  assetIds: z.array(z.string().uuid()).min(1).max(100),
});

export async function collectionsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/collections — list all collections with asset count + first thumbnail.
  // Collections are shared-read across the library (like assets and folders):
  // everyone can see and filter by them; only the owner or an admin can modify.
  app.get('/api/collections', {
    preHandler: [authenticate],
    config: { rateLimit: { max: process.env.VITEST ? 10000 : 60, timeWindow: '1 minute' } },
  }, async (_req, reply) => {
    const collections = await prisma.collection.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        assets: {
          where: { asset: { deletedAt: null } },
          take: 1,
          orderBy: { addedAt: 'asc' },
          include: { asset: { select: { id: true, thumbnailKey: true, assetType: true } } },
        },
        _count: { select: { assets: { where: { asset: { deletedAt: null } } } } },
      },
    });

    return reply.send(
      collections.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        created_by: c.createdBy,
        asset_count: c._count.assets,
        preview_asset: c.assets[0]?.asset ?? null,
        created_at: c.createdAt,
        updated_at: c.updatedAt,
      })),
    );
  });

  // POST /api/collections — create a collection
  app.post('/api/collections', {
    preHandler: [authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 255 },
          description: { type: 'string' },
        },
      },
    },
    config: { rateLimit: { max: process.env.VITEST ? 10000 : 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = parseBody(CreateCollectionSchema, req.body, reply);
    if (!body) return;

    const collection = await prisma.collection.create({
      data: {
        name: body.name,
        description: body.description,
        createdBy: req.user.userId,
      },
    });

    return reply.status(201).send({
      id: collection.id,
      name: collection.name,
      description: collection.description,
      created_by: collection.createdBy,
      asset_count: 0,
      preview_asset: null,
      created_at: collection.createdAt,
      updated_at: collection.updatedAt,
    });
  });

  // GET /api/collections/:id — get collection with full asset list (paginated)
  app.get<{ Params: { id: string }; Querystring: { limit?: string; offset?: string } }>(
    '/api/collections/:id',
    {
      preHandler: [authenticate],
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
          additionalProperties: false,
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
            offset: { type: 'integer', minimum: 0, default: 0 },
          },
        },
      },
      config: { rateLimit: { max: process.env.VITEST ? 10000 : 60, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
    const params = parseParams(UuidParams, req.params, reply);
    if (!params) return;

    const limit = Math.min(parseInt(req.query.limit ?? '50', 10) || 50, 200);
    const offset = parseInt(req.query.offset ?? '0', 10) || 0;

    const collection = await prisma.collection.findUnique({
      where: { id: params.id },
      include: {
        assets: {
          where: { asset: { deletedAt: null } },
          orderBy: { addedAt: 'asc' },
          skip: offset,
          take: limit,
          include: {
            asset: {
              select: {
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
                tags: { select: { tag: { select: { id: true, name: true } } } },
              },
            },
          },
        },
        _count: { select: { assets: { where: { asset: { deletedAt: null } } } } },
      },
    });

    if (!collection) return reply.status(404).send({ error: 'Not found' });

    return reply.send({
      id: collection.id,
      name: collection.name,
      description: collection.description,
      created_by: collection.createdBy,
      asset_count: collection._count.assets,
      limit,
      offset,
      created_at: collection.createdAt,
      updated_at: collection.updatedAt,
      assets: collection.assets.map(({ asset, addedAt }) => ({
        id: asset.id,
        original_name: asset.originalName,
        mime_type: asset.mimeType,
        size_bytes: asset.sizeBytes !== null ? Number(asset.sizeBytes) : null,
        asset_type: asset.assetType,
        thumbnail_key: asset.thumbnailKey,
        description: asset.description,
        uploaded_at: asset.uploadedAt,
        updated_at: asset.updatedAt,
        category_id: asset.categoryId,
        subcategory_id: asset.subcategoryId,
        license: asset.license,
        tags: asset.tags.map((at) => at.tag),
        added_at: addedAt,
      })),
    });
  });

  // PATCH /api/collections/:id — update name/description (owner or admin)
  app.patch<{ Params: { id: string } }>('/api/collections/:id', {
    preHandler: [authenticate],
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
          name: { type: 'string', minLength: 1, maxLength: 255 },
          description: { type: ['string', 'null'] },
        },
      },
    },
    config: { rateLimit: { max: process.env.VITEST ? 10000 : 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const params = parseParams(UuidParams, req.params, reply);
    if (!params) return;

    const body = parseBody(UpdateCollectionSchema, req.body, reply);
    if (!body) return;

    const existing = await prisma.collection.findUnique({ where: { id: params.id } });
    if (!existing) return reply.status(404).send({ error: 'Not found' });
    if (existing.createdBy !== req.user.userId && req.user.role !== 'admin') {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const updated = await prisma.collection.update({
      where: { id: params.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
      },
    });

    return reply.send({
      id: updated.id,
      name: updated.name,
      description: updated.description,
      created_by: updated.createdBy,
      created_at: updated.createdAt,
      updated_at: updated.updatedAt,
    });
  });

  // DELETE /api/collections/:id — delete collection (owner or admin)
  app.delete<{ Params: { id: string } }>('/api/collections/:id', {
    preHandler: [authenticate],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
    },
    config: { rateLimit: { max: process.env.VITEST ? 10000 : 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const params = parseParams(UuidParams, req.params, reply);
    if (!params) return;

    const existing = await prisma.collection.findUnique({ where: { id: params.id } });
    if (!existing) return reply.status(404).send({ error: 'Not found' });
    if (existing.createdBy !== req.user.userId && req.user.role !== 'admin') {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    await prisma.collection.delete({ where: { id: params.id } });
    return reply.status(204).send();
  });

  // POST /api/collections/:id/assets — add assets (any authenticated user, upsert).
  // Membership is shared-library organization like folders, so assignment is not
  // owner-gated — anyone can attach assets to a shared collection (e.g. at upload).
  app.post<{ Params: { id: string } }>('/api/collections/:id/assets', {
    preHandler: [authenticate],
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
        required: ['assetIds'],
        additionalProperties: false,
        properties: {
          assetIds: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
            minItems: 1,
            maxItems: 100,
          },
        },
      },
    },
    config: { rateLimit: { max: process.env.VITEST ? 10000 : 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const params = parseParams(UuidParams, req.params, reply);
    if (!params) return;

    const body = parseBody(AddAssetsSchema, req.body, reply);
    if (!body) return;

    const existing = await prisma.collection.findUnique({ where: { id: params.id } });
    if (!existing) return reply.status(404).send({ error: 'Not found' });

    // Trashed assets cannot be assigned — they're invisible in the library.
    const foundAssets = await prisma.asset.findMany({
      where: { id: { in: body.assetIds }, deletedAt: null },
      select: { id: true },
    });
    const foundIds = new Set(foundAssets.map((a) => a.id));
    const missingIds = body.assetIds.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) {
      return reply.status(400).send({ error: 'Invalid asset IDs', invalidIds: missingIds });
    }

    const existingEntries = await prisma.collectionAsset.findMany({
      where: { collectionId: params.id, assetId: { in: body.assetIds } },
      select: { assetId: true },
    });
    const existingAssetIds = new Set(existingEntries.map((e) => e.assetId));
    const newIds = body.assetIds.filter((id) => !existingAssetIds.has(id));

    if (newIds.length > 0) {
      await prisma.collectionAsset.createMany({
        data: newIds.map((assetId) => ({ collectionId: params.id, assetId })),
        skipDuplicates: true,
      });
    }

    return reply.status(200).send({ added: newIds.length });
  });

  // DELETE /api/collections/:id/assets/:assetId — remove asset from collection
  // (any authenticated user — membership is shared-library organization)
  app.delete<{ Params: { id: string; assetId: string } }>(
    '/api/collections/:id/assets/:assetId',
    {
      preHandler: [authenticate],
      schema: {
        params: {
          type: 'object',
          required: ['id', 'assetId'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            assetId: { type: 'string', format: 'uuid' },
          },
        },
      },
      config: { rateLimit: { max: process.env.VITEST ? 10000 : 30, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const params = parseParams(AssetUuidParams, req.params, reply);
      if (!params) return;

      const existing = await prisma.collection.findUnique({ where: { id: params.id } });
      if (!existing) return reply.status(404).send({ error: 'Not found' });

      const deleted = await prisma.collectionAsset.deleteMany({
        where: { collectionId: params.id, assetId: params.assetId },
      });

      if (deleted.count === 0) return reply.status(404).send({ error: 'Asset not in collection' });
      return reply.status(204).send();
    },
  );
}
