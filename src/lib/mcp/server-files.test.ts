import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Failing spec (TDD) for the MCP file tools on src/lib/mcp/server.ts:
//   hutch_put_file   {collection, path, content?, content_base64?, mime_type?}
//   hutch_get_file   {collection, path}
//   hutch_list_files {collection}
// Mirrors the server.test.ts pattern, additionally capturing tool configs so
// annotations (readOnlyHint / idempotentHint) can be asserted.
// ---------------------------------------------------------------------------

const { registeredTools, toolConfigs } = vi.hoisted(() => ({
  registeredTools: new Map<string, (params: unknown) => Promise<unknown>>(),
  toolConfigs: new Map<string, { annotations?: Record<string, unknown> }>(),
}))

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
  class McpServer {
    registerTool(
      name: string,
      config: { annotations?: Record<string, unknown> },
      handler: (params: unknown) => Promise<unknown>
    ) {
      registeredTools.set(name, handler)
      toolConfigs.set(name, config)
    }
  }
  return { McpServer }
})

vi.mock('@/lib/services/collections', () => ({
  listCollections: vi.fn(),
  getCollection: vi.fn(),
  describeCollection: vi.fn(),
  createCollection: vi.fn(),
  updateCollection: vi.fn(),
  deleteCollection: vi.fn(),
  inferCollectionSchema: vi.fn(),
  updateFieldDefinition: vi.fn(),
}))

vi.mock('@/lib/services/records', () => ({
  createRecords: vi.fn(),
  queryRecords: vi.fn(),
  truncateRecords: vi.fn(),
  updateRecord: vi.fn(),
  transformRecords: vi.fn(),
  updateRecordStatus: vi.fn(),
  deleteRecord: vi.fn(),
  searchGlobal: vi.fn(),
}))

vi.mock('@/lib/services/views', () => ({
  createView: vi.fn(),
}))

vi.mock('@/lib/services/files', () => ({
  putFile: vi.fn(),
  getFile: vi.fn(),
  listFiles: vi.fn(),
  deleteFile: vi.fn(),
  cleanupCollectionBlobs: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([]) })) })) })),
  },
}))

import { createMcpServer } from './server'
import * as fileService from '@/lib/services/files'

const metadata = {
  path: 'CLAUDE.md',
  filename: 'CLAUDE.md',
  mime_type: 'text/markdown',
  size: 11,
  content_hash: 'ab'.repeat(32),
}

beforeEach(() => {
  vi.clearAllMocks()
  registeredTools.clear()
  toolConfigs.clear()
})

async function callTool(name: string, args: unknown): Promise<{ content: { text: string }[]; isError?: boolean }> {
  const handler = registeredTools.get(name)
  if (!handler) throw new Error(`tool ${name} not registered`)
  return await handler(args) as { content: { text: string }[]; isError?: boolean }
}

describe('file tool registration', () => {
  it('registers hutch_put_file, hutch_get_file, and hutch_list_files', () => {
    createMcpServer('user-1', 'org-test', 'https://example.test')
    for (const name of ['hutch_put_file', 'hutch_get_file', 'hutch_list_files']) {
      expect(registeredTools.has(name), `expected tool ${name} to be registered`).toBe(true)
    }
  })

  it('marks hutch_put_file idempotent (same path + content converges)', () => {
    createMcpServer('user-1', 'org-test', 'https://example.test')
    expect(toolConfigs.get('hutch_put_file')?.annotations).toEqual(
      expect.objectContaining({ idempotentHint: true })
    )
  })

  it('marks hutch_get_file and hutch_list_files read-only', () => {
    createMcpServer('user-1', 'org-test', 'https://example.test')
    expect(toolConfigs.get('hutch_get_file')?.annotations).toEqual(
      expect.objectContaining({ readOnlyHint: true })
    )
    expect(toolConfigs.get('hutch_list_files')?.annotations).toEqual(
      expect.objectContaining({ readOnlyHint: true })
    )
  })
})

describe('hutch_put_file', () => {
  it('forwards collection, path, content, and mime_type to fileService.putFile', async () => {
    createMcpServer('user-1', 'org-test', 'https://example.test')
    vi.mocked(fileService.putFile).mockResolvedValue(metadata as never)

    await callTool('hutch_put_file', {
      collection: 'agent-files',
      path: 'CLAUDE.md',
      content: '# hello',
      mime_type: 'text/markdown',
    })

    expect(fileService.putFile).toHaveBeenCalledWith('user-1', 'org-test', expect.objectContaining({
      collection: 'agent-files',
      path: 'CLAUDE.md',
      content: '# hello',
      mimeType: 'text/markdown',
    }))
  })

  it('maps content_base64 to the service contentBase64 param', async () => {
    createMcpServer('user-1', 'org-test', 'https://example.test')
    vi.mocked(fileService.putFile).mockResolvedValue(metadata as never)
    const b64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')

    await callTool('hutch_put_file', {
      collection: 'agent-files',
      path: 'logo.png',
      content_base64: b64,
      mime_type: 'image/png',
    })

    expect(fileService.putFile).toHaveBeenCalledWith('user-1', 'org-test', expect.objectContaining({
      contentBase64: b64,
      mimeType: 'image/png',
    }))
  })

  it('returns the file metadata as JSON, without echoing content', async () => {
    createMcpServer('user-1', 'org-test', 'https://example.test')
    vi.mocked(fileService.putFile).mockResolvedValue(metadata as never)

    const result = await callTool('hutch_put_file', {
      collection: 'agent-files',
      path: 'CLAUDE.md',
      content: '# hello',
    })

    const parsed = JSON.parse(result.content[0].text)
    expect(parsed).toEqual(expect.objectContaining({
      path: 'CLAUDE.md',
      size: 11,
      content_hash: metadata.content_hash,
    }))
    expect(parsed).not.toHaveProperty('content')
  })

  it('returns isError with a clear message when the file exceeds 4MB', async () => {
    createMcpServer('user-1', 'org-test', 'https://example.test')
    vi.mocked(fileService.putFile).mockResolvedValue({
      error: 'File exceeds the 4MB size limit',
      status: 413,
    } as never)

    const result = await callTool('hutch_put_file', {
      collection: 'agent-files',
      path: 'huge.bin',
      content_base64: 'AAAA',
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/4\s?MB/i)
  })

  it('returns isError with a clear message when blob storage is not configured', async () => {
    createMcpServer('user-1', 'org-test', 'https://example.test')
    vi.mocked(fileService.putFile).mockResolvedValue({
      error: 'Blob storage is not configured. Set the HUTCH_S3_* environment variables.',
      status: 501,
    } as never)

    const result = await callTool('hutch_put_file', {
      collection: 'agent-files',
      path: 'logo.png',
      content_base64: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'),
      mime_type: 'image/png',
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/not configured/i)
  })

  it('returns isError with the validation message for a bad path', async () => {
    createMcpServer('user-1', 'org-test', 'https://example.test')
    vi.mocked(fileService.putFile).mockResolvedValue({
      error: "Invalid path: must be a relative path without '..' segments",
      status: 400,
    } as never)

    const result = await callTool('hutch_put_file', {
      collection: 'agent-files',
      path: '../escape.md',
      content: 'x',
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/path/i)
  })
})

describe('hutch_get_file', () => {
  it('forwards collection and path to fileService.getFile', async () => {
    createMcpServer('user-1', 'org-test', 'https://example.test')
    vi.mocked(fileService.getFile).mockResolvedValue({ ...metadata, content: '# hello' } as never)

    await callTool('hutch_get_file', { collection: 'agent-files', path: 'CLAUDE.md' })

    expect(fileService.getFile).toHaveBeenCalledWith('agent-files', 'user-1', 'CLAUDE.md')
  })

  it('returns the content for an inline file', async () => {
    createMcpServer('user-1', 'org-test', 'https://example.test')
    vi.mocked(fileService.getFile).mockResolvedValue({ ...metadata, content: '# hello' } as never)

    const result = await callTool('hutch_get_file', { collection: 'agent-files', path: 'CLAUDE.md' })

    const parsed = JSON.parse(result.content[0].text)
    expect(parsed).toEqual(expect.objectContaining({ path: 'CLAUDE.md', content: '# hello' }))
  })

  it('returns the presigned download_url for a blob file', async () => {
    const presignedUrl =
      'https://s3.example.test/hutch-blobs/blobs/1/abc?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=sig'
    createMcpServer('user-1', 'org-test', 'https://example.test')
    vi.mocked(fileService.getFile).mockResolvedValue({
      path: 'logo.png',
      filename: 'logo.png',
      mime_type: 'image/png',
      size: 4,
      content_hash: 'cd'.repeat(32),
      download_url: presignedUrl,
    } as never)

    const result = await callTool('hutch_get_file', { collection: 'agent-files', path: 'logo.png' })

    const parsed = JSON.parse(result.content[0].text)
    expect(parsed).toEqual(expect.objectContaining({
      download_url: presignedUrl,
    }))
    expect(parsed).not.toHaveProperty('content')
  })

  it('returns isError when the collection is not accessible (service returns null)', async () => {
    createMcpServer('user-1', 'org-test', 'https://example.test')
    vi.mocked(fileService.getFile).mockResolvedValue(null as never)

    const result = await callTool('hutch_get_file', { collection: 'missing', path: 'x.md' })
    expect(result.isError).toBe(true)
  })

  it('returns isError when the file is missing (404-style service error)', async () => {
    createMcpServer('user-1', 'org-test', 'https://example.test')
    vi.mocked(fileService.getFile).mockResolvedValue({ error: 'File not found', status: 404 } as never)

    const result = await callTool('hutch_get_file', { collection: 'agent-files', path: 'nope.md' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/not found/i)
  })
})

describe('hutch_list_files', () => {
  it('forwards the collection to fileService.listFiles and returns metadata only', async () => {
    createMcpServer('user-1', 'org-test', 'https://example.test')
    vi.mocked(fileService.listFiles).mockResolvedValue({
      files: [
        { path: 'CLAUDE.md', filename: 'CLAUDE.md', mime_type: 'text/markdown', size: 11, content_hash: 'ab'.repeat(32) },
        { path: 'logo.png', filename: 'logo.png', mime_type: 'image/png', size: 4, content_hash: 'cd'.repeat(32) },
      ],
    } as never)

    const result = await callTool('hutch_list_files', { collection: 'agent-files' })

    expect(fileService.listFiles).toHaveBeenCalledWith('agent-files', 'user-1')
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.files).toHaveLength(2)
    for (const file of parsed.files) {
      expect(file).toEqual(expect.objectContaining({
        path: expect.any(String),
        size: expect.any(Number),
        content_hash: expect.any(String),
      }))
      expect(file).not.toHaveProperty('content')
    }
  })

  it('returns isError when the collection is not accessible', async () => {
    createMcpServer('user-1', 'org-test', 'https://example.test')
    vi.mocked(fileService.listFiles).mockResolvedValue(null as never)

    const result = await callTool('hutch_list_files', { collection: 'missing' })
    expect(result.isError).toBe(true)
  })
})
