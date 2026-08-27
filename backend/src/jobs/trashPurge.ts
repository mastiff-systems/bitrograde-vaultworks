import cron from 'node-cron';
import { prisma } from '../db/client.js';
import { deleteFromS3 } from '../storage/s3.js';
import { logAudit, AuditAction } from '../lib/audit.js';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

async function purgeExpiredAssets(): Promise<void> {
  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);

  const expired = await prisma.asset.findMany({
    where: { deletedAt: { lt: cutoff } },
    select: { id: true, storageKey: true, thumbnailKey: true, originalName: true },
  });

  for (const asset of expired) {
    // Delete DB record first; if S3 fails the record is gone — orphaned S3 is recoverable,
    // a zombie DB record that never purges is not.
    await prisma.asset.delete({ where: { id: asset.id } });

    await deleteFromS3(asset.storageKey);
    if (asset.thumbnailKey) {
      await deleteFromS3(asset.thumbnailKey);
    }

    void logAudit({
      action: AuditAction.DELETE,
      assetId: asset.id,
      assetName: asset.originalName,
      details: { source: 'auto-purge', cutoffDate: cutoff.toISOString() },
    });
  }

  if (expired.length > 0) {
    console.log(`[trashPurge] purged ${expired.length} expired asset(s)`);
  }
}

export function startTrashPurgeJob(): void {
  // Runs at 02:00 AM daily
  cron.schedule('0 2 * * *', () => {
    purgeExpiredAssets().catch((err) => console.error('[trashPurge] error:', err));
  });
}
