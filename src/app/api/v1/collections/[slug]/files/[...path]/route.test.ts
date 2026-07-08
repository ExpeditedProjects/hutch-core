import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Failing spec (TDD) for the REST files route:
//   src/app/api/v1/collections/[slug]/files/[...path]/route.ts
//
// PUT    — raw body bytes; mime from Content-Type (default
//          application/octet-stream); 413 if > 4MB; upserts via putFile;
//          200 with metadata JSON.
// GET    — inline → body bytes with the file's Content-Type; blob → ALWAYS a
//          302 redirect to the presigned download_url that getFile resolved
//          via the storage seam (there is no byte-streaming path);
//          missing → 404.
// DELETE — soft-deletes; 200.
// Auth via the existing authenticate(req) seam; 401 when it returns null.
//
// Next 16 route handlers receive ctx.params as a Promise.
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE = 4_194_304

const {
  authenticateMock,
  putFileMock,
  getFileMock,
  deleteFileMock,
} = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  putFileMock: vi.fn(),
  getFileMock: vi.fn(),
  deleteFileMock: vi.fn(),
}))

vi.mock('@/lib/auth/seam', () => ({
  authenticate: authenticateMock,
}))

vi.mock('@/lib/services/files', () => ({
  putFile: putFileMock,
  getFile: getFileMock,
  listFiles: vi.fn(),
  deleteFile: deleteFileMock,
  cleanupCollectionBlobs: vi.fn(),
}))

import { GET, PUT, DELETE } from './route'

const presignedUrl =
  'https://s3.example.test/hutch-blobs/blobs/1/abc?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=sig'

const inlineFile = {
  path: 'CLAUDE.md',
  filename: 'CLAUDE.md',
  mime_type: 'text/markdown',
  size: 7,
  content_hash: 'ab'.repeat(32),
  content: '# hello',
}

const blobFile = {
  path: 'logo.png',
  filename: 'logo.png',
  mime_type: 'image/png',
  size: 4,
  content_hash: 'cd'.repeat(32),
  blob_key: 'blobs/1/abc',
  download_url: presignedUrl,
}

function ctx(slug = 'agent-files', path: string[] = ['CLAUDE.md']) {
  return { params: Promise.resolve({ slug, path }) }
}

function makeReq(method: string, opts: { body?: BodyInit; headers?: Record<string, string> } = {}): Request {
  return new Request('http://localhost/api/v1/collections/agent-files/files/CLAUDE.md', {
    method,
    body: opts.body,
    headers: opts.headers,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  authenticateMock.mockResolvedValue({ userId: 'u1', orgId: 'o1' })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('auth', () => {
  it('PUT returns 401 when authenticate returns null', async () => {
    authenticateMock.mockResolvedValue(null)
    const res = await PUT(makeReq('PUT', { body: new Uint8Array([1]) }), ctx())
    expect(res.status).toBe(401)
    expect(putFileMock).not.toHaveBeenCalled()
  })

  it('GET returns 401 when authenticate returns null', async () => {
    authenticateMock.mockResolvedValue(null)
    const res = await GET(makeReq('GET'), ctx())
    expect(res.status).toBe(401)
    expect(getFileMock).not.toHaveBeenCalled()
  })

  it('DELETE returns 401 when authenticate returns null', async () => {
    authenticateMock.mockResolvedValue(null)
    const res = await DELETE(makeReq('DELETE'), ctx())
    expect(res.status).toBe(401)
    expect(deleteFileMock).not.toHaveBeenCalled()
  })
})

describe('PUT', () => {
  it('upserts the raw body via putFile and returns 200 with metadata JSON', async () => {
    putFileMock.mockResolvedValue(inlineFile)
    const body = Buffer.from('# hello')

    const res = await PUT(
      makeReq('PUT', { body, headers: { 'content-type': 'text/markdown' } }),
      ctx('agent-files', ['CLAUDE.md'])
    )

    expect(res.status).toBe(200)
    expect(putFileMock).toHaveBeenCalledWith('u1', 'o1', expect.objectContaining({
      collection: 'agent-files',
      path: 'CLAUDE.md',
      mimeType: 'text/markdown',
    }))
    // Raw request bytes travel losslessly to the service (base64 channel).
    const params = putFileMock.mock.calls[0][2] as { contentBase64?: string }
    expect(params.contentBase64).toBeDefined()
    expect(Buffer.from(params.contentBase64!, 'base64').toString('utf8')).toBe('# hello')

    const json = await res.json()
    expect(json).toEqual(expect.objectContaining({
      path: 'CLAUDE.md',
      size: 7,
      mime_type: 'text/markdown',
      content_hash: inlineFile.content_hash,
    }))
    expect(json).not.toHaveProperty('content')
  })

  it('joins catch-all path segments with "/"', async () => {
    putFileMock.mockResolvedValue({ ...inlineFile, path: 'prompts/reviewer.md', filename: 'reviewer.md' })

    await PUT(
      makeReq('PUT', { body: Buffer.from('x'), headers: { 'content-type': 'text/markdown' } }),
      ctx('agent-files', ['prompts', 'reviewer.md'])
    )

    expect(putFileMock).toHaveBeenCalledWith('u1', 'o1', expect.objectContaining({
      path: 'prompts/reviewer.md',
    }))
  })

  it('defaults the mime type to application/octet-stream when Content-Type is absent', async () => {
    putFileMock.mockResolvedValue(inlineFile)

    await PUT(makeReq('PUT', { body: new Uint8Array([1, 2, 3]) }), ctx())

    expect(putFileMock).toHaveBeenCalledWith('u1', 'o1', expect.objectContaining({
      mimeType: 'application/octet-stream',
    }))
  })

  it('returns 413 for a body over 4MB without calling the service', async () => {
    const res = await PUT(
      makeReq('PUT', { body: new Uint8Array(MAX_FILE_SIZE + 1) }),
      ctx()
    )

    expect(res.status).toBe(413)
    expect(putFileMock).not.toHaveBeenCalled()
  })

  it('maps service errors to their status code', async () => {
    putFileMock.mockResolvedValue({ error: 'Invalid path', status: 400 })

    const res = await PUT(makeReq('PUT', { body: Buffer.from('x') }), ctx())
    expect(res.status).toBe(400)
  })
})

describe('GET', () => {
  it('returns inline content as the body with the file Content-Type', async () => {
    getFileMock.mockResolvedValue(inlineFile)

    const res = await GET(makeReq('GET'), ctx('agent-files', ['CLAUDE.md']))

    expect(getFileMock).toHaveBeenCalledWith('agent-files', 'u1', 'CLAUDE.md')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/markdown')
    expect(await res.text()).toBe('# hello')
  })

  it('always 302-redirects a blob file to its presigned download_url', async () => {
    getFileMock.mockResolvedValue(blobFile)

    const res = await GET(makeReq('GET'), ctx('agent-files', ['logo.png']))

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(presignedUrl)
  })

  it('maps a 501 storage-not-configured service error to a 501 response', async () => {
    getFileMock.mockResolvedValue({
      error: 'Blob storage is not configured. Set the HUTCH_S3_* environment variables.',
      status: 501,
    })

    const res = await GET(makeReq('GET'), ctx('agent-files', ['logo.png']))
    expect(res.status).toBe(501)
  })

  it('returns 404 when the file record is missing', async () => {
    getFileMock.mockResolvedValue({ error: 'File not found', status: 404 })

    const res = await GET(makeReq('GET'), ctx('agent-files', ['nope.md']))
    expect(res.status).toBe(404)
  })

  it('returns 404 when the collection is not accessible (service returns null)', async () => {
    getFileMock.mockResolvedValue(null)

    const res = await GET(makeReq('GET'), ctx('missing', ['x.md']))
    expect(res.status).toBe(404)
  })
})

describe('DELETE', () => {
  it('soft-deletes via deleteFile and returns 200', async () => {
    deleteFileMock.mockResolvedValue({ deleted: true, path: 'CLAUDE.md' })

    const res = await DELETE(makeReq('DELETE'), ctx('agent-files', ['CLAUDE.md']))

    expect(deleteFileMock).toHaveBeenCalledWith('agent-files', 'u1', 'CLAUDE.md')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(expect.objectContaining({ deleted: true }))
  })

  it('returns 404 when the file does not exist', async () => {
    deleteFileMock.mockResolvedValue({ error: 'File not found', status: 404 })

    const res = await DELETE(makeReq('DELETE'), ctx('agent-files', ['nope.md']))
    expect(res.status).toBe(404)
  })

  it('returns 404 when the collection is not accessible (service returns null)', async () => {
    deleteFileMock.mockResolvedValue(null)

    const res = await DELETE(makeReq('DELETE'), ctx('missing', ['x.md']))
    expect(res.status).toBe(404)
  })
})
