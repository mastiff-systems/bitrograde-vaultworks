import cron from 'node-cron';
import { prisma } from '../db/client.js';
import { getStorageProvider } from '../storage/index.js';
import { logAudit, AuditAction } from '../lib/audit.js';
import { collectUniqueKeys, deleteAssetObjects } from '../lib/assetTrash.js';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export async function purgeExpiredAssets(): Promise<void> {
  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);

  // versions included so the COMPLETE object set (main + thumbnail + every version
  // file) is captured while the AssetVersion rows still exist — the delete cascade
  // below destroys the rows that hold the version storage keys.
  const expired = await prisma.asset.findMany({
    where: { deletedAt: { lt: cutoff } },
    select: {
      id: true,
      storageKey: true,
      thumbnailKey: true,
      originalName: true,
      versions: { select: { storageKey: true } },
    },
  });

  const storage = await getStorageProvider();
  for (const asset of expired) {
    const uniqueKeys = collectUniqueKeys(asset);

    // Delete DB record first; if storage fails the record is gone — an orphaned object is
    // recoverable, a zombie DB record that never purges is not.
    await prisma.asset.delete({ where: { id: asset.id } });

    await deleteAssetObjects(storage, { uniqueKeys });

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

/**
 * MAS-715: purge folders trashed longer than the retention window. Top-level
 * first — a folder whose parent is also expired is skipped, because purging the
 * parent DB-cascades the whole subtree (descendant folders + folder_assets
 * memberships; assets themselves persist and are handled by purgeExpiredAssets).
 */
export async function purgeExpiredFolders(): Promise<void> {
  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);

  const expired = await prisma.folder.findMany({
    where: { deletedAt: { lt: cutoff } },
    select: { id: true, name: true, parentFolderId: true },
  });

  const expiredIds = new Set(expired.map((f) => f.id));
  const topLevel = expired.filter((f) => !f.parentFolderId || !expiredIds.has(f.parentFolderId));

  for (const folder of topLevel) {
    await prisma.folder.delete({ where: { id: folder.id } });

    // No FK reference: the folder row is already deleted, so identifiers go in details.
    void logAudit({
      action: AuditAction.DELETE,
      details: {
        source: 'auto-purge',
        purgedFolderId: folder.id,
        folderName: folder.name,
        cutoffDate: cutoff.toISOString(),
      },
    });
  }

  if (topLevel.length > 0) {
    console.log(`[trashPurge] purged ${topLevel.length} expired folder(s)`);
  }
}

export function startTrashPurgeJob(): void {
  // Runs at 02:00 AM daily
  cron.schedule('0 2 * * *', () => {
    purgeExpiredAssets().catch((err) => console.error('[trashPurge] error:', err));
    purgeExpiredFolders().catch((err) => console.error('[trashPurge] folder error:', err));
  });
}
