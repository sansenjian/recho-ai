import { beforeEach, describe, expect, it, vi } from 'vitest'

let announcementRows: Array<Record<string, unknown>> = []
let insertPayloads: Array<Record<string, unknown>> = []
let updatePayloads: Array<Record<string, unknown>> = []
let tableError: unknown = null

function makeQueryBuilder() {
  const state: {
    status: string | null
    limit: number
    orderColumn: string
    ascending: boolean
  } = {
    status: null,
    limit: 20,
    orderColumn: 'updated_at',
    ascending: false,
  }
  const builder = {
    eq: vi.fn((column: string, value: string) => {
      if (column === 'status') state.status = value
      return builder
    }),
    order: vi.fn((column: string, options?: { ascending?: boolean }) => {
      state.orderColumn = column
      state.ascending = options?.ascending === true
      return builder
    }),
    limit: vi.fn((value: number) => {
      state.limit = value
      return builder
    }),
    then: (
      resolve: (value: { data: Array<Record<string, unknown>>; error: unknown }) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(queryAnnouncements(state)).then(resolve, reject),
  }
  return builder
}

function queryAnnouncements(state: {
  status: string | null
  limit: number
  orderColumn: string
  ascending: boolean
}) {
  if (tableError) return { data: [], error: tableError }
  const direction = state.ascending ? 1 : -1
  const rows = announcementRows
    .filter(row => !state.status || row.status === state.status)
    .slice()
    .sort((left, right) => {
      const a = String(left[state.orderColumn] || '')
      const b = String(right[state.orderColumn] || '')
      return a.localeCompare(b) * direction
    })
    .slice(0, state.limit)

  return { data: rows, error: null }
}

vi.mock('../backend/gateway/src/clients/supabase', () => ({
  getSupabaseAdminClient: () => ({
    from: (table: string) => {
      if (table !== 'announcements') throw new Error(`Unexpected table ${table}`)
      return {
        select: vi.fn(() => makeQueryBuilder()),
        insert: vi.fn((payload: Record<string, unknown>) => ({
          select: vi.fn(() => ({
            maybeSingle: vi.fn(async () => {
              if (tableError) return { data: null, error: tableError }
              insertPayloads.push(payload)
              const row = {
                id: '11111111-1111-4111-8111-111111111111',
                created_at: '2026-06-11T10:00:00.000Z',
                ...payload,
              }
              announcementRows.unshift(row)
              return { data: row, error: null }
            }),
          })),
        })),
        update: vi.fn((payload: Record<string, unknown>) => ({
          eq: vi.fn((_column: string, id: string) => ({
            select: vi.fn(() => ({
              maybeSingle: vi.fn(async () => {
                if (tableError) return { data: null, error: tableError }
                updatePayloads.push(payload)
                const index = announcementRows.findIndex(row => row.id === id)
                if (index < 0) return { data: null, error: null }
                announcementRows[index] = {
                  ...announcementRows[index],
                  ...payload,
                }
                return { data: announcementRows[index], error: null }
              }),
            })),
          })),
        })),
      }
    },
  }),
}))

describe('admin announcements service', () => {
  beforeEach(() => {
    announcementRows = []
    insertPayloads = []
    updatePayloads = []
    tableError = null
    vi.resetModules()
  })

  it('lists only published announcements for the public endpoint', async () => {
    announcementRows = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        title: 'Public',
        body: 'Visible',
        status: 'published',
        published_at: '2026-06-11T11:00:00.000Z',
        updated_at: '2026-06-11T11:00:00.000Z',
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        title: 'Draft',
        body: 'Hidden',
        status: 'draft',
        published_at: null,
        updated_at: '2026-06-11T12:00:00.000Z',
      },
    ]
    const { listPublishedAnnouncements } = await import('../backend/gateway/src/services/admin-announcements')

    await expect(listPublishedAnnouncements()).resolves.toEqual([
      expect.objectContaining({
        title: 'Public',
        body: 'Visible',
        status: 'published',
      }),
    ])
  })

  it('creates published announcements with sanitized content and audit fields', async () => {
    const { createAdminAnnouncement } = await import('../backend/gateway/src/services/admin-announcements')

    const announcement = await createAdminAnnouncement(
      {
        title: '  系统   维护  ',
        body: '  今晚 23:00 开始维护  ',
      },
      { id: '99999999-9999-4999-8999-999999999999', email: 'admin@example.test' },
    )

    expect(announcement).toMatchObject({
      title: '系统 维护',
      body: '今晚 23:00 开始维护',
      status: 'published',
      createdBy: '99999999-9999-4999-8999-999999999999',
      updatedBy: '99999999-9999-4999-8999-999999999999',
    })
    expect(insertPayloads[0]).toMatchObject({
      status: 'published',
      created_by: '99999999-9999-4999-8999-999999999999',
      updated_by: '99999999-9999-4999-8999-999999999999',
    })
    expect(insertPayloads[0].published_at).toEqual(expect.any(String))
  })

  it('updates announcement status without exposing unpublished items publicly', async () => {
    announcementRows = [{
      id: '11111111-1111-4111-8111-111111111111',
      title: 'Public',
      body: 'Visible',
      status: 'published',
      published_at: '2026-06-11T11:00:00.000Z',
      updated_at: '2026-06-11T11:00:00.000Z',
    }]
    const {
      listPublishedAnnouncements,
      updateAdminAnnouncement,
    } = await import('../backend/gateway/src/services/admin-announcements')

    await expect(updateAdminAnnouncement(
      '11111111-1111-4111-8111-111111111111',
      { status: 'archived' },
      { id: '99999999-9999-4999-8999-999999999999', email: null },
    )).resolves.toMatchObject({
      status: 'archived',
      updatedBy: '99999999-9999-4999-8999-999999999999',
    })
    await expect(listPublishedAnnouncements()).resolves.toEqual([])
    expect(updatePayloads[0]).toMatchObject({
      status: 'archived',
      updated_by: '99999999-9999-4999-8999-999999999999',
    })
  })
})
