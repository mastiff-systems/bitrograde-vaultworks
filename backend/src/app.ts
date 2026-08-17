import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { uploadRoutes } from './routes/upload.js';
import { filesRoutes } from './routes/files.js';
import { tagsRoutes } from './routes/tags.js';
import { authRoutes } from './routes/auth.js';
import { adminRoutes } from './routes/admin.js';
import { notificationsRoutes } from './routes/notifications.js';
import { versionsRoutes } from './routes/versions.js';
import { categoriesRoutes } from './routes/categories.js';
import { foldersRoutes } from './routes/folders.js';
import { authenticate } from './auth/middleware.js';

// Routes that use ?token= query param auth (browser can't set headers for media/SSE)
const AUTH_SKIP = ['/health', '/api/auth/register', '/api/auth/login', '/api/notifications/stream'];
const ASSET_MEDIA_RE = /^\/api\/files\/[0-9a-f-]{36}\/(stream|thumbnail|download)$|^\/api\/files\/[0-9a-f-]{36}\/versions\/[0-9a-f-]{36}\/download$/;
// Public share download route — unauthenticated by design
const SHARE_TOKEN_RE = /^\/api\/share\/[0-9a-f]{64}$/;

export async function createApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? false,
    ajv: {
      customOptions: {
        // Do not silently strip extra fields — schemas with additionalProperties:false must reject them.
        removeAdditional: false,
        coerceTypes: 'array',
        useDefaults: true,
        allErrors: true,
      },
    },
  });

  // Security headers on every response — registered first so all replies are covered
  await app.register(helmet, {
    contentSecurityPolicy: process.env.HELMET_CSP ? undefined : false,
  });

  // Rate limiting available opt-in per route via config.rateLimit
  await app.register(rateLimit, { global: false });

  const corsOrigin = process.env.CORS_ORIGIN;
  if (process.env.NODE_ENV === 'production' && !corsOrigin) {
    throw new Error(
      'CORS_ORIGIN env var must be set in production (NODE_ENV=production). ' +
      'Example: CORS_ORIGIN=https://vaultworks.example.com',
    );
  }

  await app.register(cors, {
    origin: corsOrigin ?? '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(multipart, {
    limits: { fileSize: Number(process.env.MAX_UPLOAD_BYTES ?? 5 * 1024 * 1024 * 1024), files: 10 },
  });

  app.addHook('preHandler', async (req, reply) => {
    const path = req.url.split('?')[0];
    if (!path.startsWith('/api/') || AUTH_SKIP.includes(path) || ASSET_MEDIA_RE.test(path) || SHARE_TOKEN_RE.test(path)) return;
    await authenticate(req, reply);
  });

  await app.register(authRoutes);
  await app.register(adminRoutes);
  await app.register(uploadRoutes);
  await app.register(filesRoutes);
  await app.register(tagsRoutes);
  await app.register(notificationsRoutes);
  await app.register(versionsRoutes);
  await app.register(categoriesRoutes);
  await app.register(foldersRoutes);

  app.get('/health', async () => ({ status: 'ok' }));

  return app;
}
