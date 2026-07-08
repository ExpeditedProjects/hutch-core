import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// ---------------------------------------------------------------------------
// Integration spec for src/lib/storage/seam.ts against a REAL S3-compatible
// endpoint (MinIO). No mocks — real SigV4 requests over the wire.
//
// Auto-skipped when HUTCH_S3_ENDPOINT is not set, so plain `npm test` stays
// green without any infrastructure.
//
// To run locally:
//
//   1. Start MinIO (creates the hutch-test bucket automatically):
//        docker compose -f docker-compose.minio.yml up -d --wait
//
//   2. Run the suite with the storage env pointed at it:
//        HUTCH_S3_ENDPOINT=http://127.0.0.1:9010 \
//        HUTCH_S3_BUCKET=hutch-test \
//        HUTCH_S3_ACCESS_KEY_ID=hutch-test \
//        HUTCH_S3_SECRET_ACCESS_KEY=hutch-test-secret \
//        HUTCH_S3_REGION=auto \
//        npm test -- src/lib/storage/seam.integration.test.ts
//
//   (The implementation phase will add a `test:integration` npm script that
//   wraps the above; package.json is upstream-shared so it is not touched
//   here.)
//
//   3. Tear down:  docker compose -f docker-compose.minio.yml down -v
// ---------------------------------------------------------------------------

const configured = Boolean(process.env.HUTCH_S3_ENDPOINT)

describe.skipIf(!configured)('storage seam — MinIO round trip', () => {
  // Unique key per run so repeated runs never collide with leftovers.
  const key = `integration-test/${Date.now()}-${Math.random().toString(36).slice(2)}/logo.png`
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff])
  const contentType = 'image/png'

  let storage: {
    put: (key: string, bytes: Uint8Array, contentType: string) => Promise<void>
    delete: (keys: string[]) => Promise<void>
    getDownloadUrl: (key: string) => Promise<string>
  }

  beforeAll(async () => {
    // Specifier goes through a variable (+ @vite-ignore) so Vite defers
    // resolution to runtime: pre-implementation, plain `npm test` must report
    // this file as skipped — not as a transform-time unresolved import.
    const seamModulePath = './seam'
    const { getStorage } = await import(/* @vite-ignore */ seamModulePath)
    storage = getStorage()
  })

  afterAll(async () => {
    // Best-effort cleanup in case an assertion failed before the delete step.
    try {
      await storage.delete([key])
    } catch {
      // already deleted by the test — fine
    }
  })

  it('put → presigned GET returns the exact bytes and content type', async () => {
    await storage.put(key, bytes, contentType)

    const url = await storage.getDownloadUrl(key)
    const res = await fetch(url)

    expect(res.ok).toBe(true)
    expect(res.headers.get('content-type')).toContain(contentType)
    const received = new Uint8Array(await res.arrayBuffer())
    expect(Buffer.from(received).equals(Buffer.from(bytes))).toBe(true)
  })

  it('the presigned URL requires no additional auth headers', async () => {
    const url = await storage.getDownloadUrl(key)
    // Plain unauthenticated fetch — the SigV4 query params ARE the auth.
    const res = await fetch(url, { headers: {} })
    expect(res.ok).toBe(true)
  })

  it('delete removes the object; the presigned GET no longer succeeds', async () => {
    await storage.delete([key])

    const url = await storage.getDownloadUrl(key)
    const res = await fetch(url)
    expect(res.ok).toBe(false) // MinIO answers 404 NoSuchKey
  })
})
