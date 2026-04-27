import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { runMigrations } from './db/client';
import { uploadRoutes } from './routes/upload';
import { filesRoutes } from './routes/files';

async function main() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
    methods: ['GET', 'POST', 'DELETE'],
  });

  await app.register(multipart, {
    limits: {
      fileSize: 500 * 1024 * 1024, // 500 MB per file
      files: 10,
    },
  });

  await app.register(uploadRoutes);
  await app.register(filesRoutes);

  app.get('/health', async () => ({ status: 'ok' }));

  await runMigrations();
  await app.listen({ port: Number(process.env.PORT ?? 3001), host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
