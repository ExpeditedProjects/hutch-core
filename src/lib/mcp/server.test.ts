import { describe, it, expect, vi, beforeEach } from 'vitest'

const { registeredTools } = vi.hoisted(() => ({
  registeredTools: new Map<string, (params: unknown) => Promise<unknown>>(),
}))

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
  class McpServer {
    registerTool(name: string, _config: unknown, handler: (params: unknown) => Promise<unknown>) {
      registeredTools.set(name, handler)
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

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([]) })) })) })),
  },
}))

import { createMcpServer } from './server'
import * as collectionService from '@/lib/services/collections'
import * as recordService from '@/lib/services/records'
import { createView } from '@/lib/services/views'

beforeEach(() => {
  vi.clearAllMocks()
  registeredTools.clear()
})

describe('createMcpServer tool registration', () => {
  it('registers the single-user Core data-tool surface', () => {
    createMcpServer('user-1', 'org-test', 'https://example.test')
    const expected = [
      'hutch_list_collections', 'hutch_get_collection', 'hutch_describe_collection',
      'hutch_store_records', 'hutch_query_records', 'hutch_search', 'hutch_update_collection',
      'hutch_delete_collection', 'hutch_delete_record', 'hutch_update_record', 'hutch_transform_records',
      'hutch_set_record_status', 'hutch_infer_schema', 'hutch_update_schema', 'hutch_create_view',
    ]
    for (const name of expected) {
      expect(registeredTools.has(name), `expected tool ${name} to be registered`).toBe(true)
    }
  })

  it('does not register sharing, organization, or transfer tools', () => {
    createMcpServer('user-1', 'org-test', 'https://example.test')
    const removed = [
      'hutch_list_collection_members', 'hutch_list_collection_invitations',
      'hutch_invite_collection_member', 'hutch_revoke_collection_invitation',
      'hutch_remove_collection_member', 'hutch_list_my_pending_invitations',
      'hutch_accept_invitation', 'hutch_decline_invitation',
      'hutch_list_organizations', 'hutch_create_organization',
      'hutch_list_organization_members', 'hutch_list_organization_invitations',
      'hutch_invite_organization_member', 'hutch_revoke_organization_invitation',
      'hutch_remove_organization_member', 'hutch_list_my_pending_organization_invitations',
      'hutch_accept_organization_invitation', 'hutch_decline_organization_invitation',
      'hutch_transfer_collection',
    ]
    for (const name of removed) {
      expect(registeredTools.has(name), `${name} should NOT be registered in Core`).toBe(false)
    }
  })
})

describe('store_records tool', () => {
  it('forwards params to recordService.createRecords and returns the result as JSON text', async () => {
    createMcpServer('user-1', 'org-test', 'https://example.test')
    vi.mocked(recordService.createRecords).mockResolvedValue({
      collection: { name: 'Users', slug: 'users' },
      action: 'created',
      record: { id: 1 },
    } as never)

    const result = await registeredTools.get('hutch_store_records')!({
      collection: 'Users',
      data: { name: 'Alice' },
    })

    expect(recordService.createRecords).toHaveBeenCalledWith('user-1', 'org-test', expect.objectContaining({
      collection: 'Users',
      data: { name: 'Alice' },
    }))
    const text = (result as { content: { text: string }[] }).content[0].text
    expect(JSON.parse(text)).toEqual(expect.objectContaining({ action: 'created' }))
  })

  it('returns isError when the service reports a validation error', async () => {
    createMcpServer('user-1', 'org-test', 'https://example.test')
    vi.mocked(recordService.createRecords).mockResolvedValue({ error: 'oops', status: 400 } as never)

    const result = await registeredTools.get('hutch_store_records')!({ collection: 'Users', data: {} }) as {
      isError?: boolean
      content: { text: string }[]
    }
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe('oops')
  })

  it('prepends the service summary as a leading line above the JSON body (issue #447)', async () => {
    createMcpServer('user-1', 'org-test', 'https://example.test')
    vi.mocked(recordService.createRecords).mockResolvedValue({
      collection: { name: 'Users', slug: 'users' },
      action: 'created',
      record: { id: 1 },
      summary: 'Saved 1 record to Users',
    } as never)

    const result = await registeredTools.get('hutch_store_records')!({
      collection: 'Users',
      data: { name: 'Alice' },
    }) as { content: { text: string }[] }

    const text = result.content[0].text
    expect(text).toMatch(/^Saved 1 record to Users\n\n\{/)
    // The JSON body still parses and still contains the summary field.
    const jsonStart = text.indexOf('{')
    expect(JSON.parse(text.slice(jsonStart))).toEqual(expect.objectContaining({
      summary: 'Saved 1 record to Users',
      action: 'created',
    }))
  })
})

describe('create_view tool', () => {
  it('does not require a name parameter and forwards type to the service', async () => {
    createMcpServer('user-1', 'org-test', 'https://example.test')
    vi.mocked(createView).mockResolvedValue({ view: { id: 1, name: 'Table' } } as never)

    await registeredTools.get('hutch_create_view')!({ slug: 'users', type: 'table' })
    expect(createView).toHaveBeenCalledWith('users', 'user-1', expect.objectContaining({ type: 'table' }))
    const passed = vi.mocked(createView).mock.calls[0][2]
    expect(passed).not.toHaveProperty('name')
  })

  it('returns isError when the collection is not found', async () => {
    createMcpServer('user-1', 'org-test', 'https://example.test')
    vi.mocked(createView).mockResolvedValue(null)

    const result = await registeredTools.get('hutch_create_view')!({ slug: 'missing' }) as { isError?: boolean }
    expect(result.isError).toBe(true)
  })

  it('infers groupBy from the first select field of the collection schema for kanban views', async () => {
    createMcpServer('user-1', 'org-test', 'https://example.test')
    vi.mocked(collectionService.getCollection).mockResolvedValue({
      id: 1,
      name: 'Tasks',
      slug: 'tasks',
      schema: {
        fields: [
          { name: 'title', type: 'text', inferred: true, position: 0, hidden: false },
          { name: 'status', type: 'select', inferred: true, position: 1, hidden: false, options: ['todo', 'done'] },
          { name: 'priority', type: 'select', inferred: true, position: 2, hidden: false, options: ['low', 'high'] },
        ],
        version: 1,
        lastInferredAt: new Date().toISOString(),
      },
    } as never)
    vi.mocked(createView).mockResolvedValue({ view: { id: 1, name: 'Kanban' } } as never)

    await registeredTools.get('hutch_create_view')!({ slug: 'tasks', type: 'kanban' })

    expect(createView).toHaveBeenCalledWith('tasks', 'user-1', expect.objectContaining({
      type: 'kanban',
      groupBy: 'status',
    }))
  })

  it('returns isError mentioning group_by when kanban requested but collection has no select fields', async () => {
    createMcpServer('user-1', 'org-test', 'https://example.test')
    vi.mocked(collectionService.getCollection).mockResolvedValue({
      id: 1,
      name: 'Tasks',
      slug: 'tasks',
      schema: {
        fields: [
          { name: 'title', type: 'text', inferred: true, position: 0, hidden: false },
          { name: 'count', type: 'number', inferred: true, position: 1, hidden: false },
        ],
        version: 1,
        lastInferredAt: new Date().toISOString(),
      },
    } as never)

    const result = await registeredTools.get('hutch_create_view')!({ slug: 'tasks', type: 'kanban' }) as {
      isError?: boolean
      content: { text: string }[]
    }

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/group_by/)
    expect(createView).not.toHaveBeenCalled()
  })

  it('forwards an explicit group_by for kanban without consulting the schema', async () => {
    createMcpServer('user-1', 'org-test', 'https://example.test')
    vi.mocked(createView).mockResolvedValue({ view: { id: 1, name: 'Kanban' } } as never)

    await registeredTools.get('hutch_create_view')!({ slug: 'tasks', type: 'kanban', group_by: 'priority' })

    expect(createView).toHaveBeenCalledWith('tasks', 'user-1', expect.objectContaining({
      type: 'kanban',
      groupBy: 'priority',
    }))
    expect(collectionService.getCollection).not.toHaveBeenCalled()
  })

  it('does not forward groupBy to createView for non-kanban view types', async () => {
    createMcpServer('user-1', 'org-test', 'https://example.test')
    vi.mocked(createView).mockResolvedValue({ view: { id: 1, name: 'Table' } } as never)

    await registeredTools.get('hutch_create_view')!({ slug: 'tasks', type: 'table', group_by: 'status' })

    const passed = vi.mocked(createView).mock.calls[0][2] as { groupBy?: string }
    expect(passed.groupBy).toBeUndefined()
  })

  it('forwards an explicit name to createView', async () => {
    createMcpServer('user-1', 'org-test', 'https://example.test')
    vi.mocked(createView).mockResolvedValue({ view: { id: 1, name: 'My Board' } } as never)

    await registeredTools.get('hutch_create_view')!({
      slug: 'tasks',
      type: 'kanban',
      name: 'My Board',
      group_by: 'status',
    })

    expect(createView).toHaveBeenCalledWith('tasks', 'user-1', expect.objectContaining({
      name: 'My Board',
    }))
  })
})

describe('list_collections tool', () => {
  it('returns the collections array as JSON text', async () => {
    createMcpServer('user-1', 'org-test', 'https://example.test')
    vi.mocked(collectionService.listCollections).mockResolvedValue([
      { id: 1, name: 'Users', slug: 'users' },
    ] as never)

    const result = await registeredTools.get('hutch_list_collections')!({}) as { content: { text: string }[] }
    expect(JSON.parse(result.content[0].text)).toEqual([
      expect.objectContaining({ name: 'Users', slug: 'users' }),
    ])
  })
})

describe('collection url in mutation responses', () => {
  const BASE_URL = 'https://example.test'

  // Extract the JSON portion of an MCP tool response text. Some handlers
  // (e.g. store_records) prepend a "${summary}\n\n" line above the JSON body.
  function parseResponseJson(text: string): Record<string, unknown> {
    const jsonStart = text.indexOf('{')
    if (jsonStart === -1) throw new Error(`no JSON object in response text: ${text}`)
    return JSON.parse(text.slice(jsonStart))
  }

  async function callTool(name: string, args: unknown): Promise<{ content: { text: string }[]; isError?: boolean }> {
    const handler = registeredTools.get(name)
    if (!handler) throw new Error(`tool ${name} not registered`)
    return await handler(args) as { content: { text: string }[]; isError?: boolean }
  }

  describe('hutch_store_records', () => {
    it('includes url for the auto-created collection path', async () => {
      createMcpServer('user-1', 'org-test', BASE_URL)
      vi.mocked(recordService.createRecords).mockResolvedValue({
        collection: { name: 'Bookmarks', slug: 'bookmarks' },
        action: 'created',
        record: { id: 1 },
        summary: 'Saved 1 record to Bookmarks',
      } as never)

      const result = await callTool('hutch_store_records', {
        collection: 'Bookmarks',
        data: { url: 'https://example.com' },
      })

      const parsed = parseResponseJson(result.content[0].text)
      expect(parsed.url).toBe(`${BASE_URL}/c/bookmarks`)
    })

    it('includes url for the existing-collection path', async () => {
      createMcpServer('user-1', 'org-test', BASE_URL)
      vi.mocked(recordService.createRecords).mockResolvedValue({
        collection: { name: 'Users', slug: 'users' },
        action: 'replaced',
        record: { id: 2 },
      } as never)

      const result = await callTool('hutch_store_records', {
        collection: 'Users',
        data: { name: 'Bob' },
      })

      const parsed = parseResponseJson(result.content[0].text)
      expect(parsed.url).toBe(`${BASE_URL}/c/users`)
    })
  })

  describe('hutch_update_collection', () => {
    it('includes url with the slug from the input args', async () => {
      createMcpServer('user-1', 'org-test', BASE_URL)
      vi.mocked(collectionService.updateCollection).mockResolvedValue({
        collection: { id: 1, name: 'Users', slug: 'users' },
      } as never)

      const result = await callTool('hutch_update_collection', {
        slug: 'users',
        name: 'People',
      })

      const parsed = parseResponseJson(result.content[0].text)
      expect(parsed.url).toBe(`${BASE_URL}/c/users`)
    })
  })

  describe('hutch_update_record', () => {
    it('includes url with the slug from the input args', async () => {
      createMcpServer('user-1', 'org-test', BASE_URL)
      vi.mocked(recordService.updateRecord).mockResolvedValue({
        record: { id: 7, data: { name: 'Alice' } },
      } as never)

      const result = await callTool('hutch_update_record', {
        slug: 'users',
        record_id: 7,
        data: { name: 'Alice' },
      })

      const parsed = parseResponseJson(result.content[0].text)
      expect(parsed.url).toBe(`${BASE_URL}/c/users`)
    })
  })

  describe('hutch_transform_records', () => {
    it('includes url with the slug from the input args', async () => {
      createMcpServer('user-1', 'org-test', BASE_URL)
      vi.mocked(recordService.transformRecords).mockResolvedValue({
        updated: 5,
      } as never)

      const result = await callTool('hutch_transform_records', {
        slug: 'users',
        remove_fields: ['legacy'],
      })

      const parsed = parseResponseJson(result.content[0].text)
      expect(parsed.url).toBe(`${BASE_URL}/c/users`)
    })
  })

  describe('hutch_set_record_status', () => {
    it('includes url with the slug from the input args', async () => {
      createMcpServer('user-1', 'org-test', BASE_URL)
      vi.mocked(recordService.updateRecordStatus).mockResolvedValue({
        record: { id: 3, status: 'archived' },
      } as never)

      const result = await callTool('hutch_set_record_status', {
        slug: 'users',
        record_id: 3,
        status: 'archived',
      })

      const parsed = parseResponseJson(result.content[0].text)
      expect(parsed.url).toBe(`${BASE_URL}/c/users`)
    })
  })

  describe('hutch_delete_record', () => {
    it('includes url because the collection still exists', async () => {
      createMcpServer('user-1', 'org-test', BASE_URL)
      vi.mocked(recordService.deleteRecord).mockResolvedValue({
        record: { id: 9 },
      } as never)

      const result = await callTool('hutch_delete_record', {
        slug: 'users',
        record_id: 9,
      })

      const parsed = parseResponseJson(result.content[0].text)
      expect(parsed.url).toBe(`${BASE_URL}/c/users`)
    })
  })

  describe('hutch_infer_schema', () => {
    it('includes url with the slug from the input args', async () => {
      createMcpServer('user-1', 'org-test', BASE_URL)
      vi.mocked(collectionService.inferCollectionSchema).mockResolvedValue({
        fields: [{ name: 'title', type: 'text' }],
      } as never)

      const result = await callTool('hutch_infer_schema', { slug: 'notes' })

      const parsed = parseResponseJson(result.content[0].text)
      expect(parsed.url).toBe(`${BASE_URL}/c/notes`)
    })
  })

  describe('hutch_update_schema', () => {
    it('includes url with the slug from the input args', async () => {
      createMcpServer('user-1', 'org-test', BASE_URL)
      vi.mocked(collectionService.updateFieldDefinition).mockResolvedValue({
        field: { name: 'status', type: 'select' },
      } as never)

      const result = await callTool('hutch_update_schema', {
        slug: 'tasks',
        field: 'status',
        type: 'select',
        options: ['todo', 'done'],
      })

      const parsed = parseResponseJson(result.content[0].text)
      expect(parsed.url).toBe(`${BASE_URL}/c/tasks`)
    })
  })

  describe('hutch_create_view', () => {
    it('includes url with the slug from the input args', async () => {
      createMcpServer('user-1', 'org-test', BASE_URL)
      vi.mocked(createView).mockResolvedValue({
        view: { id: 1, name: 'Table' },
      } as never)

      const result = await callTool('hutch_create_view', {
        slug: 'tasks',
        type: 'table',
      })

      const parsed = parseResponseJson(result.content[0].text)
      expect(parsed.url).toBe(`${BASE_URL}/c/tasks`)
    })
  })

  describe('hutch_delete_collection', () => {
    it('does NOT include a url field because the collection no longer exists', async () => {
      createMcpServer('user-1', 'org-test', BASE_URL)
      vi.mocked(collectionService.deleteCollection).mockResolvedValue({
        deleted: true,
      } as never)

      const result = await callTool('hutch_delete_collection', { slug: 'users' })

      const text = result.content[0].text
      // Response is a plain confirmation string, not JSON — no url field anywhere.
      expect(text).not.toMatch(/"url"\s*:/)
      expect(text).not.toContain(`${BASE_URL}/c/users`)
    })
  })
})
