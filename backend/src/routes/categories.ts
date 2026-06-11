import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/client.js';
import { parseBody, parseParams } from '../lib/validate.js';

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\s&]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

const UuidParams = z.object({ id: z.string().uuid('Invalid ID') });
const CategoryIdParams = z.object({ categoryId: z.string().uuid('Invalid category ID') });
const SubcategoryParams = z.object({
  categoryId: z.string().uuid('Invalid category ID'),
  id: z.string().uuid('Invalid ID'),
});

const CreateCategoryBody = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(255).optional(),
});
const UpdateCategoryBody = z.object({
  name: z.string().min(1).max(255).optional(),
  slug: z.string().min(1).max(255).optional(),
});

const CreateSubcategoryBody = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(255).optional(),
});
const UpdateSubcategoryBody = z.object({
  name: z.string().min(1).max(255).optional(),
  slug: z.string().min(1).max(255).optional(),
});

function formatCategory(c: {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
  subcategories: { id: string; name: string; slug: string }[];
}) {
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
    subcategories: c.subcategories,
  };
}

function formatSubcategory(s: {
  id: string;
  categoryId: string;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: s.id,
    category_id: s.categoryId,
    name: s.name,
    slug: s.slug,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
  };
}

const categorySelect = {
  id: true,
  name: true,
  slug: true,
  createdAt: true,
  updatedAt: true,
  subcategories: {
    select: { id: true, name: true, slug: true },
    orderBy: { name: 'asc' as const },
  },
} as const;

const subcategorySelect = {
  id: true,
  categoryId: true,
  name: true,
  slug: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function categoriesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/categories', async (_req, reply) => {
    const categories = await prisma.category.findMany({
      select: categorySelect,
      orderBy: { name: 'asc' },
    });
    return reply.send(categories.map(formatCategory));
  });

  app.post('/api/categories', async (req, reply) => {
    const body = parseBody(CreateCategoryBody, req.body, reply);
    if (!body) return;

    const name = body.name.trim();
    const slug = (body.slug ?? toSlug(name)).trim();

    try {
      const category = await prisma.category.create({
        data: { name, slug },
        select: categorySelect,
      });
      return reply.status(201).send(formatCategory(category));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.status(409).send({ error: 'Category name or slug already exists' });
      }
      throw err;
    }
  });

  app.patch<{ Params: { id: string } }>('/api/categories/:id', async (req, reply) => {
    const params = parseParams(UuidParams, req.params, reply);
    if (!params) return;

    const body = parseBody(UpdateCategoryBody, req.body, reply);
    if (!body) return;

    const data: { name?: string; slug?: string } = {};
    if (body.name !== undefined) data.name = body.name.trim();
    if (body.slug !== undefined) data.slug = body.slug.trim();

    try {
      const category = await prisma.category.update({
        where: { id: params.id },
        data,
        select: categorySelect,
      });
      return reply.send(formatCategory(category));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2025') return reply.status(404).send({ error: 'Category not found' });
        if (err.code === 'P2002') return reply.status(409).send({ error: 'Name or slug conflict' });
      }
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>('/api/categories/:id', async (req, reply) => {
    const params = parseParams(UuidParams, req.params, reply);
    if (!params) return;

    try {
      await prisma.category.delete({ where: { id: params.id } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return reply.status(404).send({ error: 'Category not found' });
      }
      throw err;
    }
    return reply.status(204).send();
  });

  // --- Subcategories ---

  app.get<{ Params: { categoryId: string } }>(
    '/api/categories/:categoryId/subcategories',
    async (req, reply) => {
      const params = parseParams(CategoryIdParams, req.params, reply);
      if (!params) return;

      const category = await prisma.category.findUnique({
        where: { id: params.categoryId },
        select: { id: true },
      });
      if (!category) return reply.status(404).send({ error: 'Category not found' });

      const subs = await prisma.subcategory.findMany({
        where: { categoryId: params.categoryId },
        select: subcategorySelect,
        orderBy: { name: 'asc' },
      });
      return reply.send(subs.map(formatSubcategory));
    },
  );

  app.post<{ Params: { categoryId: string } }>(
    '/api/categories/:categoryId/subcategories',
    async (req, reply) => {
      const params = parseParams(CategoryIdParams, req.params, reply);
      if (!params) return;

      const body = parseBody(CreateSubcategoryBody, req.body, reply);
      if (!body) return;

      const category = await prisma.category.findUnique({
        where: { id: params.categoryId },
        select: { id: true },
      });
      if (!category) return reply.status(404).send({ error: 'Category not found' });

      const name = body.name.trim();
      const slug = (body.slug ?? toSlug(name)).trim();

      try {
        const sub = await prisma.subcategory.create({
          data: { categoryId: params.categoryId, name, slug },
          select: subcategorySelect,
        });
        return reply.status(201).send(formatSubcategory(sub));
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return reply.status(409).send({ error: 'Slug already exists in this category' });
        }
        throw err;
      }
    },
  );

  app.patch<{ Params: { categoryId: string; id: string } }>(
    '/api/categories/:categoryId/subcategories/:id',
    async (req, reply) => {
      const params = parseParams(SubcategoryParams, req.params, reply);
      if (!params) return;

      const body = parseBody(UpdateSubcategoryBody, req.body, reply);
      if (!body) return;

      const existing = await prisma.subcategory.findFirst({
        where: { id: params.id, categoryId: params.categoryId },
        select: { id: true },
      });
      if (!existing) return reply.status(404).send({ error: 'Subcategory not found' });

      const data: { name?: string; slug?: string } = {};
      if (body.name !== undefined) data.name = body.name.trim();
      if (body.slug !== undefined) data.slug = body.slug.trim();

      try {
        const sub = await prisma.subcategory.update({
          where: { id: params.id },
          data,
          select: subcategorySelect,
        });
        return reply.send(formatSubcategory(sub));
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return reply.status(409).send({ error: 'Slug conflict within category' });
        }
        throw err;
      }
    },
  );

  app.delete<{ Params: { categoryId: string; id: string } }>(
    '/api/categories/:categoryId/subcategories/:id',
    async (req, reply) => {
      const params = parseParams(SubcategoryParams, req.params, reply);
      if (!params) return;

      const result = await prisma.subcategory.deleteMany({
        where: { id: params.id, categoryId: params.categoryId },
      });
      if (result.count === 0) return reply.status(404).send({ error: 'Subcategory not found' });
      return reply.status(204).send();
    },
  );
}
