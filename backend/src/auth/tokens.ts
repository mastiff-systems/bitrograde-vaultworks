import jwt from 'jsonwebtoken';

const secret = () => {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is not set');
  return s;
};

export interface TokenPayload {
  userId: string;
  email: string;
  role: 'admin' | 'user';
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, secret(), {
    expiresIn: (process.env.JWT_EXPIRY ?? '24h') as jwt.SignOptions['expiresIn'],
    issuer: 'vaultworks',
  });
}

export function verifyLocalToken(token: string): TokenPayload {
  const decoded = jwt.verify(token, secret(), { issuer: 'vaultworks' });
  return decoded as TokenPayload;
}
