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
