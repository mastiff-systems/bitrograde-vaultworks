import type { FastifyInstance } from 'fastify';
import { pool } from '../db/client.js';
import { getAllSettings, upsertSettings } from '../db/settings.js';
import { requireAdmin } from '../auth/middleware.js';

const MASKED = '••••••••';
const SECRET_KEYS = new Set(['s3_secret_key']);

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
    const body = req.body as Record<string, string>;
    if (typeof body !== 'object' || Array.isArray(body)) {
      return reply.status(400).send({ error: 'Body must be a key-value object' });
    }

    // Strip masked secret values — keep existing if unchanged
    const existing = await getAllSettings();
    const updates: Record<string, string> = {};
    for (const [key, value] of Object.entries(body)) {
      if (SECRET_KEYS.has(key) && value === MASKED) {
        // unchanged — keep existing
        if (existing[key]) updates[key] = existing[key];
      } else if (value !== undefined && value !== null) {
        updates[key] = String(value);
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
    const { role } = req.body as { role: string };
    if (role !== 'admin' && role !== 'user') {
      return reply.status(400).send({ error: 'role must be "admin" or "user"' });
    }

    // Prevent demoting yourself
    if (req.params.id === req.user.userId && role !== 'admin') {
      return reply.status(400).send({ error: 'Cannot demote your own account' });
    }

    const { rows } = await pool.query<{ id: string; email: string; role: string }>(
      'UPDATE users SET role = $1 WHERE id = $2 RETURNING id, email, role',
      [role, req.params.id],
    );
    if (!rows[0]) return reply.status(404).send({ error: 'User not found' });
    return reply.send(rows[0]);
  });
}
