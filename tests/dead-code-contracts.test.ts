import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 已清理的死代码不要复活。
 *
 * 这些声明此前被声明后从未被读取：冗余 import、替代后忘了删的旧函数、
 * 只在模板 ref 里挂着但逻辑改走 querySelector 的 ref。`vue-tsc` 的默认配置
 * 不开 noUnusedLocals（tsconfig.app.json 里显式设为 false），所以它们能安静地
 * 待在仓库里——只有人手动加参数跑一次才看得见。
 *
 * 与其依赖下次有人想起来跑那个命令，不如在这里钉住：这些名字一旦回到对应文件
 * 里，用例就会失败，并把原因说清楚。
 *
 * 这里只锁「确实删干净了」的那批。shadcn 生成在 src/components/ui/ 下的样板
 * 不在此列——那是上游代码，改了会在下次同步时被覆盖。
 */
function readSource(relativePath: string) {
  return readFileSync(resolve(__dirname, '..', relativePath), 'utf8')
}

describe('removed dead declarations stay removed', () => {
  it('keeps unused imports out of the components they were dropped from', () => {
    const cases: Array<[string, string, RegExp]> = [
      // 用词边界而非子串：'Type' 会匹配到 CanvasNodeType，'cn' 会匹配到 cn 开头的
      // 任何标识符，按子串判断会误报。
      ['src/components/AgentWorkspace.vue', 'ScrollArea', /\bScrollArea\b/],
      ['src/components/ChatMessage.vue', 'cn', /[^A-Za-z0-9_$]cn[^A-Za-z0-9_$]/],
      ['src/components/ChatSidebar.vue', 'Palette', /\bPalette\b/],
      ['src/components/ImageCanvas.vue', 'Badge', /\bBadge\b/],
      ['src/components/ImageCanvasContextMenu.vue', 'Type', /\bType\b/],
      ['src/components/ImagioView.vue', 'previewImageUrl', /\bpreviewImageUrl\b/],
      ['src/components/ImagioView.vue', 'fetchAuthenticatedImageObjectUrl', /\bfetchAuthenticatedImageObjectUrl\b/],
      ['src/components/ImagioSidebar.vue', 'useAuthSession', /\buseAuthSession\b/],
    ]

    for (const [file, symbol, pattern] of cases) {
      const source = readSource(file)
      expect(pattern.test(source), `${file} should not reference ${symbol} again`).toBe(false)
    }
  })

  it('keeps the replaced canvas helpers deleted', () => {
    const canvas = readSource('src/components/ImageCanvas.vue')

    // 下划线前缀的函数当时就是被 pasteDocumentNodeFromClipboard 取代的旧版本；
    // 上下文菜单绑定的是后者（见 pasteNodeFromClipboard: pasteDocumentNodeFromClipboard）。
    expect(canvas.includes('_pasteNodeFromClipboard')).toBe(false)
    expect(canvas.includes('pasteDocumentNodeFromClipboard')).toBe(true)

    // 同类预加载函数中唯一没接线的一个：生图/查看器两条都有调用点，节点这条没有。
    expect(canvas.includes('preloadNodeImageDownload')).toBe(false)
    expect(canvas.includes('preloadGeneratedImageDownload')).toBe(true)
    expect(canvas.includes('preloadViewerImageDownload')).toBe(true)
  })

  it('keeps the replaced gallery and supabase helpers deleted', () => {
    const gallery = readSource('src/lib/image-gallery.ts')
    // 这两个是 imageSourceUrl 的薄封装，重构后没有调用点了。
    expect(gallery.includes('displayImageUrl')).toBe(false)
    expect(gallery.includes('displayReferenceUrl')).toBe(false)
    // 真正的取图入口仍在，且被别处使用。
    expect(gallery.includes('previewImageUrl')).toBe(true)

    // 测试改用 vi.resetModules() 重置模块，这个专用钩子没有调用点了。
    const supabase = readSource('src/lib/supabase.ts')
    expect(supabase.includes('resetSupabaseClientForTests')).toBe(false)
  })

  it('keeps the unused presign request field deleted', () => {
    // 请求体里声明过 `mode`，但 handler 从未读取它，前端也没传；两个仓库层面
    // 都没有引用，属纯死字段。
    const handler = readFileSync(
      resolve(__dirname, '..', 'backend/go-gateway/internal/handler/image.go'),
      'utf8',
    )
    const presignBlock = handler.slice(
      handler.indexOf('func (h *ImageHandler) PresignStorage'),
      handler.indexOf('func (h *ImageHandler) ProxyStorage'),
    )

    expect(presignBlock.length).toBeGreaterThan(0)
    expect(presignBlock.includes('json:"mode"')).toBe(false)
    // Paths 是在用的那个字段，别把它一起删了。
    expect(presignBlock.includes('json:"paths"')).toBe(true)
  })
})

describe('the unused-declaration scan stays available', () => {
  it('documents that noUnusedLocals is off by default, so the scan needs the flag', () => {
    // tsconfig.app.json 是 JSONC（带注释），不能用 JSON.parse 读；这里直接匹配
    // 源码文本。这条断言是给下一个人看的：默认构建不报未使用声明，
    // 复查要显式加参数：
    //   npx vue-tsc -p tsconfig.app.json --noEmit --noUnusedLocals
    const appConfig = readSource('tsconfig.app.json')
    expect(appConfig).toMatch(/"noUnusedLocals"\s*:\s*false/)
  })

  it('has no leftover underscore-prefixed throwaways in business components', () => {
    // 下划线前缀在本仓库里就是「这个已经不用了」的信号（见 _pasteNodeFromClipboard）。
    // 允许测试文件用下划线忽略参数，业务组件里出现就该清理。
    const offenders: string[] = []
    const componentsDir = resolve(__dirname, '../src/components')

    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) {
          if (full.includes(`${'ui'}`)) continue
          walk(full)
          continue
        }
        if (!name.endsWith('.vue')) continue
        const source = readFileSync(full, 'utf8')
        const matches = source.match(/\n(?:const|function|async function)\s+_[A-Za-z0-9_]+/g) ?? []
        for (const match of matches) offenders.push(`${name}: ${match.trim()}`)
      }
    }
    walk(componentsDir)

    expect(offenders).toEqual([])
  })
})
