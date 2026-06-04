import path from 'path';
import staticFiles from '@fastify/static';
import { createApp } from './app.js';
import { prisma } from './db/client.js';

// __dirname is available in CommonJS (this project compiles to CJS)
const FRONTEND_DIST = path.resolve(__dirname, '../../frontend/dist');

async function main() {
  const app = await createApp({ logger: true });

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

  await prisma.$connect();
  await app.listen({ port: Number(process.env.PORT ?? 3001), host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
