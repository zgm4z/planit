import type { Project, TaskId } from '../../domain/model/types'

export interface FlatRow {
  taskId: TaskId
  depth: number
  hasChildren: boolean
  collapsed: boolean
}

/**
 * 把任务树按前序遍历压成扁平行，跳过被折叠节点的子树。
 *
 * 左侧任务表和右侧甘特图消费的是**同一份数组**，
 * 这是两侧行永远对齐的根本保证 —— 不要在任何一侧重新遍历树。
 *
 * 前提：childIds 构成一棵树（无环）。树形不变量由命令层保证。
 */
export function flattenVisibleRows(
  project: Project,
  collapsedIds: ReadonlySet<TaskId>,
): FlatRow[] {
  const rows: FlatRow[] = []

  const visit = (taskId: TaskId, depth: number): void => {
    const task = project.tasks[taskId]
    if (!task) return

    const hasChildren = task.childIds.length > 0
    const collapsed = hasChildren && collapsedIds.has(taskId)

    rows.push({ taskId, depth, hasChildren, collapsed })

    if (!collapsed) {
      for (const childId of task.childIds) visit(childId, depth + 1)
    }
  }

  for (const rootId of project.rootIds) visit(rootId, 0)
  return rows
}
