import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Failing spec (TDD) for the storage seam:
//   src/lib/storage/seam.ts — the ONLY place blob storage lives (mirrors the
//   src/lib/auth/seam.ts pattern).
//
// getStorage(): Storage
//   put(key: string, bytes: Uint8Array, contentType: string): Promise<void>
//   delete(keys: string[]): Promise<void>
//   getDownloadUrl(key: string): Promise<string>   // time-limited presigned GET
//
// Implementation signs requests with aws4fetch (SigV4) against any
// S3-compatible endpoint, configured ONLY by env:
//   HUTCH_S3_ENDPOINT, HUTCH_S3_BUCKET,
//   HUTCH_S3_ACCESS_KEY_ID, HUTCH_S3_SECRET_ACCESS_KEY,
//   HUTCH_S3_REGION (optional)
//
// When the env vars are absent, every storage op rejects with a clear
// "storage not configured" error — callers (files service) surface it.
//
// These tests stub global fetch and assert the real signed requests, so they
// stay valid regardless of how the seam wires aws4fetch internally.
// ---------------------------------------------------------------------------

const ENDPOINT = 'https://s3.example.test'
const BUCKET = 'hutch-blobs'
const ACCESS_KEY_ID = 'HUTCHACCESSKEYID0000'
const SECRET_ACCESS_KEY = 'hutch-secret-access-key'

const fetchMock = vi.fn()

// aws4fetch may call fetch(Request) or fetch(url, init); normalize to Request.
function requestAt(callIndex: number): Request {
  const call = fetchMock.mock.calls[callIndex]
  expect(call, `expected fetch call #${callIndex}`).toBeDefined()
  return new Request(call[0] as RequestInfo, call[1] as RequestInit | undefined)
}

function stubConfiguredEnv() {
  vi.stubEnv('HUTCH_S3_ENDPOINT', ENDPOINT)
  vi.stubEnv('HUTCH_S3_BUCKET', BUCKET)
  vi.stubEnv('HUTCH_S3_ACCESS_KEY_ID', ACCESS_KEY_ID)
  vi.stubEnv('HUTCH_S3_SECRET_ACCESS_KEY', SECRET_ACCESS_KEY)
}

function stubUnconfiguredEnv() {
  vi.stubEnv('HUTCH_S3_ENDPOINT', '')
  vi.stubEnv('HUTCH_S3_BUCKET', '')
  vi.stubEnv('HUTCH_S3_ACCESS_KEY_ID', '')
  vi.stubEnv('HUTCH_S3_SECRET_ACCESS_KEY', '')
}

// Fresh module per test so the seam re-reads env regardless of whether it
// caches config at module scope or at call time.
async function loadSeam() {
  vi.resetModules()
  return await import('./seam')
}

// Wraps getStorage() + the op so the test passes whether the seam rejects the
// op or getStorage() throws synchronously when unconfigured.
async function withStorage<T>(fn: (storage: {
  put: (key: string, bytes: Uint8Array, contentType: string) => Promise<void>
  delete: (keys: string[]) => Promise<void>
  getDownloadUrl: (key: string) => Promise<string>
}) => Promise<T>): Promise<T> {
  const { getStorage } = await loadSeam()
  return await fn(getStorage())
}

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('put — signed PUT to {endpoint}/{bucket}/{key}', () => {
  beforeEach(stubConfiguredEnv)

  it('issues a SigV4-signed PUT carrying the bytes and content type', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

    await withStorage((s) => s.put('blobs/1/abc123', bytes, 'image/png'))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const req = requestAt(0)
    expect(req.method).toBe('PUT')
    expect(req.url).toBe(`${ENDPOINT}/${BUCKET}/blobs/1/abc123`)
    expect(req.headers.get('content-type')).toBe('image/png')

    const auth = req.headers.get('authorization')
    expect(auth).toMatch(/AWS4-HMAC-SHA256/)
    expect(auth).toContain(ACCESS_KEY_ID)

    const body = new Uint8Array(await req.arrayBuffer())
    expect(Buffer.from(body).equals(Buffer.from(bytes))).toBe(true)
  })

  it('rejects when the endpoint responds with a non-2xx status', async () => {
    fetchMock.mockResolvedValue(new Response('AccessDenied', { status: 403 }))
    await expect(
      withStorage((s) => s.put('blobs/1/denied', new Uint8Array([1]), 'application/octet-stream'))
    ).rejects.toThrow()
  })
})

describe('delete — signed DELETE per key', () => {
  beforeEach(stubConfiguredEnv)

  it('issues one signed DELETE for each key', async () => {
    await withStorage((s) => s.delete(['blobs/1/one', 'blobs/1/two']))

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const urls = fetchMock.mock.calls.map((_, i) => requestAt(i)).map((r) => ({
      method: r.method,
      url: r.url,
    }))
    expect(urls).toEqual(expect.arrayContaining([
      { method: 'DELETE', url: `${ENDPOINT}/${BUCKET}/blobs/1/one` },
      { method: 'DELETE', url: `${ENDPOINT}/${BUCKET}/blobs/1/two` },
    ]))
    for (let i = 0; i < 2; i++) {
      expect(requestAt(i).headers.get('authorization')).toMatch(/AWS4-HMAC-SHA256/)
    }
  })

  it('resolves without fetching when the key list is empty', async () => {
    await expect(withStorage((s) => s.delete([]))).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('getDownloadUrl — presigned GET URL', () => {
  beforeEach(stubConfiguredEnv)

  it('resolves to a time-limited presigned URL for the key (no network call)', async () => {
    const url = await withStorage((s) => s.getDownloadUrl('blobs/1/abc123'))

    expect(url.startsWith(`${ENDPOINT}/${BUCKET}/blobs/1/abc123`)).toBe(true)

    const params = new URL(url).searchParams
    expect(params.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')
    expect(params.get('X-Amz-Signature')).toBeTruthy()
    expect(params.get('X-Amz-Credential')).toContain(ACCESS_KEY_ID)
    expect(params.get('X-Amz-Expires')).toBeTruthy() // time-limited

    // Presigning is local crypto — no request leaves the process.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never leaks the secret access key into the URL', async () => {
    const url = await withStorage((s) => s.getDownloadUrl('blobs/1/abc123'))
    expect(url).not.toContain(SECRET_ACCESS_KEY)
  })
})

describe('storage not configured — HUTCH_S3_* env absent', () => {
  beforeEach(stubUnconfiguredEnv)

  it('put rejects with a clear "storage not configured" error and never fetches', async () => {
    await expect(
      withStorage((s) => s.put('blobs/1/x', new Uint8Array([1]), 'application/octet-stream'))
    ).rejects.toThrow(/not configured/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('delete rejects with a clear "storage not configured" error', async () => {
    await expect(
      withStorage((s) => s.delete(['blobs/1/x']))
    ).rejects.toThrow(/not configured/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('getDownloadUrl rejects with a clear "storage not configured" error', async () => {
    await expect(
      withStorage((s) => s.getDownloadUrl('blobs/1/x'))
    ).rejects.toThrow(/not configured/i)
  })
})

describe('key validation — keys never escape the bucket', () => {
  beforeEach(stubConfiguredEnv)

  const badKeys: [string, string][] = [
    ['empty key', ''],
    ['absolute key', '/etc/passwd'],
    ['leading .. segment', '../escape.bin'],
    ['embedded .. segment', 'blobs/../../escape.bin'],
    ['bare ..', '..'],
  ]

  for (const [label, key] of badKeys) {
    it(`put rejects ${label} without fetching`, async () => {
      await expect(
        withStorage((s) => s.put(key, new Uint8Array([1]), 'application/octet-stream'))
      ).rejects.toThrow()
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it(`delete rejects ${label} without fetching`, async () => {
      await expect(withStorage((s) => s.delete([key]))).rejects.toThrow()
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it(`getDownloadUrl rejects ${label}`, async () => {
      await expect(withStorage((s) => s.getDownloadUrl(key))).rejects.toThrow()
    })
  }
})
