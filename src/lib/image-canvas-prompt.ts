import type { ImageCanvasContext } from '../types/image'
import type { CanvasNode, Connection, InputHandle } from './image-canvas-model'

export function incomingConnections(
  connections: Connection[],
  nodeId: string,
  handle?: InputHandle,
) {
  return connections.filter(conn => (
    conn.toNodeId === nodeId &&
    (!handle || conn.toHandle === handle)
  ))
}

export function getNodeById(nodes: CanvasNode[], nodeId: string) {
  return nodes.find(node => node.id === nodeId)
}

export function connectedTextNodes(
  nodes: CanvasNode[],
  connections: Connection[],
  node: CanvasNode,
) {
  return incomingConnections(connections, node.id, 'prompt-in')
    .map(conn => getNodeById(nodes, conn.fromNodeId))
    .filter((item): item is CanvasNode => Boolean(item && item.type === 'text'))
}

export function connectedImageNodes(
  nodes: CanvasNode[],
  connections: Connection[],
  node: CanvasNode,
) {
  return incomingConnections(connections, node.id, 'reference-in')
    .map(conn => getNodeById(nodes, conn.fromNodeId))
    .filter((item): item is CanvasNode => Boolean(item && item.type === 'image'))
}

export function imageNodesByMention(nodes: CanvasNode[], text: string) {
  const names = new Set<string>()
  const mentionPattern = /@([\u4e00-\u9fa5A-Za-z0-9_-]+)/g
  for (const match of text.matchAll(mentionPattern)) {
    names.add(match[1])
  }
  return nodes.filter(node => (
    node.type === 'image' &&
    Boolean(node.imageUrl) &&
    names.has(node.title)
  ))
}

export function imageNodesByIds(nodes: CanvasNode[], ids: string[] = []) {
  const idSet = new Set(ids)
  return nodes.filter(node => (
    node.type === 'image' &&
    Boolean(node.imageUrl) &&
    idSet.has(node.id)
  ))
}

export function imageNodeForRichToken(nodes: CanvasNode[], id?: string, title?: string) {
  if (id) return imageNodesByIds(nodes, [id])[0] ?? null
  if (!title) return null
  return nodes.find(node => (
    node.type === 'image' &&
    Boolean(node.imageUrl) &&
    node.title === title
  )) ?? null
}

export function imageTokenIds(text: string) {
  const ids: string[] = []
  const tokenPattern = /\{\{image:([^}]+)\}\}/g
  for (const match of text.matchAll(tokenPattern)) {
    ids.push(match[1])
  }
  return ids
}

export function uniqueImageNodes(items: CanvasNode[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

export function mentionedImageNodesForNode(nodes: CanvasNode[], node: CanvasNode) {
  return uniqueImageNodes([
    ...imageNodesByIds(nodes, node.mentions),
    ...imageNodesByIds(nodes, imageTokenIds(node.content)),
    ...imageNodesByMention(nodes, node.content),
  ])
}

export function hasPromptLink(connections: Connection[], node: CanvasNode) {
  return incomingConnections(connections, node.id, 'prompt-in').length > 0
}

export function promptMentionedImageNodesForGeneration(
  nodes: CanvasNode[],
  connections: Connection[],
  node: CanvasNode,
) {
  if (hasPromptLink(connections, node)) {
    return uniqueImageNodes(
      connectedTextNodes(nodes, connections, node)
        .flatMap(item => mentionedImageNodesForNode(nodes, item)),
    )
  }
  return mentionedImageNodesForNode(nodes, node)
}

export function promptTextWithImageLabels(nodes: CanvasNode[], text: string) {
  return text
    .replace(/\{\{image:([^}]+)\}\}/g, (_match, id: string) => imageNodeForRichToken(nodes, id)?.title ?? '')
    .replace(/@([\u4e00-\u9fa5A-Za-z0-9_-]+)/g, (_match, title: string) => imageNodeForRichToken(nodes, undefined, title)?.title ?? title)
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

export function referencedImageNodes(
  nodes: CanvasNode[],
  connections: Connection[],
  node: CanvasNode,
) {
  return uniqueImageNodes([
    ...connectedImageNodes(nodes, connections, node).filter(item => item.imageUrl),
    ...promptMentionedImageNodesForGeneration(nodes, connections, node),
  ])
}

export function getConnectedPrompt(
  nodes: CanvasNode[],
  connections: Connection[],
  node: CanvasNode,
) {
  return connectedTextNodes(nodes, connections, node)
    .map(item => item.content.trim())
    .filter(Boolean)
    .join('\n')
}

export function getGenerationPromptValue(
  nodes: CanvasNode[],
  connections: Connection[],
  node: CanvasNode,
) {
  return hasPromptLink(connections, node)
    ? getConnectedPrompt(nodes, connections, node)
    : node.content
}

export function generationUserPrompt(
  nodes: CanvasNode[],
  connections: Connection[],
  node: CanvasNode,
) {
  const promptText = hasPromptLink(connections, node)
    ? getConnectedPrompt(nodes, connections, node)
    : node.content.trim()
  return promptTextWithImageLabels(nodes, promptText)
}

export function buildSystemPrompt(references: CanvasNode[]) {
  const referenceGuide = references.length
    ? [
      `已上传 ${references.length} 张真实参考图，请严格使用这些参考图，不要只根据文字重新想象。`,
      '提示词中的 图片1、图片2 等名称与下方参考图顺序一一对应。',
      '当提示词要求参考风格时，只迁移该参考图的画风、色彩、质感；当提示词要求主角、角色、姿态或内容时，要保留对应参考图的主体特征。',
    ].join('\n')
    : ''

  const referenceParts = references
    .map((item, index) => {
      const label = item.content.trim()
      return `${item.title}: 第 ${index + 1} 张参考图${label ? `，${label}` : ''}`
    })
    .filter(Boolean)

  return [referenceGuide, ...referenceParts].filter(Boolean).join('\n\n')
}

export function buildPromptParts(
  nodes: CanvasNode[],
  connections: Connection[],
  node: CanvasNode,
) {
  const userPrompt = generationUserPrompt(nodes, connections, node)
  const references = referencedImageNodes(nodes, connections, node)
  const systemPrompt = buildSystemPrompt(references)
  const modelPrompt = [systemPrompt, userPrompt].filter(Boolean).join('\n\n')

  return {
    userPrompt,
    systemPrompt,
    modelPrompt,
  }
}

export function buildCanvasContext(options: {
  canvasId: string
  canvasVersion: number
  nodes: CanvasNode[]
  connections: Connection[]
  node: CanvasNode
  userPrompt: string
}): ImageCanvasContext {
  const imageNodeCount = options.nodes.filter(item => item.type === 'image').length
  const textNodeCount = options.nodes.filter(item => item.type === 'text').length
  const generationNodeCount = options.nodes.filter(item => item.type === 'generation').length
  const connectedReferences = connectedImageNodes(options.nodes, options.connections, options.node)
    .filter(item => item.imageUrl)
  const mentionedReferences = promptMentionedImageNodesForGeneration(
    options.nodes,
    options.connections,
    options.node,
  )

  return {
    canvasId: options.canvasId,
    nodeCount: options.nodes.length,
    connectionCount: options.connections.length,
    imageNodeCount,
    textNodeCount,
    generationNodeCount,
    referenceCount: referencedImageNodes(options.nodes, options.connections, options.node).length,
    mentionedReferenceCount: mentionedReferences.length,
    connectedReferenceCount: connectedReferences.length,
    promptCharCount: options.userPrompt.length,
    hasConnectedPrompt: hasPromptLink(options.connections, options.node),
    canvasVersion: options.canvasVersion,
  }
}
