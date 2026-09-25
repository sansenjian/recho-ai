// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { imageWorkspaceId, loadImagioAssignments, loadImagioWorkspaces, saveImagioAssignments, saveImagioWorkspaces } from '../src/lib/imagio-workspaces'
import type { GeneratedImage } from '../src/types/image'

const image = { id: 'old', prompt: 'old', size: 'auto', timestamp: '2026-01-01' } as GeneratedImage

describe('Imagio workspace persistence', () => {
  beforeEach(() => localStorage.clear())

  it('restores valid workspaces and the selected workspace after refresh', () => {
    const workspaces = [{ id: 'a', name: '默认' }, { id: 'b', name: '新工作区' }]
    saveImagioWorkspaces(localStorage, workspaces, 'b')
    expect(loadImagioWorkspaces(localStorage)).toEqual({ workspaces, activeId: 'b' })
  })

  it('puts legacy images in the default workspace and persists new assignments per user', () => {
    expect(imageWorkspaceId(image, {}, 'a')).toBe('a')
    saveImagioAssignments(localStorage, 'user-1', { old: 'b' })
    expect(imageWorkspaceId(image, loadImagioAssignments(localStorage, 'user-1'), 'a')).toBe('b')
    expect(imageWorkspaceId(image, loadImagioAssignments(localStorage, 'user-2'), 'a')).toBe('a')
    saveImagioAssignments(localStorage, 'user-2', { new: 'a' })
    expect(loadImagioAssignments(localStorage, 'user-1')).toEqual({ old: 'b' })
  })

  it('ignores malformed and duplicate workspace entries', () => {
    localStorage.setItem('imagio-workspaces', JSON.stringify([
      { id: 'a', name: '默认' }, { id: 'a', name: '重复' }, { id: '', name: '无效' },
    ]))
    localStorage.setItem('imagio-active-workspace', 'missing')
    expect(loadImagioWorkspaces(localStorage)).toEqual({ workspaces: [{ id: 'a', name: '默认' }], activeId: 'a' })
  })

  it('creates a default workspace when persisted entries are all invalid', () => {
    localStorage.setItem('imagio-workspaces', JSON.stringify([{ id: '', name: '无效' }]))
    const state = loadImagioWorkspaces(localStorage)
    expect(state.workspaces).toHaveLength(1)
    expect(state.workspaces[0].name).toBe('新工作区')
    expect(state.activeId).toBe(state.workspaces[0].id)
  })
})
