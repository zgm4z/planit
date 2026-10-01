import type { Project, TaskId } from '../../domain/model/types'

/**
 * 取任务所处的兄弟列表（顶层任务取 rootIds，子任务取父的 childIds）。
 *
 * **这是命令层 `taskStructureCommands.ts` 里 `siblingList` 的只读镜像。**
 * 两处必须保持一致：这里判「能不能做」，那里判「做不做」。
 */
function siblingIds(project: Project, taskId: TaskId): TaskId[] | null {
  const task = project.tasks[taskId]
  if (!task) return null
  if (task.parentId === null) return project.rootIds
  const parent = project.tasks[task.parentId]
  return parent ? parent.childIds : null
}

/**
 * 该任务能否缩进为「前一个兄弟」的子任务。
 *
 * 守卫与 `task.indent` 的 handler 逐条对应 —— 若这里放宽，按钮会显示为可用，
 * 点下去却在命令层被拒绝：patches 为空，ProjectView 的 dispatch 直接 return，
 * 连一条撤销记录都不会产生。用户看到的是「点了没反应」，比按钮禁用更糟。
 *
 * 与 handler 一致的两条拒绝条件：
 *   1. 第一个兄弟没有可依附的前驱（index <= 0）
 *   2. 前一个兄弟是里程碑（里程碑不可作为父任务）
 */
export function canIndent(project: Project, taskId: TaskId | null): boolean {
  if (!taskId) return false

  const list = siblingIds(project, taskId)
  if (!list) return false

  const index = list.indexOf(taskId)
  if (index <= 0) return false

  const newParent = project.tasks[list[index - 1]]
  return newParent !== undefined && newParent.kind !== 'milestone'
}

/**
 * 该任务能否反缩进（升到祖父层级，插在原父任务之后）。
 *
 * 守卫与 `task.outdent` 的 handler 对应：必须有父任务，且祖父层的兄弟列表可解析
 * （数据损坏导致祖父缺失时 handler 会静默返回，这里同样判为不可用）。
 */
export function canOutdent(project: Project, taskId: TaskId | null): boolean {
  if (!taskId) return false

  const task = project.tasks[taskId]
  if (!task || task.parentId === null) return false

  const parent = project.tasks[task.parentId]
  if (!parent) return false

  return siblingIds(project, parent.id) !== null
}
