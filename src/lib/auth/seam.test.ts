import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { getSingletonContextMock } = vi.hoisted(() => ({
  getSingletonContextMock: vi.fn(),
}))

vi.mock('./singleton', () => ({
  getSingletonContext: getSingletonContextMock,
}))

import { authenticate } from './seam'
import type { AuthContext } from './seam'

const ctx: AuthContext = { userId: 'user-singleton', orgId: 'org-singleton' }

beforeEach(() => {
  getSingletonContextMock.mockReset().mockResolvedValue(ctx)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

function req(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/mcp', { method: 'POST', headers })
}

describe('authenticate — HUTCH_API_KEY set', () => {
  beforeEach(() => {
    vi.stubEnv('HUTCH_API_KEY', 'secret-key-value')
  })

  it('returns the singleton context when the bearer token matches', async () => {
    const result = await authenticate(req({ authorization: 'Bearer secret-key-value' }))
    expect(result).toEqual(ctx)
    expect(getSingletonContextMock).toHaveBeenCalledTimes(1)
  })

  it('accepts case-insensitive Authorization header name', async () => {
    const result = await authenticate(req({ Authorization: 'Bearer secret-key-value' }))
    expect(result).toEqual(ctx)
  })

  it('returns null when the Authorization header is missing', async () => {
    const result = await authenticate(req())
    expect(result).toBeNull()
    expect(getSingletonContextMock).not.toHaveBeenCalled()
  })

  it('returns null when the Authorization header is not a Bearer scheme', async () => {
    const result = await authenticate(req({ authorization: 'Basic secret-key-value' }))
    expect(result).toBeNull()
  })

  it('returns null when the Bearer value is empty', async () => {
    const result = await authenticate(req({ authorization: 'Bearer ' }))
    expect(result).toBeNull()
  })

  it('returns null when the bearer token is wrong but same length', async () => {
    const result = await authenticate(req({ authorization: 'Bearer wrong-key-value--' }))
    expect(result).toBeNull()
  })

  it('returns null (does not throw) when the bearer token has a different length', async () => {
    const result = await authenticate(req({ authorization: 'Bearer x' }))
    expect(result).toBeNull()
  })

  it('returns null when the bearer token is much longer than the expected key', async () => {
    const result = await authenticate(req({ authorization: 'Bearer ' + 'z'.repeat(500) }))
    expect(result).toBeNull()
  })
})

describe('authenticate — HUTCH_API_KEY unset or empty (anonymous local mode)', () => {
  it('resolves the singleton context for a request with no Authorization header', async () => {
    vi.stubEnv('HUTCH_API_KEY', '')
    const result = await authenticate(req())
    expect(result).toEqual(ctx)
    expect(getSingletonContextMock).toHaveBeenCalledTimes(1)
  })

  it('resolves the singleton context even when a bogus Authorization header is present', async () => {
    vi.stubEnv('HUTCH_API_KEY', '')
    const result = await authenticate(req({ authorization: 'Bearer anything-goes' }))
    expect(result).toEqual(ctx)
  })

  it('treats a fully-unset HUTCH_API_KEY the same as empty', async () => {
    const original = process.env.HUTCH_API_KEY
    delete process.env.HUTCH_API_KEY
    try {
      const result = await authenticate(req())
      expect(result).toEqual(ctx)
    } finally {
      if (original !== undefined) process.env.HUTCH_API_KEY = original
    }
  })
})
