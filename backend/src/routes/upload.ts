import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { Transform } from 'stream';
import { prisma } from '../db/client.js';
import { uploadToS3, streamUploadToS3, deleteFromS3 } from '../storage/s3.js';
import { createNotification } from '../notifications/service.js';
import { generateDuplicateName } from '../lib/filename.js';
import { logAudit, AuditAction } from '../lib/audit.js';
import { generateThumbnail } from '../lib/thumbnail.js';

const UploadMetaSchema = z.object({
  category_id: z.string().uuid().optional(),
  subcategory_id: z.string().uuid().optional(),
  license: z.string().max(255).optional(),
  description: z.string().max(2000).optional(),
  tags: z.array(z.string().max(100)).max(20).optional(),
  resolution_w: z.number().int().positive().optional(),
  resolution_h: z.number().int().positive().optional(),
  duration_seconds: z.number().min(0).optional(),
});

type UploadMeta = z.infer<typeof UploadMetaSchema>;

function coerceMeta(fields: Record<string, string>): UploadMeta {
  const raw: Record<string, unknown> = {};
  if (fields.category_id) raw.category_id = fields.category_id;
  if (fields.subcategory_id) raw.subcategory_id = fields.subcategory_id;
  if (fields.license) raw.license = fields.license;
  if (fields.description) raw.description = fields.description;
  if (fields.tags) {
    try { raw.tags = JSON.parse(fields.tags); } catch { /* ignore invalid JSON */ }
  }
  if (fields.resolution_w) raw.resolution_w = parseInt(fields.resolution_w, 10);
  if (fields.resolution_h) raw.resolution_h = parseInt(fields.resolution_h, 10);
  if (fields.duration_seconds) raw.duration_seconds = parseFloat(fields.duration_seconds);
  return raw as UploadMeta;
}

const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a']);
const MODEL_EXTS = new Set(['.glb', '.gltf', '.obj', '.fbx']);
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v']);
const FONT_EXTS = new Set(['.ttf', '.otf', '.woff', '.woff2', '.eot']);
const DOC_EXTS = new Set(['.pdf', '.doc', '.docx', '.txt', '.md', '.rtf', '.odt']);
const SCRIPT_EXTS = new Set(['.js', '.ts', '.lua', '.py', '.gd', '.cs', '.cpp', '.c', '.h', '.hlsl', '.glsl', '.wgsl', '.shader']);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.tga', '.bmp', '.tiff', '.exr', '.hdr', '.svg']);

const FilenameSchema = z.string().min(1, 'Filename is required').max(255, 'Filename too long');
const MimeSchema = z.string().min(1).max(127);

function detectAssetType(filename: string, mime: string): string {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  if (mime.startsWith('audio/') || AUDIO_EXTS.has(ext)) return 'audio';
  if (mime.startsWith('video/') || VIDEO_EXTS.has(ext)) return 'video';
  if (mime.startsWith('model/') || MODEL_EXTS.has(ext)) return '3d';
  if (mime.startsWith('font/') || FONT_EXTS.has(ext)) return 'font';
  if (mime === 'application/pdf' || DOC_EXTS.has(ext)) return 'document';
  if (SCRIPT_EXTS.has(ext)) return 'script';
  if (mime.startsWith('image/') || IMAGE_EXTS.has(ext)) return 'image';
  return 'other';
}

export async function uploadRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/upload', async (req, reply) => {
    const parts = req.parts();
    const uploaded: object[] = [];

    const fields: Record<string, string> = {};

    // Buffered files: images that need thumbnail generation (typically small).
    type BufferedFile = { filename: string; mimetype: string; buffer: Buffer };
    // Streamed files: everything else — uploaded directly to S3 with no heap copy.
    type StreamedFile = {
      id: string;
      filename: string;
      resolvedName: string;
      mimetype: string;
      storageKey: string;
      assetType: string;
      sizeBytes: number;
    };
    const files: BufferedFile[] = [];
    const streamedFiles: StreamedFile[] = [];

    // Pre-fetch existing asset names so duplicate resolution is available while
    // we're still inside the parts() loop (required for the streaming path).
    const existingAssets = await prisma.asset.findMany({ select: { originalName: true } });
    const takenNames: string[] = existingAssets.map((a) => a.originalName);

    for await (const part of parts) {
      if (part.type === 'field') {
        fields[part.fieldname] = part.value as string;
        continue;
      }

      const filenameResult = FilenameSchema.safeParse(part.filename);
      if (!filenameResult.success) {
        part.file.resume();
        // Clean up any S3 objects we already streamed before erroring out.
        await Promise.all(streamedFiles.map((f) => deleteFromS3(f.storageKey).catch(() => {})));
        return reply.status(400).send({
          error: 'Invalid filename',
          fields: { filename: filenameResult.error.issues.map((i) => i.message) },
        });
      }

      const mimeResult = MimeSchema.safeParse(part.mimetype);
      const mime = mimeResult.success ? mimeResult.data : 'application/octet-stream';

      const assetType = detectAssetType(part.filename, mime);

      // Images (and sprites, if added later) must be buffered because thumbnail
      // generation via sharp requires a full Buffer. All other types stream
      // directly to S3 to avoid heap pressure for large files.
      const needsBuffer = assetType === 'image' || assetType === 'sprite';

      if (needsBuffer) {
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) { chunks.push(chunk); }
        files.push({ filename: part.filename, mimetype: mime, buffer: Buffer.concat(chunks) });
      } else {
        // Resolve the name now so the S3 key is stable before the DB write.
        const resolvedName = takenNames.includes(part.filename)
          ? generateDuplicateName(takenNames, part.filename)
          : part.filename;
        // Extend takenNames immediately so later parts in the same batch don't collide.
        takenNames.push(resolvedName);

        const id = uuidv4();
        const storageKey = `assets/${id}/${resolvedName}`;

        // Wrap the incoming file stream in a passthrough Transform that counts bytes
        // as they flow through — no full-file buffer is ever allocated.
        let sizeBytes = 0;
        const counter = new Transform({
          transform(chunk, _enc, cb) {
            sizeBytes += (chunk as Buffer).length;
            cb(null, chunk);
          },
        });
        part.file.pipe(counter);

        try {
          await streamUploadToS3(storageKey, counter, mime);
        } catch (err) {
          // Clean up already-completed streamed uploads before propagating.
          await Promise.all(streamedFiles.map((f) => deleteFromS3(f.storageKey).catch(() => {})));
          throw err;
        }

        streamedFiles.push({ id, filename: part.filename, resolvedName, mimetype: mime, storageKey, assetType, sizeBytes });
      }
    }

    if (files.length === 0 && streamedFiles.length === 0) {
      return reply.status(400).send({ error: 'At least one file is required' });
    }

    // Validate and coerce metadata fields
    const rawMeta = coerceMeta(fields);
    const metaResult = UploadMetaSchema.safeParse(rawMeta);
    if (!metaResult.success) {
      await Promise.all(streamedFiles.map((f) => deleteFromS3(f.storageKey).catch(() => {})));
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of metaResult.error.issues) {
        const key = issue.path.join('.') || '_';
        (fieldErrors[key] ??= []).push(issue.message);
      }
      return reply.status(400).send({ error: 'Validation failed', fields: fieldErrors });
    }
    const meta = metaResult.data;

    // Validate category/subcategory FK references if provided
    if (meta.category_id) {
      const cat = await prisma.category.findUnique({ where: { id: meta.category_id }, select: { id: true } });
      if (!cat) {
        await Promise.all(streamedFiles.map((f) => deleteFromS3(f.storageKey).catch(() => {})));
        return reply.status(400).send({ error: 'category_id does not exist' });
      }
    }
    if (meta.subcategory_id) {
      const sub = await prisma.subcategory.findUnique({ where: { id: meta.subcategory_id }, select: { id: true, categoryId: true } });
      if (!sub) {
        await Promise.all(streamedFiles.map((f) => deleteFromS3(f.storageKey).catch(() => {})));
        return reply.status(400).send({ error: 'subcategory_id does not exist' });
      }
      if (meta.category_id && sub.categoryId !== meta.category_id) {
        await Promise.all(streamedFiles.map((f) => deleteFromS3(f.storageKey).catch(() => {})));
        return reply.status(400).send({ error: 'subcategory_id does not belong to category_id' });
      }
    }

    // ── Buffered files (images) ──────────────────────────────────────────────
    // Upload to S3 + generate thumbnail, then create DB record.

    for (const file of files) {
      const { filename, mimetype: mime, buffer } = file;

      // Resolve a unique name: if the incoming filename is already taken,
      // apply the -Copy / (N) suffix scheme from generateDuplicateName.
      const resolvedName = takenNames.includes(filename)
        ? generateDuplicateName(takenNames, filename)
        : filename;
      // Track the resolved name so subsequent files in this batch don't collide with it.
      takenNames.push(resolvedName);

      const id = uuidv4();
      const storageKey = `assets/${id}/${resolvedName}`;
      const assetType = detectAssetType(resolvedName, mime);

      await uploadToS3(storageKey, buffer, mime);

      let thumbnailKey: string | undefined;
      if (assetType === 'image' || assetType === 'sprite') {
        const thumbBuffer = await generateThumbnail(buffer);
        if (thumbBuffer) {
          thumbnailKey = `assets/${id}/thumbnail.webp`;
          try {
            await uploadToS3(thumbnailKey, thumbBuffer, 'image/webp');
          } catch {
            thumbnailKey = undefined;
          }
        }
      }

      let asset;
      let tagRecords: Array<{ id: string; name: string }> = [];
      try {
        asset = await prisma.asset.create({
          data: {
            id,
            originalName: resolvedName,
            mimeType: mime,
            sizeBytes: BigInt(buffer.length),
            storageKey,
            assetType,
            thumbnailKey,
            description: meta.description,
            categoryId: meta.category_id,
            subcategoryId: meta.subcategory_id,
            license: meta.license,
            resolutionW: meta.resolution_w,
            resolutionH: meta.resolution_h,
            durationSeconds: meta.duration_seconds,
            uploadedBy: req.user.userId,
          },
          select: {
            id: true,
            originalName: true,
            mimeType: true,
            sizeBytes: true,
            assetType: true,
            thumbnailKey: true,
            uploadedAt: true,
            description: true,
            categoryId: true,
            subcategoryId: true,
            license: true,
            resolutionW: true,
            resolutionH: true,
            durationSeconds: true,
          },
        });

        if (meta.tags && meta.tags.length > 0) {
          const tagNames = [...new Set(meta.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
          if (tagNames.length > 0) {
            await prisma.$transaction(async (tx) => {
              for (const name of tagNames) {
                await tx.tag.upsert({ where: { name }, create: { name }, update: {} });
              }
              const tags = await tx.tag.findMany({ where: { name: { in: tagNames } }, select: { id: true, name: true } });
              await tx.assetTag.createMany({ data: tags.map((t) => ({ assetId: id, tagId: t.id })) });
              tagRecords = [...tags];
            });
          }
        }
      } catch (err) {
        await deleteFromS3(storageKey).catch(() => {});
        if (thumbnailKey) await deleteFromS3(thumbnailKey).catch(() => {});
        throw err;
      }

      void logAudit({
        userId: req.user.userId,
        action: AuditAction.UPLOAD,
        assetId: asset.id,
        assetName: asset.originalName,
        ipAddress: req.ip,
      });

      uploaded.push({
        id: asset.id,
        original_name: asset.originalName,
        mime_type: asset.mimeType,
        size_bytes: asset.sizeBytes !== null ? Number(asset.sizeBytes) : null,
        asset_type: asset.assetType,
        thumbnail_key: asset.thumbnailKey,
        uploaded_at: asset.uploadedAt,
        description: asset.description,
        tags: tagRecords,
        category_id: asset.categoryId,
        subcategory_id: asset.subcategoryId,
        license: asset.license,
        resolution_w: asset.resolutionW,
        resolution_h: asset.resolutionH,
        duration_seconds: asset.durationSeconds,
      });

      // Fire-and-forget notifications — don't block the upload response
      void (async () => {
        try {
          await createNotification({
            userId: req.user.userId,
            type: 'upload_complete',
            title: 'Upload complete',
            body: `${resolvedName} is ready.`,
            resourceId: asset.id,
          });

          const others = await prisma.user.findMany({
            where: { id: { not: req.user.userId } },
            select: { id: true },
          });
          await Promise.all(
            others.map((u) =>
              createNotification({
                userId: u.id,
                type: 'new_asset',
                title: 'New asset uploaded',
                body: `${resolvedName} was added to the library.`,
                resourceId: asset.id,
              }),
            ),
          );
        } catch {
          // Notification failure should not affect upload response
        }
      })();
    }

    // ── Streamed files (non-images) ──────────────────────────────────────────
    // Already on S3 — just create the DB record.

    for (const sf of streamedFiles) {
      const { id, resolvedName, mimetype: mime, storageKey, assetType, sizeBytes } = sf;

      let asset;
      let tagRecords: Array<{ id: string; name: string }> = [];
      try {
        asset = await prisma.asset.create({
          data: {
            id,
            originalName: resolvedName,
            mimeType: mime,
            sizeBytes: BigInt(sizeBytes),
            storageKey,
            assetType,
            description: meta.description,
            categoryId: meta.category_id,
            subcategoryId: meta.subcategory_id,
            license: meta.license,
            resolutionW: meta.resolution_w,
            resolutionH: meta.resolution_h,
            durationSeconds: meta.duration_seconds,
            uploadedBy: req.user.userId,
          },
          select: {
            id: true,
            originalName: true,
            mimeType: true,
            sizeBytes: true,
            assetType: true,
            thumbnailKey: true,
            uploadedAt: true,
            description: true,
            categoryId: true,
            subcategoryId: true,
            license: true,
            resolutionW: true,
            resolutionH: true,
            durationSeconds: true,
          },
        });

        if (meta.tags && meta.tags.length > 0) {
          const tagNames = [...new Set(meta.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
          if (tagNames.length > 0) {
            await prisma.$transaction(async (tx) => {
              for (const name of tagNames) {
                await tx.tag.upsert({ where: { name }, create: { name }, update: {} });
              }
              const tags = await tx.tag.findMany({ where: { name: { in: tagNames } }, select: { id: true, name: true } });
              await tx.assetTag.createMany({ data: tags.map((t) => ({ assetId: id, tagId: t.id })) });
              tagRecords = [...tags];
            });
          }
        }
      } catch (err) {
        // S3 object already exists; clean it up to avoid orphans.
        await deleteFromS3(storageKey).catch(() => {});
        throw err;
      }

      void logAudit({
        userId: req.user.userId,
        action: AuditAction.UPLOAD,
        assetId: asset.id,
        assetName: asset.originalName,
        ipAddress: req.ip,
      });

      uploaded.push({
        id: asset.id,
        original_name: asset.originalName,
        mime_type: asset.mimeType,
        size_bytes: asset.sizeBytes !== null ? Number(asset.sizeBytes) : null,
        asset_type: asset.assetType,
        thumbnail_key: asset.thumbnailKey,
        uploaded_at: asset.uploadedAt,
        description: asset.description,
        tags: tagRecords,
        category_id: asset.categoryId,
        subcategory_id: asset.subcategoryId,
        license: asset.license,
        resolution_w: asset.resolutionW,
        resolution_h: asset.resolutionH,
        duration_seconds: asset.durationSeconds,
      });

      // Fire-and-forget notifications — don't block the upload response
      void (async () => {
        try {
          await createNotification({
            userId: req.user.userId,
            type: 'upload_complete',
            title: 'Upload complete',
            body: `${resolvedName} is ready.`,
            resourceId: asset.id,
          });

          const others = await prisma.user.findMany({
            where: { id: { not: req.user.userId } },
            select: { id: true },
          });
          await Promise.all(
            others.map((u) =>
              createNotification({
                userId: u.id,
                type: 'new_asset',
                title: 'New asset uploaded',
                body: `${resolvedName} was added to the library.`,
                resourceId: asset.id,
              }),
            ),
          );
        } catch {
          // Notification failure should not affect upload response
        }
      })();
    }

    return reply.status(201).send(uploaded);
  });
}
