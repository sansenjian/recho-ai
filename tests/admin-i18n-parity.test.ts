// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import i18n from '../src/i18n'
import { attemptStatusLabel, imageVisibilityLabel } from '../src/utils/admin-format'
import en from '../src/i18n/en'
import zh from '../src/i18n/zh'

/**
 * Guards the admin console against the two ways its copy drifts:
 *
 * 1. `zh` and `en` fall out of sync, so a key that exists in one locale renders
 *    as a raw key path in the other.
 * 2. A panel grows a hardcoded literal, so the admin console shows mixed
 *    languages while `nav.*` / `common.*` stay translated.
 *
 * Admin copy is deliberately centralised in `src/i18n`; the Chinese inline in
 * code comments is fine (and common across this repo) — only user-visible
 * strings are checked.
 */

const root = process.cwd()
const adminDir = resolve(root, 'src/components/admin')
const adminViewPath = resolve(root, 'src/views/AdminView.vue')
const adminFormatPath = resolve(root, 'src/utils/admin-format.ts')
/**
 * Composable 层曾经是这个门禁的盲区：useAdminAccess 用原始 publicClientErrorMessage
 * 配硬编码中文兜底，却因为不在扫描范围内而一路通过。这里把它们纳入检查。
 */
const adminComposablePaths = [
  resolve(root, 'src/composables/useAdminAccess.ts'),
  resolve(root, 'src/composables/useAdminApi.ts'),
]
/**
 * 账号弹窗与用户自助密钥同样面向用户,并且已经从纯中文改为 i18n;
 * 不纳入扫描的话,它们会重新长出硬编码中文而无人发现。
 */
const accountSourcePaths = [
  resolve(root, 'src/components/AuthPanel.vue'),
  resolve(root, 'src/components/UserApiKeys.vue'),
  resolve(root, 'src/components/UserApiKeysDialog.vue'),
  resolve(root, 'src/composables/useAuthSession.ts'),
  resolve(root, 'src/composables/useCredits.ts'),
]
/**
 * 工作台对话页:ChatHeader/ChatInput/... 已从写死中文改为 i18n,AppShell 是它们的宿主。
 * 漏掉这一组,对话页会重新长出硬编码中文而门禁无感。
 * 注意 WorkspaceList 的调用方(ImagioSidebar / ImageCanvasSidebar)自身仍有中文,故只扫描 WorkspaceList 本身。
 */
const chatSourcePaths = [
  resolve(root, 'src/views/AppShell.vue'),
  resolve(root, 'src/components/ChatHeader.vue'),
  resolve(root, 'src/components/ChatInput.vue'),
  resolve(root, 'src/components/ChatMessage.vue'),
  resolve(root, 'src/components/ChatMessageRail.vue'),
  resolve(root, 'src/components/ChatSidebar.vue'),
  resolve(root, 'src/components/StreamingStatus.vue'),
  resolve(root, 'src/components/ThinkingActivity.vue'),
  resolve(root, 'src/components/ToolActivity.vue'),
  resolve(root, 'src/components/ContextMeter.vue'),
  resolve(root, 'src/components/LinkPreviewCard.vue'),
  resolve(root, 'src/components/AgentWorkspace.vue'),
  resolve(root, 'src/components/WorkspaceList.vue'),
]
/** 本地化错误门面:与 admin-format.ts 一样,它是唯一允许直接调用 publicClientErrorMessage 的地方。 */
const clientErrorMessagePath = resolve(root, 'src/utils/client-error-message.ts')

type MessageTree = { [key: string]: string | MessageTree }

function flatten(tree: MessageTree, prefix = ''): string[] {
  const keys: string[] = []
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') keys.push(path)
    else keys.push(...flatten(value, path))
  }
  return keys.sort()
}

const zhKeys = flatten(zh as unknown as MessageTree)
const enKeys = flatten(en as unknown as MessageTree)
const zhKeySet = new Set(zhKeys)
const enKeySet = new Set(enKeys)

function adminSourceFiles(): string[] {
  const panels = readdirSync(adminDir)
    .filter(name => name.endsWith('.vue'))
    .map(name => join(adminDir, name))
  return [
    ...panels,
    adminViewPath,
    adminFormatPath,
    ...adminComposablePaths,
    ...accountSourcePaths,
    ...chatSourcePaths,
  ]
}

/**
 * Drops whole-line comments and HTML comments. Only whole-line JS comments are
 * removed on purpose: a trailing `//` inside a string (e.g. a URL) must stay.
 */
function stripComments(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .split(/\r?\n/)
    .map(line => {
      const trimmed = line.trim()
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return ''
      return line
    })
    .join('\n')
}

describe('admin and account i18n parity', () => {
  it('exposes the same key set in zh and en', () => {
    const missingInEn = zhKeys.filter(key => !enKeySet.has(key))
    const missingInZh = enKeys.filter(key => !zhKeySet.has(key))
    expect({ missingInEn, missingInZh }).toEqual({ missingInEn: [], missingInZh: [] })
  })

  it('resolves every statically referenced t() key in both locales', () => {
    const referenced = new Map<string, string>()
    for (const file of adminSourceFiles()) {
      const source = stripComments(readFileSync(file, 'utf8'))
      for (const match of source.matchAll(/\bt\(\s*'([A-Za-z0-9_.]+)'/g)) {
        if (!referenced.has(match[1])) {
          referenced.set(match[1], file.slice(root.length + 1))
        }
      }
    }

    expect(referenced.size).toBeGreaterThan(0)
    const unresolved = [...referenced.entries()]
      .filter(([key]) => !zhKeySet.has(key) || !enKeySet.has(key))
      .map(([key, file]) => `${key} (${file})`)
    expect(unresolved).toEqual([])
  })

  /**
   * `t(\`nav.${activeView}\`)` and `t(item.labelKey)` build their key at runtime, so
   * the static scan above cannot see them — and unlike `credits.transactionReason.*`
   * there is no fallback, meaning a missing key renders the raw path in the sidebar.
   * Candidates are derived from `navItems` so that adding a nav entry without a
   * translation fails here instead of in the UI.
   */
  it('resolves nav keys derived from AdminView navItems', () => {
    const source = readFileSync(adminViewPath, 'utf8')
    const navBlock = source.match(/const navItems[^=]*=\s*\[([\s\S]*?)\n\]/)?.[1] ?? ''
    const ids = [...navBlock.matchAll(/\bid:\s*'([^']+)'/g)].map(m => m[1])
    const labelKeys = [...navBlock.matchAll(/\blabelKey:\s*'([^']+)'/g)].map(m => m[1])

    expect(ids.length).toBeGreaterThan(0)
    expect(labelKeys.length).toBe(ids.length)

    const candidates = new Set<string>([...ids.map(id => `nav.${id}`), ...labelKeys])
    const unresolved = [...candidates].filter(key => !zhKeySet.has(key) || !enKeySet.has(key))
    expect(unresolved).toEqual([])
  })

  /**
   * `t(\`nav.${activeView}\`)` 这类前缀由运行时决定，静态扫描看不见，也没有 fallback，
   * 少一个 key 就会把路径原样渲染到界面上。
   *
   * 这里不要求某种写法必须存在——曾经断言过的是「三元表达式」这一具体形式，组件改用
   * 数据驱动渲染后它就恒为 0，测试随之失去意义。改成检查所有这类拼接的**前缀**：前缀
   * 在 zh/en 里都必须是一棵存在的子树，写错前缀会在这里失败。
   */
  it('resolves runtime-built keys by checking their literal prefix exists', () => {
    const offenders: string[] = []
    const checkedPrefixes = new Set<string>()
    for (const file of adminSourceFiles()) {
      const source = stripComments(readFileSync(file, 'utf8'))
      for (const match of source.matchAll(/\bt\(\s*`([A-Za-z0-9_.]+)\$\{/g)) {
        const prefix = match[1]
        checkedPrefixes.add(prefix)
        // 前缀本身必须能解析出至少一个 key，否则拼出来的路径一定渲染不出来。
        const known = [...zhKeySet].some(key => key.startsWith(prefix))
        if (!known) {
          offenders.push(`${prefix}* (${file.slice(root.length + 1)})`)
        }
      }
    }

    expect(checkedPrefixes.size).toBeGreaterThan(0)
    expect(offenders).toEqual([])
  })

  /**
   * The shared `publicClientErrorMessage` classifies the failure but words the
   * timeout / network / upstream branches in Chinese, so calling it from a panel
   * leaks Chinese into the English console. `admin-format.ts` is the facade that
   * calls it deliberately (and localizes the categories); panels must use
   * `adminErrorMessage`.
   */
  it('routes admin error messages through the localized helper', () => {
    const allowed = new Set([adminFormatPath, clientErrorMessagePath])
    const scanned = adminSourceFiles().filter(file => !allowed.has(file))
    expect(scanned.length).toBeGreaterThan(0)

    const offenders = scanned
      .filter(file => /\bpublicClientErrorMessage\b/.test(stripComments(readFileSync(file, 'utf8'))))
      .map(file => file.slice(root.length + 1))
    expect(offenders).toEqual([])
  })

  it('keeps user-visible admin copy free of hardcoded Chinese', () => {
    // The language toggle labels the *other* locale in its own script, so the
    // native name is intentional rather than an untranslated string.
    const intentionalLiterals = ["'中文'"]

    const offenders: string[] = []
    for (const file of adminSourceFiles()) {
      const source = stripComments(readFileSync(file, 'utf8'))
      source.split(/\r?\n/).forEach((line, index) => {
        let probe = line
        for (const literal of intentionalLiterals) probe = probe.split(literal).join('')
        if (/[\u4e00-\u9fff]/.test(probe)) {
          offenders.push(`${file.slice(root.length + 1)}:${index + 1}: ${line.trim().slice(0, 140)}`)
        }
      })
    }

    expect(offenders).toEqual([])
  })
})

/**
 * `src/utils/admin-format.ts` resolves labels through the *app's* i18n instance
 * rather than an injected `t`, so its call sites stay unchanged. That only works
 * if a render reading those labels tracks the locale ref — otherwise every
 * table would keep its original language after a language switch.
 */
describe('admin-format labels follow the active locale', () => {
  const Harness = defineComponent({
    name: 'AdminFormatHarness',
    setup() {
      return () => h('span', `${imageVisibilityLabel('private')}|${attemptStatusLabel('succeeded')}`)
    },
  })

  afterEach(() => {
    i18n.global.locale.value = 'zh'
  })

  it('re-renders a mounted consumer when the locale switches', async () => {
    const wrapper = mount(Harness, { global: { plugins: [i18n] } })

    i18n.global.locale.value = 'zh'
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toBe('已隐藏|成功')

    i18n.global.locale.value = 'en'
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toBe('Hidden|Succeeded')

    wrapper.unmount()
  })
})
