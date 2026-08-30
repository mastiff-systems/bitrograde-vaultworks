import cron from 'node-cron';
import { prisma } from '../db/client.js';
import { getStorageProvider } from '../storage/index.js';
import { logAudit, AuditAction } from '../lib/audit.js';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

async function purgeExpiredAssets(): Promise<void> {
  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);

  const expired = await prisma.asset.findMany({
    where: { deletedAt: { lt: cutoff } },
    select: { id: true, storageKey: true, thumbnailKey: true, originalName: true },
  });

  const storage = await getStorageProvider();
  for (const asset of expired) {
    // Delete DB record first; if storage fails the record is gone — an orphaned object is
    // recoverable, a zombie DB record that never purges is not.
    await prisma.asset.delete({ where: { id: asset.id } });

    await storage.delete(asset.storageKey);
    if (asset.thumbnailKey) {
      await storage.delete(asset.thumbnailKey);
    }

    // assetId must go in details: the asset row is already deleted, so a real
    // assetId FK reference would make the audit insert fail.
    void logAudit({
      action: AuditAction.DELETE,
      assetName: asset.originalName,
      details: { source: 'auto-purge', purgedAssetId: asset.id, cutoffDate: cutoff.toISOString() },
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
