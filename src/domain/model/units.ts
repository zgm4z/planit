import type { Assignment, Resource, TaskId } from './types'

/**
 * Σunits 的**唯一实现** —— 命令层（切换 effortMode 时初始化 effort）与引擎
 * （算有效工期）都调它。绝不在第二处再写一遍（v0.2 deriveKind 的教训）。
 *
 * 入参是**结构化**的 `{ assignments, resources }` 而不是 `Project`：命令层的
 * `Draft<Project>` 与引擎的 `Project` 都能传进来，避免为一个只读聚合函数
 * 把调用方都转成完整 Project。
 */
export interface UnitsInput {
  assignments: Record<string, Assignment>
  resources: Record<string, Resource>
}

/** 单条分配对 Σunits 的贡献：可用率 × 投入比例 × 效率（efficiency 缺省按 1） */
export function assignmentUnits(resource: Resource, assignment: Assignment): number {
  return resource.availability * assignment.units * (resource.efficiency ?? 1)
}

/** 给定一组分配的 Σunits；指向不存在资源的分配被忽略。 */
export function sumAssignmentUnits(
  assignments: readonly Assignment[],
  resources: Readonly<Record<string, Resource>>,
): number {
  let total = 0
  for (const assignment of assignments) {
    const resource = resources[assignment.resourceId]
    if (!resource) continue
    total += assignmentUnits(resource, assignment)
  }
  return total
}

/** 一个任务的**全部**分配之和。无分配时为 0；悬空（指向不存在资源）的分配被忽略 */
export function sumUnits(project: UnitsInput, taskId: TaskId): number {
  const assignments = Object.values(project.assignments).filter(
    (assignment) => assignment.taskId === taskId,
  )
  return sumAssignmentUnits(assignments, project.resources)
}
