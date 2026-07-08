import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { uploadToS3, deleteFromS3, getS3ObjectStream } from '../storage/s3.js';
import { parseParams } from '../lib/validate.js';
import { verifyLocalToken } from '../auth/tokens.js';
import { verifyKeycloakToken } from '../auth/keycloak.js';

async function authenticateToken(token: string | undefined, reply: Parameters<typeof parseParams>[2]): Promise<boolean> {
  if (!token) { reply.status(401).send({ error: 'token required' }); return false; }
  try {
    const provider = process.env.AUTH_PROVIDER ?? 'local';
    if (provider === 'keycloak') { await verifyKeycloakToken(token); } else { verifyLocalToken(token); }
    return true;
  } catch { reply.status(401).send({ error: 'Invalid token' }); return false; }
}

const UuidParams = z.object({ id: z.string().uuid('Invalid asset ID') });
const VersionParams = z.object({
  id: z.string().uuid('Invalid asset ID'),
  versionId: z.string().uuid('Invalid version ID'),
});

const FilenameSchema = z.string().min(1).max(255);
const MimeSchema = z.string().min(1).max(127);
const MessageSchema = z.string().max(500).optional();

export async function versionsRoutes(app: FastifyInstance): Promise<void> {
  // List version history for an asset
  app.get<{ Params: { id: string } }>('/api/files/:id/versions', async (req, reply) => {
    const params = parseParams(UuidParams, req.params, reply);
    if (!params) return;

    const asset = await prisma.asset.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!asset) return reply.status(404).send({ error: 'Asset not found' });

    const versions = await prisma.assetVersion.findMany({
      where: { assetId: params.id },
      orderBy: { versionNumber: 'asc' },
      select: {
        id: true,
        versionNumber: true,
        sizeBytes: true,
        mimeType: true,
        message: true,
        uploadedAt: true,
        uploader: { select: { id: true, email: true } },
      },
    });

    return reply.send(
      versions.map((v) => ({
        id: v.id,
        version_number: v.versionNumber,
        size_bytes: v.sizeBytes !== null ? Number(v.sizeBytes) : null,
        mime_type: v.mimeType,
        message: v.message,
        uploaded_at: v.uploadedAt,
        uploader: v.uploader ? { id: v.uploader.id, email: v.uploader.email } : null,
      })),
    );
  });

  // Upload a new version of an asset
  app.post<{ Params: { id: string } }>('/api/files/:id/versions', async (req, reply) => {
    const params = parseParams(UuidParams, req.params, reply);
    if (!params) return;

    const asset = await prisma.asset.findUnique({
      where: { id: params.id },
      select: { id: true, storageKey: true, sizeBytes: true, mimeType: true },
    });
    if (!asset) return reply.status(404).send({ error: 'Asset not found' });

    let message: string | undefined;
    let uploadBuffer: Buffer | null = null;
    let uploadMime = 'application/octet-stream';
    let uploadFilename = 'file';

    for await (const part of req.parts()) {
      if (part.type === 'field' && part.fieldname === 'message') {
        const parsed = MessageSchema.safeParse(part.value);
        if (parsed.success && parsed.data) message = parsed.data.trim() || undefined;
      } else if (part.type === 'file') {
        const filenameResult = FilenameSchema.safeParse(part.filename);
        if (!filenameResult.success) {
          part.file.resume();
          return reply.status(400).send({ error: 'Invalid filename' });
        }
        uploadFilename = filenameResult.data;
        const mimeResult = MimeSchema.safeParse(part.mimetype);
        uploadMime = mimeResult.success ? mimeResult.data : 'application/octet-stream';
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) chunks.push(chunk);
        uploadBuffer = Buffer.concat(chunks);
      }
    }

    if (!uploadBuffer) {
      return reply.status(400).send({ error: 'A file is required' });
    }

    const newStorageKey = `assets/${params.id}/versions/${Date.now()}_${uploadFilename}`;
    await uploadToS3(newStorageKey, uploadBuffer, uploadMime);

    const maxVersionRecord = await prisma.assetVersion.findFirst({
      where: { assetId: params.id },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });

    const newVersionNumber = (maxVersionRecord?.versionNumber ?? 1) + 1;

    let newVersion;
    try {
      newVersion = await prisma.$transaction(async (tx) => {
        // Snapshot the current asset as v1 if this is the first version upload
        if (!maxVersionRecord) {
          await tx.assetVersion.create({
            data: {
              assetId: params.id,
              versionNumber: 1,
              storageKey: asset.storageKey,
              sizeBytes: asset.sizeBytes,
              mimeType: asset.mimeType,
              uploadedBy: req.user.userId,
            },
          });
        }

        const version = await tx.assetVersion.create({
          data: {
            assetId: params.id,
            versionNumber: newVersionNumber,
            storageKey: newStorageKey,
            sizeBytes: BigInt(uploadBuffer!.length),
            mimeType: uploadMime,
            message: message ?? null,
            uploadedBy: req.user.userId,
          },
          select: {
            id: true,
            versionNumber: true,
            sizeBytes: true,
            mimeType: true,
            message: true,
            uploadedAt: true,
            uploader: { select: { id: true, email: true } },
          },
        });

        await tx.asset.update({
          where: { id: params.id },
          data: {
            storageKey: newStorageKey,
            sizeBytes: BigInt(uploadBuffer!.length),
            mimeType: uploadMime,
          },
        });

        return version;
      });
    } catch (err) {
      await deleteFromS3(newStorageKey).catch(() => {});
      throw err;
    }

    return reply.status(201).send({
      id: newVersion.id,
      version_number: newVersion.versionNumber,
      size_bytes: newVersion.sizeBytes !== null ? Number(newVersion.sizeBytes) : null,
      mime_type: newVersion.mimeType,
      message: newVersion.message,
      uploaded_at: newVersion.uploadedAt,
      uploader: newVersion.uploader ? { id: newVersion.uploader.id, email: newVersion.uploader.email } : null,
    });
  });

  // Download a specific version
  app.get<{ Params: { id: string; versionId: string } }>(
    '/api/files/:id/versions/:versionId/download',
    async (req, reply) => {
      const token = (req.query as Record<string, string>).token;
      if (!await authenticateToken(token, reply)) return;

      const params = parseParams(VersionParams, req.params, reply);
      if (!params) return;

      const version = await prisma.assetVersion.findFirst({
        where: { id: params.versionId, assetId: params.id },
        select: { storageKey: true, mimeType: true, versionNumber: true, asset: { select: { originalName: true } } },
      });
      if (!version) return reply.status(404).send({ error: 'Version not found' });

      const { stream, contentType, contentLength } = await getS3ObjectStream(version.storageKey);

      const filename = encodeURIComponent(`v${version.versionNumber}_${version.asset.originalName}`);

      reply.header('Content-Type', contentType ?? version.mimeType ?? 'application/octet-stream');
      reply.header(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${filename}`,
      );
      if (contentLength) reply.header('Content-Length', contentLength);

      return reply.send(stream);
    },
  );
}
