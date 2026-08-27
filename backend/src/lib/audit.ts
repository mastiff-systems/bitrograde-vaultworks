import { AuditAction } from '@prisma/client';
import { prisma } from '../db/client.js';

export { AuditAction };

interface AuditEntry {
  userId?: string;
  action: AuditAction;
  assetId?: string;
  assetName?: string;
  ipAddress?: string;
  details?: Record<string, unknown>;
}

/** Resolves the display name for a user: "First Last", "First", or email fallback. */
async function resolveUserName(userId: string): Promise<string | undefined> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true, email: true },
  });
  if (!user) return undefined;
  const parts = [user.firstName, user.lastName].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : user.email;
}

/** Write an audit log entry, denormalizing userName at write time. Fire-and-forget safe. */
export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    const userName = entry.userId ? await resolveUserName(entry.userId) : undefined;
    await prisma.auditLog.create({
      data: {
        userId: entry.userId,
        action: entry.action,
        assetId: entry.assetId,
        assetName: entry.assetName,
        userName,
        ipAddress: entry.ipAddress,
        details: (entry.details ?? {}) as object,
      },
    });
  } catch (err) {
    // Callers use `void logAudit(...)` — a throw here would surface as an
    // unhandled rejection, so an audit failure must never propagate.
    console.error('[audit] failed to write audit log entry:', err);
  }
}
