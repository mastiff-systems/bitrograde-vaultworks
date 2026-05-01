import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { prisma } from '../db/client.js';
import { uploadToS3 } from '../storage/s3.js';

const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a']);
const MODEL_EXTS = new Set(['.glb', '.gltf', '.obj', '.fbx']);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.tga', '.bmp', '.tiff', '.exr']);

const FilenameSchema = z.string().min(1, 'Filename is required').max(255, 'Filename too long');
const MimeSchema = z.string().min(1).max(127);

function detectAssetType(filename: string, mime: string): string {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  if (mime.startsWith('audio/') || AUDIO_EXTS.has(ext)) return 'audio';
  if (mime.startsWith('model/') || MODEL_EXTS.has(ext)) return '3d';
  if (mime.startsWith('image/') || IMAGE_EXTS.has(ext)) return 'image';
  return 'other';
}

async function generateThumbnail(buffer: Buffer): Promise<Buffer | null> {
  try {
    return await sharp(buffer)
      .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    return null;
  }
}

export async function uploadRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/upload', async (req, reply) => {
    const parts = req.files();
    const uploaded: object[] = [];

    for await (const part of parts) {
      const filenameResult = FilenameSchema.safeParse(part.filename);
      if (!filenameResult.success) {
        // Drain stream to avoid memory leaks
        part.file.resume();
        return reply.status(400).send({ error: 'Invalid filename', fields: { filename: filenameResult.error.issues.map(i => i.message) } });
      }

      const mimeResult = MimeSchema.safeParse(part.mimetype);
      const mime = mimeResult.success ? mimeResult.data : 'application/octet-stream';

      const chunks: Buffer[] = [];
      for await (const chunk of part.file) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      const id = uuidv4();
      const storageKey = `assets/${id}/${part.filename}`;
      const assetType = detectAssetType(part.filename, mime);

      await uploadToS3(storageKey, buffer, mime);

      let thumbnailKey: string | undefined;
      if (assetType === 'image') {
        const thumbBuffer = await generateThumbnail(buffer);
        if (thumbBuffer) {
          thumbnailKey = `assets/${id}/thumbnail.webp`;
          await uploadToS3(thumbnailKey, thumbBuffer, 'image/webp');
        }
      }

      const asset = await prisma.asset.create({
        data: {
          id,
          originalName: part.filename,
          mimeType: mime,
          sizeBytes: BigInt(buffer.length),
          storageKey,
          assetType,
          thumbnailKey,
        },
        select: {
          id: true,
          originalName: true,
          mimeType: true,
          sizeBytes: true,
          assetType: true,
          thumbnailKey: true,
          uploadedAt: true,
        },
      });

      uploaded.push({
        id: asset.id,
        original_name: asset.originalName,
        mime_type: asset.mimeType,
        size_bytes: asset.sizeBytes !== null ? Number(asset.sizeBytes) : null,
        asset_type: asset.assetType,
        thumbnail_key: asset.thumbnailKey,
        uploaded_at: asset.uploadedAt,
      });
    }

    if (uploaded.length === 0) {
      return reply.status(400).send({ error: 'At least one file is required' });
    }

    return reply.status(201).send(uploaded);
  });
}
