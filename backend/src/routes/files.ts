import { FastifyInstance } from 'fastify';
import { pool } from '../db/client.js';
import { deleteFromS3, getSignedDownloadUrl } from '../storage/s3.js';

export async function filesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/files', async (_req, reply) => {
    const { rows } = await pool.query(
      'SELECT id, original_name, mime_type, size_bytes, asset_type, uploaded_at FROM assets ORDER BY uploaded_at DESC',
    );
    return reply.send(rows);
  });

  app.get<{ Params: { id: string } }>('/api/files/:id', async (req, reply) => {
    const { rows } = await pool.query(
      'SELECT id, original_name, mime_type, size_bytes, asset_type, uploaded_at FROM assets WHERE id = $1',
      [req.params.id],
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Not found' });
    return reply.send(rows[0]);
  });

  app.get<{ Params: { id: string } }>('/api/files/:id/download', async (req, reply) => {
    const { rows } = await pool.query(
      'SELECT storage_key, original_name FROM assets WHERE id = $1',
      [req.params.id],
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Not found' });
    const url = await getSignedDownloadUrl(rows[0].storage_key);
    return reply.redirect(url);
  });

  app.delete<{ Params: { id: string } }>('/api/files/:id', async (req, reply) => {
    const { rows } = await pool.query(
      'DELETE FROM assets WHERE id = $1 RETURNING storage_key',
      [req.params.id],
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Not found' });
    await deleteFromS3(rows[0].storage_key);
    return reply.status(204).send();
  });
}
