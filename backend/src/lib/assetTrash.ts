import type { FastifyBaseLogger } from 'fastify';
import { prisma } from '../db/client.js';
import { StorageNotFoundError } from '../storage/provider.js';
import type { StorageProvider } from '../storage/provider.js';

/**
 * Shared trash/restore/purge machinery (MAS-688/MAS-690).
 *
 * An asset's bytes are not a single object: besides Asset.storageKey and
 * Asset.thumbnailKey, every AssetVersion row holds a storageKey. Two invariants
 * from the version-upload flow (versions.ts) shape everything here:
 *
 *  - The latest AssetVersion.storageKey and Asset.storageKey point at the SAME
 *    physical object, so physical moves/deletes must be deduped while the DB
 *    rewrite still fans out to every row that referenced the moved key.
 *  - The v1 snapshot row keeps the original base key (assets/{id}/{originalName}),
 *    which stops being Asset.storageKey after the first version upload — it must
 *    be enumerated from AssetVersion rows or it is orphaned on delete/purge.
 */

export interface AssetObjectSet {
  assetId: string;
  originalName: string;
  storageKey: string;
  thumbnailKey: string | null;
  uploadedBy: string | null;
  versions: { id: string; storageKey: string }[];
  /** Dedupe of storageKey ∪ thumbnailKey ∪ versions[].storageKey — one entry per physical object. */
  uniqueKeys: string[];
}

/** Dedupes the complete physical-object key set; main key first so it is moved first (fail-hard before best-effort). */
export function collectUniqueKeys(asset: {
  storageKey: string;
  thumbnailKey: string | null;
  versions: { storageKey: string }[];
}): string[] {
  const keys = new Set<string>([asset.storageKey]);
  if (asset.thumbnailKey) keys.add(asset.thumbnailKey);
  for (const v of asset.versions) keys.add(v.storageKey);
  return [...keys];
}

/**
 * Loads the complete object set for an asset in one query.
 * opts.deleted selects live (delete path) vs trashed (restore/purge path).
 * Returns null when no matching asset exists — caller 404s.
 */
export async function loadAssetObjectSet(
  assetId: string,
  opts: { deleted: boolean },
): Promise<AssetObjectSet | null> {
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, deletedAt: opts.deleted ? { not: null } : null },
    select: {
      originalName: true,
      storageKey: true,
      thumbnailKey: true,
      uploadedBy: true,
      versions: { select: { id: true, storageKey: true } },
    },
  });
  if (!asset) return null;

  return {
    assetId,
    originalName: asset.originalName,
    storageKey: asset.storageKey,
    thumbnailKey: asset.thumbnailKey,
    uploadedBy: asset.uploadedBy,
    versions: asset.versions,
    uniqueKeys: collectUniqueKeys(asset),
  };
}

/** Conforming live key → trash key (prefix swap, subpath preserved); null when non-conforming. */
export function toTrashKey(assetId: string, key: string): string | null {
  const livePrefix = `assets/${assetId}/`;
  return key.startsWith(livePrefix) ? `trash/${assetId}/${key.slice(livePrefix.length)}` : null;
}

/** Conforming trash key → live key (prefix swap, subpath preserved); null when non-conforming. */
export function toLiveKey(assetId: string, key: string): string | null {
  const trashPrefix = `trash/${assetId}/`;
  return key.startsWith(trashPrefix) ? `assets/${assetId}/${key.slice(trashPrefix.length)}` : null;
}

/**
 * Moves every unique physical object once and returns an oldKey→newKey rewrite map.
 *
 * Error semantics (matching the pre-existing single/bulk delete behavior):
 *  - Main object (set.storageKey): any non-NotFound error THROWS — nothing has been
 *    committed to the DB yet, so the caller aborts and the asset stays consistent.
 *  - Thumbnail and version objects: best-effort — log and continue; no rewrite entry,
 *    so the DB keeps the old (still correct) key.
 *  - StorageNotFoundError on any key: warn and still add the rewrite entry — the DB is
 *    the source of truth and refusing to trash/restore a ghost would strand the asset.
 *  - old === new (legacy already-at-target keys): skip the physical move, keep the row.
 *  - Non-conforming version keys (neither prefix matches): leave object and row in
 *    place — the row stays self-consistent for later restore/purge by exact key.
 */
export async function moveAssetObjects(
  storage: StorageProvider,
  log: FastifyBaseLogger,
  set: AssetObjectSet,
  direction: 'trash' | 'restore',
): Promise<Map<string, string>> {
  const mapKey = direction === 'trash' ? toTrashKey : toLiveKey;
  const fallbackPrefix = direction === 'trash' ? 'trash' : 'assets';
  const rewrites = new Map<string, string>();

  for (const key of set.uniqueKeys) {
    const isMain = key === set.storageKey;
    let target = mapKey(set.assetId, key);
    if (target === null) {
      if (isMain) {
        target = `${fallbackPrefix}/${set.assetId}/${set.originalName}`;
      } else if (key === set.thumbnailKey) {
        target = `${fallbackPrefix}/${set.assetId}/thumbnail.webp`;
      } else {
        log.warn({ assetId: set.assetId, storageKey: key, direction }, 'assetTrash: non-conforming version key left in place');
        continue;
      }
    }

    if (target === key) {
      rewrites.set(key, target);
      continue;
    }

    try {
      await storage.move(key, target);
      rewrites.set(key, target);
    } catch (err) {
      if (err instanceof StorageNotFoundError) {
        log.warn({ assetId: set.assetId, storageKey: key, direction }, 'assetTrash: storage object already missing — updating DB record only');
        rewrites.set(key, target);
      } else if (isMain) {
        throw err;
      } else {
        log.warn({ assetId: set.assetId, storageKey: key, direction, err }, 'assetTrash: failed to move secondary object — keeping old key');
      }
    }
  }

  return rewrites;
}

/** Rewrite lookup with identity fallback: keys without a successful move keep their old value. */
export function applyRewrite(map: Map<string, string>, key: string | null): string | null {
  return key === null ? null : map.get(key) ?? key;
}

/**
 * Hard-deletes every unique physical object. Both providers treat deleting a
 * non-existent key as success (S3 DeleteObject is idempotent; disk tolerates ENOENT),
 * so this is safe to run after the DB cascade has already destroyed the rows.
 */
export async function deleteAssetObjects(
  storage: StorageProvider,
  set: Pick<AssetObjectSet, 'uniqueKeys'>,
): Promise<void> {
  for (const key of set.uniqueKeys) {
    await storage.delete(key);
  }
}
