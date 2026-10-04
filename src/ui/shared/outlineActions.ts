import type { Project, TaskId } from '../../domain/model/types'
import { siblingIdsOf } from '../../domain/model/tree'

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

  const list = siblingIdsOf(project, taskId)
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

  return siblingIdsOf(project, parent.id) !== null
}

/**
 * 提交 `task.create{afterId}` 之后，从新 project 里读出**刚插入的那条任务**的 id。
 *
 * 确定性来自命令层的契约：新任务必定紧跟在 `afterId` 之后（插位规则见
 * `taskCommands.ts` 的 `insertAfter`）。找不到（`afterId` 不存在 / 已在末尾）时返回 null。
 *
 * 为什么是「事后读」而不是「让 UI 预生成 id」：id 的生成是命令层的职责，
 * UI 不应成为第二个 id 生成入口 —— 那会让「谁造 id」出现两份真相。
 */
export function createdSiblingId(project: Project, afterId: TaskId): TaskId | null {
  const siblings = siblingIdsOf(project, afterId)
  if (!siblings) return null
  const at = siblings.indexOf(afterId)
  return at >= 0 && at + 1 < siblings.length ? siblings[at + 1]! : null
}
