import { isNamedWorkspace, type NamedWorkspace } from './workspace-list'
import type { GeneratedImage } from '../types/image'

const WORKSPACES_KEY = 'imagio-workspaces'
const ACTIVE_KEY = 'imagio-active-workspace'
const ASSIGNMENTS_KEY = 'imagio-image-workspaces'

export function loadImagioWorkspaces(storage: Storage): { workspaces: NamedWorkspace[]; activeId: string } {
  let workspaces: NamedWorkspace[] = []
  try {
    const parsed: unknown = JSON.parse(storage.getItem(WORKSPACES_KEY) || 'null')
    if (Array.isArray(parsed)) {
      const ids = new Set<string>()
      workspaces = parsed.filter((item) => {
        if (!isNamedWorkspace(item) || ids.has(item.id)) return false
        ids.add(item.id)
        return true
      })
    }
  } catch (err) {
    console.warn('[imagio] failed to load workspaces', err)
  }
  if (!workspaces.length) workspaces = [{ id: crypto.randomUUID(), name: '新工作区' }]
  const storedId = storage.getItem(ACTIVE_KEY)
  return {
    workspaces,
    activeId: workspaces.some(item => item.id === storedId) ? storedId! : workspaces[0].id,
  }
}

export function saveImagioWorkspaces(storage: Storage, workspaces: NamedWorkspace[], activeId: string) {
  storage.setItem(WORKSPACES_KEY, JSON.stringify(workspaces))
  storage.setItem(ACTIVE_KEY, activeId)
}

export function loadImagioAssignments(storage: Storage, userId: string | null): Record<string, string> {
  try {
    const all: unknown = JSON.parse(storage.getItem(ASSIGNMENTS_KEY) || 'null')
    if (!all || typeof all !== 'object' || Array.isArray(all)) return {}
    const scoped = (all as Record<string, unknown>)[userId || 'guest']
    if (!scoped || typeof scoped !== 'object' || Array.isArray(scoped)) return {}
    return Object.fromEntries(Object.entries(scoped).filter(([id, workspace]) => id && typeof workspace === 'string'))
  } catch {
    return {}
  }
}

export function saveImagioAssignments(storage: Storage, userId: string | null, assignments: Record<string, string>) {
  let all: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(storage.getItem(ASSIGNMENTS_KEY) || 'null')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) all = parsed as Record<string, unknown>
  } catch { /* replace malformed local state */ }
  storage.setItem(ASSIGNMENTS_KEY, JSON.stringify({ ...all, [userId || 'guest']: assignments }))
}

export function imageWorkspaceId(image: GeneratedImage, assignments: Record<string, string>, defaultId: string) {
  return assignments[image.id] || defaultId
}
