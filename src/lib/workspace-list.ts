export interface NamedWorkspace {
  id: string
  name: string
}

export interface NamedWorkspaceRemoval {
  workspaces: NamedWorkspace[]
  activeId: string
}

/**
 * 从工作区列表中移除一项，并选出新的活动工作区。
 *
 * 与画布的 `removeCanvasWorkspace` 保持同一套语义（Imagio 与画布共用侧栏渲染层，
 * 行为也必须共用）：
 * - 只剩一项时拒绝删除，返回 null，由调用方决定是否给出提示
 * - 被删的正是当前活动项时，优先接管它右侧的邻居，越界则回退到最后一个
 * - 被删的不是活动项时，活动项保持不变
 */
export function removeNamedWorkspace(
  workspaces: NamedWorkspace[],
  activeId: string,
  removeId: string,
): NamedWorkspaceRemoval | null {
  if (workspaces.length <= 1) return null

  const index = workspaces.findIndex(workspace => workspace.id === removeId)
  if (index < 0) return null

  const next = workspaces.filter(workspace => workspace.id !== removeId)
  const nextActiveId = activeId === removeId
    ? next[Math.min(index, next.length - 1)]?.id ?? next[0].id
    : activeId

  return { workspaces: next, activeId: nextActiveId }
}
