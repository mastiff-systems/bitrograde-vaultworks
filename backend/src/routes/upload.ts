import { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db/client';
import { uploadToS3 } from '../storage/s3';

const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a']);
const MODEL_EXTS = new Set(['.glb', '.gltf', '.obj', '.fbx']);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.tga', '.bmp', '.tiff', '.exr']);

function detectAssetType(filename: string, mime: string): string {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  if (mime.startsWith('audio/') || AUDIO_EXTS.has(ext)) return 'audio';
  if (mime.startsWith('model/') || MODEL_EXTS.has(ext)) return '3d';
  if (mime.startsWith('image/') || IMAGE_EXTS.has(ext)) return 'image';
  return 'other';
}

export async function uploadRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/upload', async (req, reply) => {
    const parts = req.files();
    const uploaded: object[] = [];

    for await (const part of parts) {
      const chunks: Buffer[] = [];
      for await (const chunk of part.file) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      const id = uuidv4();
      const storageKey = `assets/${id}/${part.filename}`;
      const mime = part.mimetype || 'application/octet-stream';
      const assetType = detectAssetType(part.filename, mime);

      await uploadToS3(storageKey, buffer, mime);

      const { rows } = await pool.query(
        `INSERT INTO assets (id, original_name, mime_type, size_bytes, storage_key, asset_type)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, original_name, mime_type, size_bytes, asset_type, uploaded_at`,
        [id, part.filename, mime, buffer.length, storageKey, assetType],
      );
      uploaded.push(rows[0]);
    }

    return reply.status(201).send(uploaded);
  });
}
