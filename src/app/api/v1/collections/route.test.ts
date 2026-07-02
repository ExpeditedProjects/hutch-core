import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { authenticateMock, listCollectionsMock } = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  listCollectionsMock: vi.fn(),
}))

vi.mock('@/lib/auth/seam', () => ({
  authenticate: authenticateMock,
}))

vi.mock('@/lib/services/collections', () => ({
  listCollections: listCollectionsMock,
  getCollection: vi.fn(),
  describeCollection: vi.fn(),
  createCollection: vi.fn(),
  updateCollection: vi.fn(),
  deleteCollection: vi.fn(),
  inferCollectionSchema: vi.fn(),
  updateFieldDefinition: vi.fn(),
}))

import { GET } from './route'

function req(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/v1/collections', { method: 'GET', headers })
}

beforeEach(() => {
  vi.clearAllMocks()
  listCollectionsMock.mockResolvedValue([{ id: 1, name: 'Users', slug: 'users' }])
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('GET /api/v1/collections — HUTCH_API_KEY set', () => {
  beforeEach(() => {
    vi.stubEnv('HUTCH_API_KEY', 'the-key')
  })

  it('returns 401 when the bearer token is missing', async () => {
    authenticateMock.mockResolvedValue(null)
    const res = await GET(req())
    expect(res.status).toBe(401)
  })

  it('returns 401 when the bearer token is wrong', async () => {
    authenticateMock.mockResolvedValue(null)
    const res = await GET(req({ authorization: 'Bearer nope' }))
    expect(res.status).toBe(401)
  })

  it('does not return 401 when the bearer token is correct', async () => {
    authenticateMock.mockResolvedValue({ userId: 'u1', orgId: 'o1' })
    const res = await GET(req({ authorization: 'Bearer the-key' }))
    expect(res.status).not.toBe(401)
  })

  it('forwards the singleton context ids to the service on success', async () => {
    authenticateMock.mockResolvedValue({ userId: 'u1', orgId: 'o1' })
    await GET(req({ authorization: 'Bearer the-key' }))
    expect(listCollectionsMock).toHaveBeenCalled()
    const args = listCollectionsMock.mock.calls[0]
    expect(args).toEqual(expect.arrayContaining(['u1']))
  })
})

describe('GET /api/v1/collections — HUTCH_API_KEY unset', () => {
  it('treats the request as the singleton user (not 401)', async () => {
    authenticateMock.mockResolvedValue({ userId: 'u1', orgId: 'o1' })
    const res = await GET(req())
    expect(res.status).not.toBe(401)
  })
})
