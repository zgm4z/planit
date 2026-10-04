import type { Project, TaskId } from './types'

/**
 * 返回某任务在树里的**同级兄弟 id 列表**（按树内顺序）。
 * 父级任务 → 它的 `childIds`；根层任务 → `rootIds`；任务不存在 → 空数组。
 *
 * 「谁和谁同级、按什么顺序」全应用只此一处实现 —— 命令层的插入定位
 * （`task.create` 的 `afterId`）与 UI 层的「刚建的那条是谁」都调它。
 */
export function siblingIdsOf(project: Project, taskId: TaskId): readonly TaskId[] {
  const task = project.tasks[taskId]
  if (!task) return []
  return task.parentId === null ? project.rootIds : (project.tasks[task.parentId]?.childIds ?? [])
}
