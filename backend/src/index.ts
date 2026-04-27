import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { runMigrations } from './db/client.js';
import { uploadRoutes } from './routes/upload.js';
import { filesRoutes } from './routes/files.js';

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

try {
  await runMigrations();
  await app.listen({ port: Number(process.env.PORT ?? 3001), host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
