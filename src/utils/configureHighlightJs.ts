import hljsCore from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import type { HLJSApi, LanguageFn } from 'highlight.js'

type HighlightLanguageConfig = {
  moduleName: string
  name: string
  definition: LanguageFn
  aliases?: readonly string[]
}

const highlightLanguageConfigs = [
  { moduleName: 'bash', name: 'bash', definition: bash, aliases: ['sh', 'shell', 'zsh', 'powershell', 'ps1'] },
  { moduleName: 'css', name: 'css', definition: css },
  { moduleName: 'javascript', name: 'javascript', definition: javascript, aliases: ['js', 'jsx'] },
  { moduleName: 'json', name: 'json', definition: json },
  { moduleName: 'markdown', name: 'markdown', definition: markdown, aliases: ['md'] },
  { moduleName: 'python', name: 'python', definition: python, aliases: ['py'] },
  { moduleName: 'typescript', name: 'typescript', definition: typescript, aliases: ['ts', 'tsx'] },
  { moduleName: 'xml', name: 'xml', definition: xml },
  // highlight.js 11 ships HTML/SVG support through this grammar, but no Vue module.
  { moduleName: 'xml', name: 'html', definition: xml, aliases: ['svg', 'vue'] },
] as const satisfies readonly HighlightLanguageConfig[]

export const highlightLanguageModuleNames = Array.from(
  new Set(highlightLanguageConfigs.map((language) => language.moduleName)),
)

let configuredHljs: HLJSApi | undefined

export function configureHighlightJs(): HLJSApi {
  if (configuredHljs !== undefined) return configuredHljs

  const hljs = hljsCore.newInstance()
  for (const language of highlightLanguageConfigs) {
    hljs.registerLanguage(language.name, language.definition)
    if ('aliases' in language) {
      hljs.registerAliases(Array.from(language.aliases), { languageName: language.name })
    }
  }

  configuredHljs = hljs
  return configuredHljs
}
