import { describe, expect, it } from 'vitest'
import { applySkillSystemPrompt, filterToolsForSkill } from '../backend/gateway/src/routes/chat-utils'

describe('gateway chat utils', () => {
  it('appends skill prompt without replacing the existing system prompt', () => {
    const messages = [
      { role: 'system', content: 'base policy' },
      { role: 'user', content: 'search this' },
    ]

    const result = applySkillSystemPrompt(messages, 'skill policy')

    expect(result).toEqual([
      { role: 'system', content: 'base policy\n\nskill policy' },
      { role: 'user', content: 'search this' },
    ])
    expect(messages[0].content).toBe('base policy')
  })

  it('inserts skill prompt when there is no system message', () => {
    const result = applySkillSystemPrompt(
      [{ role: 'user', content: 'search this' }],
      'skill policy',
    )

    expect(result[0]).toEqual({ role: 'system', content: 'skill policy' })
    expect(result[1]).toEqual({ role: 'user', content: 'search this' })
  })

  it('limits available tools to the tools declared by the active skill', () => {
    const tools = [
      { type: 'function', function: { name: 'tavily_search', description: '', parameters: {} } },
      { type: 'function', function: { name: 'tavily_extract', description: '', parameters: {} } },
      { type: 'function', function: { name: 'private_tool', description: '', parameters: {} } },
    ] as any[]

    expect(filterToolsForSkill(tools, {
      name: 'web-search',
      description: '',
      icon: 'search',
      tools: ['tavily_search', 'tavily_extract'],
    })).toEqual([
      { type: 'function', function: { name: 'tavily_search', description: '', parameters: {} } },
      { type: 'function', function: { name: 'tavily_extract', description: '', parameters: {} } },
    ])
  })

  it('keeps all tools when no skill is active', () => {
    const tools = [
      { type: 'function', function: { name: 'tavily_search', description: '', parameters: {} } },
    ] as any[]

    expect(filterToolsForSkill(tools, null)).toEqual(tools)
  })

  it('disables tools when the active skill declares no tool list', () => {
    const tools = [
      { type: 'function', function: { name: 'tavily_search', description: '', parameters: {} } },
    ] as any[]

    expect(filterToolsForSkill(tools, {
      name: 'translator',
      description: '',
      icon: 'languages',
      tools: [],
    })).toEqual([])
  })
})
