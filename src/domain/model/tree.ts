import type { Project, TaskId } from './types'

/**
 * 取任务所处的**兄弟列表**（顶层任务 → `rootIds`；子任务 → 其父的 `childIds`）。
 *
 * 解析不出时返回 `null`：任务不存在，或它声明的父任务不存在（数据损坏）。
 * 返回的是**树里那个数组本身**（不是副本）——命令层要 `splice` 它。
 *
 * 「谁和谁同级、按什么顺序」**全应用只此一处实现**。此前它有两份镜像：
 * `commands/taskStructureCommands.ts` 的 `siblingList`（判「做不做」）与
 * `ui/shared/outlineActions.ts` 的 `siblingIds`（判「能不能做」）——两处各写一遍，
 * 哪天树结构规则变了必然漂移。现在都委托到这里。
 */
export function siblingIdsOf(project: Project, taskId: TaskId): TaskId[] | null {
  const task = project.tasks[taskId]
  if (!task) return null
  if (task.parentId === null) return project.rootIds
  const parent = project.tasks[task.parentId]
  return parent ? parent.childIds : null
}
