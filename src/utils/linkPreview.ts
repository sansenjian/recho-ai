export interface LinkPreview {
  url: string
  title: string
  summary: string
  hostname: string
}

const MARKDOWN_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/i
const PLAIN_LINK_RE = /https?:\/\/[^\s<>()]+/i

function trimUrl(url: string) {
  return url.replace(/[.,!?;:'"\]}\u3002\uff0c\uff01\uff1f\uff1b\uff1a]+$/g, '')
}

function cleanText(value: string) {
  return value
    .replace(/\[([^\]]+)\]\(https?:\/\/[^\s)]+\)/g, '$1')
    .replace(/https?:\/\/[^\s<>()]+/gi, '')
    .replace(/[`*_>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function extractLinkPreview(content: string): LinkPreview | null {
  const markdownMatch = content.match(MARKDOWN_LINK_RE)
  const plainMatch = content.match(PLAIN_LINK_RE)
  const url = trimUrl(markdownMatch?.[2] || plainMatch?.[0] || '')
  if (!url) return null

  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) return null
    const title = markdownMatch?.[1]?.trim() || parsed.hostname.replace(/^www\./, '')
    const summary = cleanText(content).slice(0, 120)
    return {
      url,
      title: title || parsed.hostname,
      summary: summary || parsed.hostname,
      hostname: parsed.hostname,
    }
  } catch {
    return null
  }
}
