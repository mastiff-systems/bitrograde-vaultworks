import jwksRsa from 'jwks-rsa';
import jwt from 'jsonwebtoken';
import type { TokenPayload } from './tokens.js';

let client: jwksRsa.JwksClient | null = null;

function getJwksClient(): jwksRsa.JwksClient {
  if (!client) {
    const uri = process.env.KEYCLOAK_JWKS_URI;
    if (!uri) throw new Error('KEYCLOAK_JWKS_URI is not set');
    client = jwksRsa({
      jwksUri: uri,
      cache: true,
      cacheMaxEntries: 10,
      cacheMaxAge: 600_000,
      rateLimit: true,
    });
  }
  return client;
}

export async function verifyKeycloakToken(token: string): Promise<TokenPayload> {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded === 'string') {
    throw new Error('Invalid token structure');
  }

  const kid = decoded.header.kid;
  const key = await getJwksClient().getSigningKey(kid);
  const publicKey = key.getPublicKey();

  const payload = jwt.verify(token, publicKey) as Record<string, unknown>;

  return {
    userId: payload.sub as string,
    email: (payload.email ?? payload.preferred_username) as string,
  };
}
