import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import {
  conversations,
  groups,
  activeConversationId,
  getActiveConversation,
  createConversation,
  deleteConversation,
  switchConversation,
  updateConversationTitle,
  setConversationTitle,
  updateSystemPrompt,
  touchConversation,
  createGroup,
  deleteGroup,
  renameGroup,
  recolorGroup,
  assignToGroup,
} from '../src/stores/chat'
import { GROUP_COLORS } from '../src/types'
import type { Message } from '../src/types'

function makeMsg(role: 'user' | 'assistant', content: string): Message {
  return { id: Date.now(), role, content, timestamp: 'now' }
}

beforeEach(async () => {
  localStorage.clear()
  groups.value = []
  conversations.value = [
    {
      id: 1,
      title: 'New Chat',
      messages: [makeMsg('user', 'hello')],
      systemPrompt: '',
      groupId: null,
      createdAt: 'now',
      updatedAt: 'now',
    },
  ]
  activeConversationId.value = 1
  await nextTick()
})

describe('chat store', () => {
  describe('createConversation', () => {
    it('creates a new empty conversation', () => {
      const conv = createConversation()
      expect(conv.title).toBe('New Chat')
      expect(conv.messages).toEqual([])
      expect(conv.systemPrompt).toBe('')
    })

    it('sets the new conversation as active', () => {
      const conv = createConversation()
      expect(activeConversationId.value).toBe(conv.id)
    })

    it('adds to the front of the list', () => {
      createConversation()
      expect(conversations.value[0].id).toBeGreaterThan(1)
      expect(conversations.value[1].id).toBe(1)
    })
  })

  describe('lazy persistence (empty conversations)', () => {
    it('cleanup: manually deleting an empty conversation works', () => {
      const empty = createConversation()
      expect(conversations.value.length).toBe(2)

      expect(empty.messages.length).toBe(0)
      expect(empty.systemPrompt).toBe('')

      deleteConversation(empty.id)
      expect(activeConversationId.value).toBe(1)
      expect(conversations.value.length).toBe(1)
    })

    it('cleanup: conversation with messages is NOT removed on switch', async () => {
      const conv = createConversation()
      conv.messages.push(makeMsg('user', 'hello'))
      expect(conversations.value.length).toBe(2)

      switchConversation(1)
      await nextTick()
      expect(conversations.value.length).toBe(2)
    })

    it('cleanup: conversation with systemPrompt is NOT removed on switch', async () => {
      const conv = createConversation()
      updateSystemPrompt(conv.id, 'be helpful')
      expect(conversations.value.length).toBe(2)

      switchConversation(1)
      await nextTick()
      expect(conversations.value.length).toBe(2)
    })

    it('cleanup: last remaining conversation is never removed', async () => {
      switchConversation(1)
      await nextTick()
      expect(conversations.value.length).toBe(1)
    })

    it('save: empty conversations are not persisted to localStorage', async () => {
      createConversation()
      await nextTick()
      const saved = JSON.parse(localStorage.getItem('recho-conversations') || '[]')
      expect(saved.length).toBe(1)
      expect(saved.every((c: any) => c.messages.length > 0 || c.systemPrompt)).toBe(true)
    })

    it('save: conversations with messages are persisted', async () => {
      const conv = createConversation()
      conv.messages.push(makeMsg('user', 'persist me'))
      await nextTick()
      const saved = JSON.parse(localStorage.getItem('recho-conversations') || '[]')
      const savedConv = saved.find((c: any) => c.id === conv.id)
      expect(savedConv).toBeDefined()
      expect(savedConv.messages.length).toBe(1)
    })

    it('save: conversations with systemPrompt are persisted', async () => {
      const conv = createConversation()
      updateSystemPrompt(conv.id, 'persist prompt')
      await nextTick()
      const saved = JSON.parse(localStorage.getItem('recho-conversations') || '[]')
      expect(saved.length).toBeGreaterThanOrEqual(1)
      const savedConv = saved.find((c: any) => c.id === conv.id)
      expect(savedConv).toBeDefined()
      expect(savedConv.systemPrompt).toBe('persist prompt')
    })
  })

  describe('deleteConversation', () => {
    it('removes the conversation from the list', () => {
      createConversation()
      expect(conversations.value.length).toBe(2)
      deleteConversation(1)
      expect(conversations.value.length).toBe(1)
    })

    it('switches to first remaining when active is deleted', () => {
      const second = createConversation()
      switchConversation(1)
      deleteConversation(1)
      expect(activeConversationId.value).toBe(second.id)
    })

    it('creates a new conversation if all are deleted', () => {
      deleteConversation(1)
      expect(conversations.value.length).toBeGreaterThan(0)
      expect(activeConversationId.value).toBe(conversations.value[0].id)
    })
  })

  describe('updateSystemPrompt', () => {
    it('sets systemPrompt on the target conversation', () => {
      updateSystemPrompt(1, 'You are a helpful assistant')
      expect(conversations.value[0].systemPrompt).toBe('You are a helpful assistant')
    })

    it('does nothing for non-existent conversation', () => {
      updateSystemPrompt(999, 'ghost')
      expect(conversations.value[0].systemPrompt).toBe('')
    })
  })

  describe('updateConversationTitle', () => {
    it('sets title from first user message', () => {
      updateConversationTitle(1, [makeMsg('user', 'Short title')])
      expect(conversations.value[0].title).toBe('Short title')
    })

    it('does not overwrite if title is not "New Chat"', () => {
      setConversationTitle(1, 'Custom Title')
      updateConversationTitle(1, [makeMsg('user', 'Should not change')])
      expect(conversations.value[0].title).toBe('Custom Title')
    })

    it('sets title with short messages without truncation', () => {
      updateConversationTitle(1, [makeMsg('user', 'Hi')])
      expect(conversations.value[0].title).toBe('Hi')
    })
  })

  describe('setConversationTitle', () => {
    it('always sets the title directly', () => {
      setConversationTitle(1, 'Exact Title Here')
      expect(conversations.value[0].title).toBe('Exact Title Here')
    })
  })

  describe('touchConversation', () => {
    it('updates the updatedAt timestamp', () => {
      const before = conversations.value[0].updatedAt
      touchConversation(1)
      expect(conversations.value[0].updatedAt).not.toBe(before)
    })
  })

  describe('switchConversation', () => {
    it('changes the active conversation', () => {
      createConversation()
      switchConversation(1)
      expect(activeConversationId.value).toBe(1)
    })
  })

  describe('getActiveConversation', () => {
    it('returns the currently active conversation', () => {
      const conv = getActiveConversation()
      expect(conv?.id).toBe(1)
    })
  })

  describe('group operations', () => {
    it('createGroup creates a group with name and color', () => {
      const g = createGroup('Work', '#6366f1')
      expect(g.name).toBe('Work')
      expect(g.color).toBe('#6366f1')
      expect(groups.value).toHaveLength(1)
    })

    it('createGroup auto-assigns a color if none provided', () => {
      const g = createGroup('Personal')
      expect(g.name).toBe('Personal')
      expect(GROUP_COLORS).toContain(g.color)
    })

    it('createGroup uses first available color for second group', () => {
      createGroup('Work', GROUP_COLORS[0])
      const g = createGroup('Personal')
      expect(g.color).not.toBe(GROUP_COLORS[0])
    })

    it('renameGroup updates the group name', () => {
      const g = createGroup('Work')
      renameGroup(g.id, 'Office')
      expect(groups.value[0].name).toBe('Office')
    })

    it('recolorGroup updates the group color', () => {
      const g = createGroup('Work', '#6366f1')
      recolorGroup(g.id, '#ef4444')
      expect(groups.value[0].color).toBe('#ef4444')
    })

    it('deleteGroup removes the group and unassigns conversations', () => {
      const g = createGroup('Work')
      const conv = createConversation()
      assignToGroup(conv.id, g.id)
      expect(conv.groupId).toBe(g.id)

      deleteGroup(g.id)
      expect(groups.value).toHaveLength(0)
      expect(conv.groupId).toBeNull()
    })

    it('assignToGroup sets groupId on conversation', () => {
      const g = createGroup('Work')
      assignToGroup(1, g.id)
      expect(conversations.value[0].groupId).toBe(g.id)
    })

    it('assignToGroup with null ungroups conversation', () => {
      const g = createGroup('Work')
      assignToGroup(1, g.id)
      assignToGroup(1, null)
      expect(conversations.value[0].groupId).toBeNull()
    })

    it('new conversations default to null groupId', () => {
      const conv = createConversation()
      expect(conv.groupId).toBeNull()
    })

    it('groups persist to localStorage', async () => {
      createGroup('Work', '#6366f1')
      await nextTick()
      const saved = JSON.parse(localStorage.getItem('recho-groups') || '[]')
      expect(saved).toHaveLength(1)
      expect(saved[0].name).toBe('Work')
    })

    it('old conversations without groupId default to null', async () => {
      const oldData = [
        {
          id: 999,
          title: 'Old Chat',
          messages: [makeMsg('user', 'hi')],
          systemPrompt: '',
          createdAt: 'old',
          updatedAt: 'old',
        },
      ]
      localStorage.setItem('recho-conversations', JSON.stringify(oldData))
      conversations.value = oldData.map((c: any) => ({
        ...c,
        systemPrompt: c.systemPrompt ?? '',
        groupId: c.groupId ?? null,
      }))
      const loaded = conversations.value.find(c => c.id === 999)
      expect(loaded?.groupId).toBeNull()
    })
  })

  describe('structured assistant blocks', () => {
    it('persists conversations with schema version 2 when assistant blocks exist', async () => {
      conversations.value[0].messages.push({
        id: 2,
        role: 'assistant',
        content: '最终回答',
        timestamp: 'now',
        blocks: [
          { id: 'think-1', type: 'thinking', content: '思考摘要', status: 'done' },
          { id: 'text-1', type: 'assistant_text', content: '最终回答', status: 'complete' },
        ],
      })

      await nextTick()

      const saved = JSON.parse(localStorage.getItem('recho-conversations') || '[]')
      expect(saved[0].schemaVersion).toBe(2)
      expect(saved[0].messages[1].blocks).toEqual([
        { id: 'think-1', type: 'thinking', content: '思考摘要', status: 'done' },
        { id: 'text-1', type: 'assistant_text', content: '最终回答', status: 'complete' },
      ])
    })

    it('keeps legacy assistant messages without blocks renderable', () => {
      const legacy: Message = {
        id: 3,
        role: 'assistant',
        content: '旧回答',
        thinking: '旧思考',
        toolCalls: [
          {
            id: 'tool-legacy',
            name: 'search',
            arguments: { q: 'legacy' },
            result: 'ok',
            status: 'done',
          },
        ],
        timestamp: 'now',
      }

      conversations.value[0].messages.push(legacy)

      expect(conversations.value[0].messages[1].blocks).toBeUndefined()
      expect(conversations.value[0].messages[1].thinking).toBe('旧思考')
      expect(conversations.value[0].messages[1].toolCalls?.[0].status).toBe('done')
    })
  })
})
