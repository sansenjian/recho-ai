export interface ChatRouteMessage {
  role: string
  content?: unknown
  [key: string]: unknown
}

export interface SkillToolScope {
  tools?: string[]
}

export interface ChatRouteTool {
  function?: {
    name?: string
  }
}

export function applySkillSystemPrompt<T extends ChatRouteMessage>(
  messages: T[],
  skillPrompt?: string,
): T[] {
  const cloned = messages.map(message => ({ ...message }))
  if (!skillPrompt) return cloned

  const sysIdx = cloned.findIndex(message => message.role === 'system')
  if (sysIdx === -1) {
    return [
      { role: 'system', content: skillPrompt } as T,
      ...cloned,
    ]
  }

  cloned[sysIdx] = {
    ...cloned[sysIdx],
    content: [
      cloned[sysIdx].content,
      skillPrompt,
    ].filter(Boolean).join('\n\n'),
  }

  return cloned
}

export function filterToolsForSkill<T extends ChatRouteTool>(
  tools: T[],
  skill: SkillToolScope | null,
): T[] {
  if (!skill) return tools
  if (!skill.tools?.length) return []
  const allowed = new Set(skill.tools)
  return tools.filter(tool => {
    const name = tool.function?.name
    return typeof name === 'string' && allowed.has(name)
  })
}
