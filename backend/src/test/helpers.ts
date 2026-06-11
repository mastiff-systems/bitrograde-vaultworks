import type { FastifyInstance } from 'fastify';
import { createApp } from '../app.js';
import { prisma } from '../db/client.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = await createApp();
  await app.listen({ port: 0 }); // random port; lets supertest use app.server
  return app;
}

export async function cleanDb(): Promise<void> {
  await prisma.assetTag.deleteMany();
  await prisma.assetVersion.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.user.deleteMany();
  await prisma.setting.deleteMany();
  await prisma.subcategory.deleteMany();
  await prisma.category.deleteMany();
}
