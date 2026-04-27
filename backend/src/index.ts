import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { runMigrations } from './db/client.js';
import { uploadRoutes } from './routes/upload.js';
import { filesRoutes } from './routes/files.js';
import { authRoutes } from './routes/auth.js';
import { authenticate } from './auth/middleware.js';

const AUTH_SKIP = ['/health', '/api/auth/register', '/api/auth/login'];

async function main() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  });

  await app.register(multipart, {
    limits: {
      fileSize: 500 * 1024 * 1024, // 500 MB per file
      files: 10,
    },
  });

  // Protect all /api/* routes except auth endpoints
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/') || AUTH_SKIP.includes(req.url)) return;
    await authenticate(req, reply);
  });

  await app.register(authRoutes);
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
