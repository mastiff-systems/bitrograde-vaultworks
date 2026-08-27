import { describe, it, expect, vi, beforeEach } from 'vitest'

const { createMock, findUniqueMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  findUniqueMock: vi.fn(),
}))

vi.mock('../db/client.js', () => ({
  prisma: {
    auditLog: { create: createMock },
    user: { findUnique: findUniqueMock },
  },
}))

import { logAudit } from '../lib/audit.js'
import { AuditAction } from '@prisma/client'

beforeEach(() => {
  vi.clearAllMocks()
  createMock.mockResolvedValue({})
  findUniqueMock.mockResolvedValue({ firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' })
})

describe('logAudit', () => {
  it('resolves without throwing when prisma succeeds', async () => {
    await expect(
      logAudit({ userId: 'user-1', assetId: 'asset-1', action: AuditAction.VIEW }),
    ).resolves.toBeUndefined()
    expect(createMock).toHaveBeenCalledTimes(1)
  })

  it('never rejects when prisma rejects — fire-and-forget must be safe', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    createMock.mockRejectedValueOnce(new Error('DB connection lost'))

    await expect(
      logAudit({ action: AuditAction.UPLOAD }),
    ).resolves.toBeUndefined()

    expect(consoleError).toHaveBeenCalledWith(
      '[audit] failed to write audit log entry:',
      expect.any(Error),
    )
    consoleError.mockRestore()
  })

  it('passes correct data to prisma, denormalizing userName', async () => {
    await logAudit({
      userId:    'uid-123',
      assetId:   'aid-456',
      assetName: 'photo.png',
      action:    AuditAction.DOWNLOAD,
      ipAddress: '1.2.3.4',
      details:   { userAgent: 'Mozilla/5.0' },
    })

    expect(createMock).toHaveBeenCalledWith({
      data: {
        userId:    'uid-123',
        assetId:   'aid-456',
        assetName: 'photo.png',
        userName:  'Ada Lovelace',
        ipAddress: '1.2.3.4',
        action:    AuditAction.DOWNLOAD,
        details:   { userAgent: 'Mozilla/5.0' },
      },
    })
  })
})
