import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyLocalToken } from './tokens.js';
import { verifyKeycloakToken } from './keycloak.js';
import type { TokenPayload } from './tokens.js';

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
