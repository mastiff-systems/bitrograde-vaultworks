import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { uploadRoutes } from './routes/upload.js';
import { filesRoutes } from './routes/files.js';
import { tagsRoutes } from './routes/tags.js';
import { authRoutes } from './routes/auth.js';
import { adminRoutes } from './routes/admin.js';
import { notificationsRoutes } from './routes/notifications.js';
import { versionsRoutes } from './routes/versions.js';
import { authenticate } from './auth/middleware.js';

// SSE stream uses ?token= query param auth — skip global Bearer check for that path
const AUTH_SKIP = ['/health', '/api/auth/register', '/api/auth/login', '/api/notifications/stream'];

export async function createApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });

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
  await app.register(tagsRoutes);
  await app.register(notificationsRoutes);
  await app.register(versionsRoutes);

  app.get('/health', async () => ({ status: 'ok' }));

  return app;
}
