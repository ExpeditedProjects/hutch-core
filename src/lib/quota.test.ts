import { describe, it, expect } from 'vitest'
import { beforeCreateRecord, beforeStoreFile, releaseStorage } from './quota'

// Failing spec (TDD): the OSS quota seam gains two no-op file hooks. The Cloud
// overlay replaces this module with real enforcement; Core only guarantees the
// seam exists and resolves.

describe('quota seam', () => {
  it('keeps the existing beforeCreateRecord no-op', async () => {
    await expect(
      beforeCreateRecord({
        userId: 'u1',
        organizationId: 'o1',
        collectionName: 'files',
        count: 1,
        bytes: 10,
      })
    ).resolves.toBeUndefined()
  })

  it('exports beforeStoreFile({userId, organizationId, bytes}) as a resolving no-op', async () => {
    expect(typeof beforeStoreFile).toBe('function')
    await expect(
      beforeStoreFile({ userId: 'u1', organizationId: 'o1', bytes: 1024 })
    ).resolves.toBeUndefined()
  })

  it('exports releaseStorage({organizationId, bytes}) as a resolving no-op', async () => {
    expect(typeof releaseStorage).toBe('function')
    await expect(
      releaseStorage({ organizationId: 'o1', bytes: 1024 })
    ).resolves.toBeUndefined()
  })
})
