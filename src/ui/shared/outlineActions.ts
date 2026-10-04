import type { Project, TaskId } from '../../domain/model/types'

/**
 * 该任务是**叶子**吗（存在且 `kind !== 'group'`）。
 *
 * 摘要任务不是叶子：不能直接派资源（`assignment.create` 对 group 早退）、不能设为里程碑、
 * 不能缩进为别处的前驱。这个「叶子」判定散落在多处消费方（分配树、工具栏快速分配、菜单栏），
 * 统一收敛到这一处，免得哪天命令层放宽时各点静默漂移。
 */
export function isLeafTask(project: Project, taskId: TaskId): boolean {
  const task = project.tasks[taskId]
  return task !== undefined && task.kind !== 'group'
}

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
