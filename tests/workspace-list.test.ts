// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

vi.mock('../src/composables/useAuthSession', () => ({
  useAuthSession: () => ({ user: { value: null } }),
  getAuthAccessToken: vi.fn(async () => null),
}))

vi.mock('../src/composables/useCredits', () => ({
  useCredits: () => ({ creditBalance: { value: 0 }, refreshCredits: () => {} }),
}))

import ImagioSidebar from '../src/components/ImagioSidebar.vue'
import WorkspaceList from '../src/components/WorkspaceList.vue'
import ImageCanvasSidebar from '../src/components/ImageCanvasSidebar.vue'
import { isNamedWorkspace, removeNamedWorkspace, type NamedWorkspace } from '../src/lib/workspace-list'

const pair: NamedWorkspace[] = [
  { id: 'a', name: '工作区 A' },
  { id: 'b', name: '工作区 B' },
]

describe('removeNamedWorkspace', () => {
  it('refuses to remove the last remaining workspace', () => {
    expect(removeNamedWorkspace([pair[0]], 'a', 'a')).toBeNull()
    expect(removeNamedWorkspace([], '', 'a')).toBeNull()
  })

  it('hands the active flag to the right neighbour when the active one is removed', () => {
    const next = removeNamedWorkspace(pair, 'a', 'a')
    expect(next?.workspaces.map(workspace => workspace.id)).toEqual(['b'])
    expect(next?.activeId).toBe('b')
  })

  it('falls back to the previous workspace when the tail entry is removed', () => {
    const three = [...pair, { id: 'c', name: '工作区 C' }]
    const next = removeNamedWorkspace(three, 'c', 'c')
    expect(next?.workspaces.map(workspace => workspace.id)).toEqual(['a', 'b'])
    expect(next?.activeId).toBe('b')
  })

  it('keeps the active workspace when a different entry is removed', () => {
    const next = removeNamedWorkspace(pair, 'b', 'a')
    expect(next?.workspaces.map(workspace => workspace.id)).toEqual(['b'])
    expect(next?.activeId).toBe('b')
  })

  it('returns null for an unknown id', () => {
    expect(removeNamedWorkspace(pair, 'a', 'missing')).toBeNull()
  })

  it('removes only one entry when all ids are identical', () => {
    const next = removeNamedWorkspace([{ id: 'x', name: 'A' }, { id: 'x', name: 'B' }], 'x', 'x')
    expect(next?.workspaces.length).toBe(1)
    expect(next?.workspaces[0].name).toBe('B')
    expect(next?.activeId).toBe('x')
  })

  it('removes only one entry when two ids are duplicated', () => {
    const next = removeNamedWorkspace(
      [{ id: 'x', name: 'X' }, { id: 'y', name: 'Y' }, { id: 'x', name: 'X2' }],
      'y',
      'x',
    )
    expect(next?.workspaces.map(workspace => workspace.id)).toEqual(['y', 'x'])
    expect(next?.activeId).toBe('y')
  })
})

describe('isNamedWorkspace', () => {
  it('accepts a workspace with a non-empty id and name', () => {
    expect(isNamedWorkspace({ id: 'a', name: 'n' })).toBe(true)
  })

  it('rejects an empty id', () => {
    expect(isNamedWorkspace({ id: '', name: 'n' })).toBe(false)
  })

  it('rejects a missing name', () => {
    expect(isNamedWorkspace({ id: 'a' })).toBe(false)
  })

  it('rejects null', () => {
    expect(isNamedWorkspace(null)).toBe(false)
  })

  it('rejects a string', () => {
    expect(isNamedWorkspace('a')).toBe(false)
  })

  it('rejects a non-string name', () => {
    expect(isNamedWorkspace({ id: 'a', name: 1 })).toBe(false)
  })
})

describe('WorkspaceList', () => {
  function mountList(workspaces: NamedWorkspace[], activeId: string) {
    return mount(WorkspaceList, {
      props: {
        workspaces,
        activeId,
        createLabel: '新建工作区',
        keepOneHint: '至少保留一个工作区',
      },
    })
  }

  it('renders every workspace and highlights the active one', () => {
    const wrapper = mountList(pair, 'b')
    const rows = wrapper.findAll('button').filter(button => button.text().includes('工作区'))
    expect(rows.map(row => row.text())).toEqual(['工作区 A', '工作区 B'])
    expect(rows[1].classes()).toContain('bg-accent')
    expect(rows[0].classes()).not.toContain('bg-accent')
  })

  it('emits select with the clicked workspace id', async () => {
    const wrapper = mountList(pair, 'a')
    const row = wrapper.findAll('button').find(button => button.text().includes('工作区 B'))
    await row!.trigger('click')
    expect(wrapper.emitted('select')).toEqual([['b']])
  })

  it('emits create from the header button', async () => {
    const wrapper = mountList(pair, 'a')
    await wrapper.find('button[aria-label="新建工作区"]').trigger('click')
    expect(wrapper.emitted('create')).toEqual([[]])
  })

  it('emits remove with the workspace id', async () => {
    const wrapper = mountList(pair, 'a')
    await wrapper.find('button[aria-label="删除工作区 B"]').trigger('click')
    expect(wrapper.emitted('remove')).toEqual([['b']])
  })

  it('opens rename from the workspace context menu and emits the new name', async () => {
    const wrapper = mountList(pair, 'a')
    const row = wrapper.findAll('.group').find(item => item.text().includes('工作区 B'))
    expect(row).toBeDefined()

    await row!.trigger('contextmenu')
    await row!.find('[role="menuitem"]').trigger('click')

    const input = row!.find('input[aria-label="重命名工作区 B"]')
    expect(input.exists()).toBe(true)
    await input.setValue('新的工作区')
    await input.trigger('keydown.enter')

    expect(wrapper.emitted('rename')).toEqual([['b', '新的工作区']])
  })

  it('disables removal when a single workspace is left', () => {
    const wrapper = mountList([pair[0]], 'a')
    const removeButton = wrapper.find('button[aria-label="至少保留一个工作区"]')
    expect(removeButton.exists()).toBe(true)
    expect(removeButton.attributes('disabled')).toBeDefined()
    expect(removeButton.classes()).toContain('disabled:cursor-not-allowed')
  })
})

describe('workspace sidebar parity', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders the shared list in both sidebars', () => {
    const imagio = mount(ImagioSidebar, {
      props: { imageMode: 'imagio', historyImages: [], hasGeneratedImages: false },
    })
    const canvas = mount(ImageCanvasSidebar, {
      props: {
        activeWorkspace: 'canvas',
        imageMode: 'canvas',
        workspaces: pair,
        activeWorkspaceId: 'a',
        miniMapLayout: { connections: [], nodes: [], viewport: null },
        historyImages: [],
        hasGeneratedImages: false,
      },
    })
    expect(imagio.findComponent(WorkspaceList).exists()).toBe(true)
    expect(canvas.findComponent(WorkspaceList).exists()).toBe(true)
    expect(imagio.find('button[aria-label="新建工作区"]').exists()).toBe(true)
    expect(canvas.find('button[aria-label="新建画布"]').exists()).toBe(true)
  })

  it('deletes an Imagio workspace and persists the neighbour as active', async () => {
    localStorage.setItem('imagio-workspaces', JSON.stringify(pair))
    localStorage.setItem('imagio-active-workspace', 'a')

    const wrapper = mount(ImagioSidebar, {
      props: { imageMode: 'imagio', historyImages: [], hasGeneratedImages: false },
      attachTo: document.body,
    })

    await wrapper.find('button[aria-label="删除工作区 A"]').trigger('click')
    await nextTick()

    const confirm = Array.from(document.body.querySelectorAll('button'))
      .find(button => button.textContent?.trim() === '删除')
    expect(confirm).toBeDefined()
    confirm!.click()
    await nextTick()

    expect(JSON.parse(localStorage.getItem('imagio-workspaces')!)).toEqual([pair[1]])
    expect(localStorage.getItem('imagio-active-workspace')).toBe('b')
    expect(wrapper.findAll('button').some(button => button.text().includes('工作区 A'))).toBe(false)
  })

  it('drops persisted workspaces with an empty id', () => {
    localStorage.setItem('imagio-workspaces', JSON.stringify([
      { id: 'a', name: '工作区 A' },
      { id: '', name: '坏工作区' },
    ]))
    localStorage.setItem('imagio-active-workspace', 'a')

    const wrapper = mount(ImagioSidebar, {
      props: { imageMode: 'imagio', historyImages: [], hasGeneratedImages: false },
    })

    expect(wrapper.text()).not.toContain('坏工作区')
    expect(wrapper.text()).toContain('工作区 A')
  })

  it('falls back to a single default workspace when persisted data is all invalid', () => {
    localStorage.setItem('imagio-workspaces', JSON.stringify([
      { id: '', name: '坏工作区' },
    ]))

    const wrapper = mount(ImagioSidebar, {
      props: { imageMode: 'imagio', historyImages: [], hasGeneratedImages: false },
    })

    const keepOne = wrapper.find('button[aria-label="至少保留一个工作区"]')
    expect(keepOne.exists()).toBe(true)
    expect(keepOne.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('新工作区')
  })
})
