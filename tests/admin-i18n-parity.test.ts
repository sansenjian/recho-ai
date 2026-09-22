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
  return [...panels, adminViewPath, adminFormatPath]
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

describe('admin i18n parity', () => {
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
   * `t(\`settings.${cond ? 'a' : 'b'}\`)` picks its tail at runtime; only the ternary
   * branches are translation keys (the identifiers before `?` are form field names).
   * Same reasoning as above: the static scan is blind to these.
   */
  it('resolves keys chosen by a ternary inside a template literal', () => {
    const offenders: string[] = []
    let checked = 0
    for (const file of adminSourceFiles()) {
      const source = stripComments(readFileSync(file, 'utf8'))
      for (const match of source.matchAll(/\bt\(\s*`([A-Za-z0-9_.]+)\$\{([^`]*)`/g)) {
        const prefix = match[1]
        for (const tail of [...match[2].matchAll(/[?:]\s*'([A-Za-z0-9_]+)'/g)].map(m => m[1])) {
          checked++
          const key = `${prefix}${tail}`
          if (!zhKeySet.has(key) || !enKeySet.has(key)) {
            offenders.push(`${key} (${file.slice(root.length + 1)})`)
          }
        }
      }
    }

    expect(checked).toBeGreaterThan(0)
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
    const scanned = adminSourceFiles().filter(file => file !== adminFormatPath)
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
