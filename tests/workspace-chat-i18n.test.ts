// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import i18n from '../src/i18n'
import en from '../src/i18n/en'
import zh from '../src/i18n/zh'
import AgentWorkspace from '../src/components/AgentWorkspace.vue'
import WorkspaceList from '../src/components/WorkspaceList.vue'
import { AGENT_MODES, AVAILABLE_MODELS } from '../src/types'

/**
 * 对话页的文案有两层容易静默退化:
 *
 * 1. `chat.*` 的 zh/en 键集合不同步 —— 缺失的那侧会把原始 key 路径直接渲染出来。
 * 2. `types.ts` 的模型/模式目录用 `hintKey` / `levelKey` 存放 **运行时才解析** 的键,
 *    静态扫描(admin-i18n-parity 的 `t('...')` 正则)看不到它们,写错 key 不会有任何报错,
 *    只会让界面上少一行小字。
 *
 * 因此这里显式解析目录里的每个 key,并要求 locale 切换后组件真的换语言。
 */

type MessageTree = { [key: string]: string | MessageTree }

function flatten(tree: MessageTree, prefix = ""): string[] {
  const keys: string[] = []
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? prefix + "." + key : key
    if (typeof value === "string") keys.push(path)
    else keys.push(...flatten(value, path))
  }
  return keys.sort()
}

const resolveMessage = i18n.global.t as unknown as (key: string) => string

const zhChatKeys = flatten((zh as unknown as { chat: MessageTree }).chat, "chat")
const enChatKeys = flatten((en as unknown as { chat: MessageTree }).chat, "chat")
const zhChatKeySet = new Set(zhChatKeys)
const enChatKeySet = new Set(enChatKeys)

/** types.ts 里所有「延迟解析」的 i18n 键。 */
function catalogKeys(): Array<{ key: string; owner: string }> {
  const keys: Array<{ key: string; owner: string }> = []
  for (const mode of AGENT_MODES) {
    if (mode.hintKey) keys.push({ key: mode.hintKey, owner: "AGENT_MODES." + mode.id })
  }
  for (const model of AVAILABLE_MODELS) {
    if (model.levelKey) keys.push({ key: model.levelKey, owner: "AVAILABLE_MODELS." + model.id })
    if (model.hintKey) keys.push({ key: model.hintKey, owner: "AVAILABLE_MODELS." + model.id })
  }
  return keys
}

afterEach(() => {
  i18n.global.locale.value = "zh"
})

describe("workspace chat page i18n", () => {
  it("keeps the chat namespace in sync across locales", () => {
    const missingInEn = zhChatKeys.filter(key => !enChatKeySet.has(key))
    const missingInZh = enChatKeys.filter(key => !zhChatKeySet.has(key))
    expect({ missingInEn, missingInZh }).toEqual({ missingInEn: [], missingInZh: [] })
    expect(zhChatKeys.length).toBeGreaterThan(0)
  })

  it("resolves every catalog key declared in types.ts", () => {
    const keys = catalogKeys()
    expect(keys.length).toBeGreaterThan(0)

    const unresolved = keys.filter(({ key }) => {
      const value = resolveMessage(key)
      return !value || value === key
    })
    expect(unresolved).toEqual([])
  })

  it("renders the agent workspace labels in the active locale", async () => {
    const wrapper = mount(AgentWorkspace, {
      props: {
        modes: AGENT_MODES,
        activeMode: AGENT_MODES[1],
        skills: [],
        activeSkill: null,
        activeToolCalls: [],
        completedToolCalls: [],
      },
      global: { plugins: [i18n] },
    })

    i18n.global.locale.value = "zh"
    await wrapper.vm.$nextTick()
    const chinese = wrapper.text()
    expect(chinese).toContain("模式")
    expect(chinese).toContain("技能")
    expect(chinese).toContain("工具流")
    expect(chinese).toContain("暂无工具调用")
    expect(chinese).toContain("实现、调试、审查")

    i18n.global.locale.value = "en"
    await wrapper.vm.$nextTick()
    const english = wrapper.text()
    expect(english).toContain("Mode")
    expect(english).toContain("Skills")
    expect(english).toContain("Tool stream")
    expect(english).toContain("No tool calls yet")
    expect(english).toContain("Implement, debug, review")

    wrapper.unmount()
  })

  it("falls back to a localized title in the workspace list", async () => {
    const wrapper = mount(WorkspaceList, {
      props: {
        workspaces: [{ id: "a", name: "Alpha" }],
        activeId: "a",
        createLabel: "New workspace",
        keepOneHint: "Keep one workspace",
      },
      global: { plugins: [i18n] },
    })

    i18n.global.locale.value = "zh"
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain("工作区")

    i18n.global.locale.value = "en"
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain("Workspace")

    wrapper.unmount()
  })
})
