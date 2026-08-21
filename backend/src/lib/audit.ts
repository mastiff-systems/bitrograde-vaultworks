import type { PrismaClient } from '@prisma/client'
import { Prisma } from '@prisma/client'

export type AuditAction = 'UPLOAD' | 'DOWNLOAD' | 'VIEW' | 'UPDATE' | 'UPDATE_METADATA' | 'DELETE' | 'SHARE' | 'REVOKE_SHARE' | 'USER_CREATED'

export interface AuditParams {
  prisma: PrismaClient
  userId: string | null
  assetId?: string | null
  assetName?: string | null
  ipAddress?: string | null
  action: AuditAction
  metadata?: Record<string, unknown>
}

/**
 * Fire-and-forget audit write. Never throws into the caller.
 * Failures are logged to console.error only.
 */
export function logAudit(params: AuditParams): void {
  params.prisma.auditLog
    .create({
      data: {
        userId:    params.userId,
        assetId:   params.assetId ?? null,
        assetName: params.assetName ?? null,
        ipAddress: params.ipAddress ?? null,
        action:    params.action,
        details:   (params.metadata ?? {}) as Prisma.InputJsonValue,
      },
    })
    .catch((err) => {
      console.error('[audit] write failed', err)
    })
}
