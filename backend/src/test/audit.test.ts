import { describe, it, expect, vi } from 'vitest'
import { logAudit } from '../lib/audit.js'

describe('logAudit', () => {
  it('fires and forgets without throwing when prisma succeeds', () => {
    const mockPrisma = {
      auditLog: {
        create: vi.fn().mockResolvedValue({}),
      },
    } as any

    expect(() =>
      logAudit({ prisma: mockPrisma, userId: 'user-1', assetId: 'asset-1', action: 'VIEW' }),
    ).not.toThrow()
  })

  it('never throws when prisma rejects', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mockPrisma = {
      auditLog: {
        create: vi.fn().mockRejectedValue(new Error('DB connection lost')),
      },
    } as any

    expect(() =>
      logAudit({ prisma: mockPrisma, userId: null, assetId: null, action: 'UPLOAD' }),
    ).not.toThrow()

    // Allow the rejected promise to propagate to the .catch() handler
    await new Promise((r) => setTimeout(r, 0))

    expect(consoleError).toHaveBeenCalledWith('[audit] write failed', expect.any(Error))
    consoleError.mockRestore()
  })

  it('passes correct data to prisma', () => {
    const createMock = vi.fn().mockResolvedValue({})
    const mockPrisma = { auditLog: { create: createMock } } as any

    logAudit({
      prisma:   mockPrisma,
      userId:   'uid-123',
      assetId:  'aid-456',
      action:   'DOWNLOAD',
      metadata: { ip: '1.2.3.4', userAgent: 'Mozilla/5.0' },
    })

    expect(createMock).toHaveBeenCalledWith({
      data: {
        userId:    'uid-123',
        assetId:   'aid-456',
        assetName: null,
        ipAddress: null,
        action:    'DOWNLOAD',
        details:   { ip: '1.2.3.4', userAgent: 'Mozilla/5.0' },
      },
    })
  })
})
