import { FastifyInstance } from 'fastify';
import { pool } from '../db/client';
import { deleteFromS3, getS3ObjectStream } from '../storage/s3';

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

  // Streams the file through the backend — avoids exposing internal S3/MinIO URLs to clients
  app.get<{ Params: { id: string } }>('/api/files/:id/download', async (req, reply) => {
    const { rows } = await pool.query(
      'SELECT storage_key, original_name, mime_type FROM assets WHERE id = $1',
      [req.params.id],
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Not found' });

    const { stream, contentType, contentLength } = await getS3ObjectStream(rows[0].storage_key);

    const mime = contentType ?? rows[0].mime_type ?? 'application/octet-stream';
    const filename = encodeURIComponent(rows[0].original_name);

    reply.header('Content-Type', mime);
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    if (contentLength) reply.header('Content-Length', contentLength);

    return reply.send(stream);
  });

  // Inline stream for previews — no Content-Disposition attachment
  app.get<{ Params: { id: string } }>('/api/files/:id/stream', async (req, reply) => {
    const { rows } = await pool.query(
      'SELECT storage_key, mime_type FROM assets WHERE id = $1',
      [req.params.id],
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Not found' });

    const { stream, contentType, contentLength } = await getS3ObjectStream(rows[0].storage_key);

    reply.header('Content-Type', contentType ?? rows[0].mime_type ?? 'application/octet-stream');
    if (contentLength) reply.header('Content-Length', contentLength);

    return reply.send(stream);
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
