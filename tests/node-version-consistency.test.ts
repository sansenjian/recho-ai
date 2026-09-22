import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

/**
 * node 版本此前散落在三处、彼此毫无关联：`.nvmrc`（本地开发）、
 * `.github/workflows/*.yml` 的 `node-version`（CI）、`package.json` 的
 * `engines.node`（契约）。任何一处单独更新都会静默漂移，后果是
 * 「本地能跑、CI 装不上」这类只在流水线上才暴露的问题。
 *
 * 本仓库还多一条特殊约束：npm 10（node 22 自带）无法求解本仓库 lockfile 的
 * 依赖图（arborist `reading 'edgesOut'` 崩溃），只有 npm 11（node 24 自带）
 * 可以 ⇒ node 大版本不能随意回退。
 *
 * 所以这里把三者钉在一起：改任何一处而另两处没跟上，立刻变红。
 */
function majorOf(version: string): string {
  const m = version.trim().match(/(\d+)/)
  if (!m) throw new Error(`no major version in "${version}"`)
  return m[1]
}

const nvmrcRaw = readFileSync(resolve(root, '.nvmrc'), 'utf8')
const nvmrcMajor = majorOf(nvmrcRaw)

describe('node version consistency', () => {
  it('.nvmrc pins a concrete major version', () => {
    expect(nvmrcRaw.trim()).toMatch(/^\d+(\.\d+)*$/)
  })

  it('every workflow pins the same major as .nvmrc', () => {
    const dir = resolve(root, '.github/workflows')
    const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))
    expect(files.length).toBeGreaterThan(0)

    const pinned: Array<{ file: string; version: string }> = []
    for (const file of files) {
      const text = readFileSync(resolve(dir, file), 'utf8')
      // 只认真正的 `node-version:` 指令行；注释行以 # 开头，不会命中。
      for (const m of text.matchAll(/^[ \t]*node-version:[ \t]*['"]?([^'"\s#]+)/gm)) {
        pinned.push({ file, version: m[1] })
      }
    }
    // 样本数 > 0：本仓库目前有两个 workflow 声明 node-version。
    // 若哪天全部移除，这条断言必须失败，而不是空跑通过。
    expect(pinned.length).toBeGreaterThan(0)

    for (const { file, version } of pinned) {
      expect(majorOf(version), `${file} pins node ${version}`).toBe(nvmrcMajor)
    }
  })

  it('package.json engines.node admits the .nvmrc major', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      engines?: { node?: string }
    }
    const engines = pkg.engines?.node
    expect(engines, 'package.json must declare engines.node').toBeTruthy()

    const m = String(engines).match(/>=[ \t]*(\d+)/)
    expect(m, `engines.node "${engines}" must be a ">=N" range`).toBeTruthy()
    expect(Number(nvmrcMajor)).toBeGreaterThanOrEqual(Number(m![1]))
  })

  it('Dockerfile runtime image matches the .nvmrc major', () => {
    const dockerfile = readFileSync(resolve(root, 'Dockerfile'), 'utf8')
    const tags = [...dockerfile.matchAll(/^FROM[ \t]+node:(\d+)/gm)].map((m) => m[1])
    // 样本数 > 0：Dockerfile 有三个 node stage。
    expect(tags.length).toBeGreaterThan(0)
    for (const tag of tags) {
      expect(tag).toBe(nvmrcMajor)
    }
  })
})
