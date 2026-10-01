import type { TaskId, TaskKind } from './types'

/**
 * 从结构事实推导 kind —— **全仓唯一的推导规则**。
 *
 * 命令层的 `reconcileKind` 与持久化层的 v1→v2 迁移都必须走这里。
 * 各写一遍的后果是它们会漂移：迁移那份曾经把 `isMilestone` 排在子任务
 * 之前，于是「里程碑 ∧ 有子任务」这种畸形 v1 存档会迁出一个违反
 * 不变式 2（group ⟺ 有子任务）的任务。
 *
 * 优先级：**子任务优先**。`childIds` 是结构事实，不变式 2 是双向的那条；
 * `isMilestone` 只是一条「没有子任务时」的偏好。
 */
export function deriveKind(input: {
  childIds: readonly TaskId[]
  /** 没有子任务时的偏好。有子任务时被忽略 */
  isMilestone?: boolean
}): TaskKind {
  if (input.childIds.length > 0) return 'group'
  return input.isMilestone ? 'milestone' : 'task'
}
