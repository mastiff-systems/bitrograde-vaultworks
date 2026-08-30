import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyLocalToken } from './tokens.js';
import { verifyKeycloakToken } from './keycloak.js';
import type { TokenPayload } from './tokens.js';
import { prisma } from '../db/client.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: TokenPayload;
  }
}

export async function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    reply.status(401).send({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  const provider = process.env.AUTH_PROVIDER ?? 'local';

  try {
    if (provider === 'keycloak') {
      req.user = await verifyKeycloakToken(token);
    } else {
      req.user = verifyLocalToken(token);
    }
  } catch {
    reply.status(401).send({ error: 'Invalid or expired token' });
  }
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  await authenticate(req, reply);
  if (reply.sent) return;
  if (req.user?.role !== 'admin') {
    reply.status(403).send({ error: 'Admin access required' });
  }
}

// Shared ?token= verifier for routes that can't set an Authorization header
// (media <img>/<video> tags, EventSource). Mirrors the mustChangePassword
// enforcement in the global preHandler (app.ts) — without this check, a
// forced-change-password account keeps a fully usable read path (asset
// downloads/streams/thumbnails, notification SSE) before ever changing its
// password. MAS-660.
export async function authenticateQueryToken(
  token: string | undefined,
  reply: FastifyReply,
): Promise<string | false> {
  if (!token) {
    reply.status(401).send({ error: 'token required' });
    return false;
  }

  let userId: string;
  try {
    const provider = process.env.AUTH_PROVIDER ?? 'local';
    const payload = provider === 'keycloak' ? await verifyKeycloakToken(token) : verifyLocalToken(token);
    userId = payload.userId;
  } catch {
    reply.status(401).send({ error: 'Invalid token' });
    return false;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { mustChangePassword: true },
  });
  if (user?.mustChangePassword) {
    reply.status(403).send({ error: 'Password change required' });
    return false;
  }

  return userId;
}
