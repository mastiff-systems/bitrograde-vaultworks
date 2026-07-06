import type { PrismaClient } from '@prisma/client'
import { Prisma } from '@prisma/client'

export type AuditAction = 'UPLOAD' | 'DOWNLOAD' | 'VIEW' | 'UPDATE' | 'DELETE' | 'SHARE' | 'REVOKE_SHARE'

export interface AuditParams {
  prisma: PrismaClient
  userId: string | null
  assetId?: string | null
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
        userId:   params.userId,
        assetId:  params.assetId ?? null,
        action:   params.action,
        metadata: (params.metadata ?? {}) as Prisma.InputJsonValue,
      },
    })
    .catch((err) => {
      console.error('[audit] write failed', err)
    })
}
