import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../db/client.js';
import { getAllSettings, upsertSettings } from '../db/settings.js';
import { requireAdmin } from '../auth/middleware.js';
import { parseBody, parseParams } from '../lib/validate.js';

const MASKED = '••••••••';
const SECRET_KEYS = new Set(['s3_secret_key']);

const UuidParams = z.object({ id: z.string().uuid('Invalid ID') });

const SettingsBody = z.record(z.string(), z.string());

const UserRoleBody = z.object({
  role: z.enum(['admin', 'user'], { message: 'role must be "admin" or "user"' }),
});

function maskSecrets(settings: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(settings).map(([k, v]) => [k, SECRET_KEYS.has(k) && v ? MASKED : v]),
  );
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  const opts = { preHandler: [requireAdmin] };

  // GET /api/admin/stats
  app.get('/api/admin/stats', opts, async (_req, reply) => {
    const [users, assets] = await Promise.all([
      pool.query<{ count: string; admin_count: string }>(
        `SELECT COUNT(*) as count, COUNT(*) FILTER (WHERE role='admin') as admin_count FROM users`,
      ),
      pool.query<{ count: string; total_size: string }>(
        `SELECT COUNT(*) as count, COALESCE(SUM(size_bytes), 0) as total_size FROM assets`,
      ),
    ]);

    return reply.send({
      users: parseInt(users.rows[0].count, 10),
      admins: parseInt(users.rows[0].admin_count, 10),
      assets: parseInt(assets.rows[0].count, 10),
      totalSizeBytes: parseInt(assets.rows[0].total_size, 10),
    });
  });

  // GET /api/admin/settings
  app.get('/api/admin/settings', opts, async (_req, reply) => {
    const all = await getAllSettings();
    return reply.send(maskSecrets(all));
  });

  // PUT /api/admin/settings
  app.put('/api/admin/settings', opts, async (req, reply) => {
    const body = parseBody(SettingsBody, req.body, reply);
    if (!body) return;

    // Strip masked secret values — keep existing if unchanged
    const existing = await getAllSettings();
    const updates: Record<string, string> = {};
    for (const [key, value] of Object.entries(body)) {
      if (SECRET_KEYS.has(key) && value === MASKED) {
        if (existing[key]) updates[key] = existing[key];
      } else {
        updates[key] = value;
      }
    }

    await upsertSettings(updates);
    const updated = await getAllSettings();
    return reply.send(maskSecrets(updated));
  });

  // GET /api/admin/users
  app.get('/api/admin/users', opts, async (_req, reply) => {
    const { rows } = await pool.query<{ id: string; email: string; role: string; created_at: string }>(
      'SELECT id, email, role, created_at FROM users ORDER BY created_at ASC',
    );
    return reply.send(rows);
  });

  // PATCH /api/admin/users/:id/role
  app.patch<{ Params: { id: string } }>('/api/admin/users/:id/role', opts, async (req, reply) => {
    const params = parseParams(UuidParams, req.params, reply);
    if (!params) return;

    const body = parseBody(UserRoleBody, req.body, reply);
    if (!body) return;

    // Prevent demoting yourself
    if (params.id === req.user.userId && body.role !== 'admin') {
      return reply.status(400).send({ error: 'Cannot demote your own account' });
    }

    const { rows } = await pool.query<{ id: string; email: string; role: string }>(
      'UPDATE users SET role = $1 WHERE id = $2 RETURNING id, email, role',
      [body.role, params.id],
    );
    if (!rows[0]) return reply.status(404).send({ error: 'User not found' });
    return reply.send(rows[0]);
  });
}
