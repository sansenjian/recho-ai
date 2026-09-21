export interface NamedWorkspace {
  id: string
  name: string
}

export interface NamedWorkspaceRemoval {
  workspaces: NamedWorkspace[]
  activeId: string
}

/**
 * 判断一个值是否是合法的命名工作区。
 *
 * id 为空字符串时，条目虽然能渲染、能被点选，却无法被稳定删除——
 * 确认删除按钮用的是真值判断，`''` 是 falsy，点了没反应；而对话框开关用的是
 * `!== null`，又能打开。所以必须在入口就拒掉空 id，避免这种「能开不能删」的死状态。
 */
export function isNamedWorkspace(value: unknown): value is NamedWorkspace {
  if (typeof value !== 'object' || value === null) return false
  if (!('id' in value) || !('name' in value)) return false
  return typeof value.id === 'string' && value.id.length > 0 && typeof value.name === 'string'
}

/**
 * 从工作区列表中移除一项，并选出新的活动工作区。
 *
 * 与画布的 `removeCanvasWorkspace` 保持同一套语义（Imagio 与画布共用侧栏渲染层，
 * 行为也必须共用）：
 * - 只剩一项时拒绝删除，返回 null，由调用方决定是否给出提示
 * - 被删的正是当前活动项时，优先接管它右侧的邻居，越界则回退到最后一个
 * - 被删的不是活动项时，活动项保持不变
 * - 按位置删除；id 重复时按 id 过滤会一次删掉多项，全部同 id 时会清空列表并让后继索引访问抛错
 */
export function removeNamedWorkspace(
  workspaces: NamedWorkspace[],
  activeId: string,
  removeId: string,
): NamedWorkspaceRemoval | null {
  if (workspaces.length <= 1) return null

  const index = workspaces.findIndex(workspace => workspace.id === removeId)
  if (index < 0) return null

  // 按位置删除，而不是按 id 过滤：id 重复时按 id 过滤会一次删掉多项，
  // 全部同 id 时更会清空列表并让下面的索引访问越界抛错。
  const next = [...workspaces.slice(0, index), ...workspaces.slice(index + 1)]
  const nextActiveId = activeId === removeId
    ? next[Math.min(index, next.length - 1)].id
    : activeId

  return { workspaces: next, activeId: nextActiveId }
}
