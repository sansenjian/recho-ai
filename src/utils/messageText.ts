export function sanitizeVisibleAssistantText(text: string): string {
  const leakMarkers = [
    /understanding the user's query/i,
    /Final Extract/i,
    /Grundlegend/i,
    /User möchte wissen/i,
    /\banalysis\b/i,
  ]
  if (!leakMarkers.some(marker => marker.test(text))) return text

  return text
    .split(/\r?\n/)
    .map(line => line
      .replace(/^.*understanding the user's query\),?\s*/i, '')
      .replace(/^\s*\[[^\]]*(?:budget|preferences|headphones)[^\]]*\]\s*$/i, '')
      .replace(/\s*\/\/.*$/g, '')
      .replace(/\s*\|\s*Final Extract.*$/i, '')
      .replace(/\s*\|\s*Grundlegend.*$/i, '')
      .replace(/(?:^|[|}])\s*(?:思考|analysis)\s*[:：].*$/i, '')
      .replace(/\b(?:prototype|abstract)\b[^\n]*$/gi, '')
      .replace(/\b556+\b/g, '')
      .replace(/\bGG\b/g, '')
      .trim())
    .filter(Boolean)
    .join('\n')
}

export function stripThinking(text: string): string {
  return sanitizeVisibleAssistantText(text
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, ''))
}

export function extractThinking(text: string): string {
  const parts: string[] = []
  for (const match of text.matchAll(/<thinking>([\s\S]*?)<\/thinking>/gi)) {
    if (match[1]?.trim()) parts.push(match[1].trim())
  }
  for (const match of text.matchAll(/<think>([\s\S]*?)<\/think>/gi)) {
    if (match[1]?.trim()) parts.push(match[1].trim())
  }
  return parts.join('\n\n')
}
