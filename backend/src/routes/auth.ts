import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { pool } from '../db/client.js';
import { signToken } from '../auth/tokens.js';
import { authenticate } from '../auth/middleware.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  if ((process.env.AUTH_PROVIDER ?? 'local') !== 'local') return;

  app.post('/api/auth/register', async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body?.password === 'string' ? body.password : '';

    if (!email || !password) {
      return reply.status(400).send({ error: 'email and password are required' });
    }
    if (password.length < 8) {
      return reply.status(400).send({ error: 'password must be at least 8 characters' });
    }

    const hash = await bcrypt.hash(password, 12);

    // First user becomes admin
    const { rows: existing } = await pool.query<{ count: string }>('SELECT COUNT(*) as count FROM users');
    const role = parseInt(existing[0].count, 10) === 0 ? 'admin' : 'user';

    try {
      const { rows } = await pool.query<{ id: string; email: string; role: string }>(
        'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id, email, role',
        [email, hash, role],
      );
      const token = signToken({ userId: rows[0].id, email: rows[0].email, role: rows[0].role as 'admin' | 'user' });
      return reply.status(201).send({ token, user: { id: rows[0].id, email: rows[0].email, role: rows[0].role } });
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === '23505') {
        return reply.status(409).send({ error: 'Email already registered' });
      }
      throw err;
    }
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body?.password === 'string' ? body.password : '';

    if (!email || !password) {
      return reply.status(400).send({ error: 'email and password are required' });
    }

    const { rows } = await pool.query<{ id: string; email: string; password_hash: string; role: string }>(
      'SELECT id, email, password_hash, role FROM users WHERE email = $1',
      [email],
    );

    const dummyHash = '$2a$12$invalidhashpadding.............';
    const valid = rows[0]
      ? await bcrypt.compare(password, rows[0].password_hash)
      : await bcrypt.compare(password, dummyHash).then(() => false);

    if (!rows[0] || !valid) {
      return reply.status(401).send({ error: 'Invalid email or password' });
    }

    const token = signToken({ userId: rows[0].id, email: rows[0].email, role: rows[0].role as 'admin' | 'user' });
    return reply.send({ token, user: { id: rows[0].id, email: rows[0].email, role: rows[0].role } });
  });

  app.get('/api/auth/me', { preHandler: [authenticate] }, async (req, reply) => {
    return reply.send(req.user);
  });
}
