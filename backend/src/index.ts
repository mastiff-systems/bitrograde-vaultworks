import path from 'path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import staticFiles from '@fastify/static';
import { runMigrations } from './db/client.js';
import { uploadRoutes } from './routes/upload.js';
import { filesRoutes } from './routes/files.js';
import { authRoutes } from './routes/auth.js';
import { adminRoutes } from './routes/admin.js';
import { authenticate } from './auth/middleware.js';

// __dirname is available in CommonJS (this project compiles to CJS)
const FRONTEND_DIST = path.resolve(__dirname, '../../frontend/dist');

const AUTH_SKIP = ['/health', '/api/auth/register', '/api/auth/login'];

async function main() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: process.env.CORS_ORIGIN ?? '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(multipart, {
    limits: { fileSize: 500 * 1024 * 1024, files: 10 },
  });

  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/') || AUTH_SKIP.includes(req.url)) return;
    await authenticate(req, reply);
  });

  await app.register(authRoutes);
  await app.register(adminRoutes);
  await app.register(uploadRoutes);
  await app.register(filesRoutes);

  app.get('/health', async () => ({ status: 'ok' }));

  // Serve the built frontend. SPA fallback: unknown paths → index.html.
  try {
    await app.register(staticFiles, {
      root: FRONTEND_DIST,
      prefix: '/',
    });

    app.setNotFoundHandler((_req, reply) => {
      reply.sendFile('index.html', FRONTEND_DIST);
    });
  } catch {
    app.log.warn('Frontend dist not found — run "npm run build:frontend" to enable UI');
  }

  await runMigrations();
  await app.listen({ port: Number(process.env.PORT ?? 3001), host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
