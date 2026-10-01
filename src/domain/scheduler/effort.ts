import type {
  Assignment,
  Calendar,
  DateStr,
  Project,
  Resource,
  ResourceId,
  ResourceSummary,
  Task,
  TaskCosts,
  TaskId,
} from '../model/types'
import { assignmentUnits } from '../model/units'

/**
 * 一个任务的**资源可用期边界**：全部受约束资源的交集。
 *   availableFrom  → earliestStart（最晚入职，任务开始的下界）
 *   availableUntil → latestFinish（最早离职，任务结束的上界）
 *
 * 多资源取交集（而不是并集）：标量 Σunits 假设「全部资源同时在推进任务」，
 * 交集才与之自洽。无受约束资源时两者都缺省 = 不受限。
 */
export interface ResourceBounds {
  earliestStart?: DateStr
  latestFinish?: DateStr
}

/** 由项目里该任务的全部分配算出可用期边界。不受限时返回 `{}` */
export function resourceBounds(project: Project, taskId: TaskId): ResourceBounds {
  let earliestStart: DateStr | undefined
  let latestFinish: DateStr | undefined

  for (const assignment of Object.values(project.assignments)) {
    if (assignment.taskId !== taskId) continue
    const resource = project.resources[assignment.resourceId]
    if (!resource) continue

    if (resource.availableFrom && (earliestStart === undefined || resource.availableFrom > earliestStart)) {
      earliestStart = resource.availableFrom
    }
    if (resource.availableUntil && (latestFinish === undefined || resource.availableUntil < latestFinish)) {
      latestFinish = resource.availableUntil
    }
  }

  return { earliestStart, latestFinish }
}

/**
 * **反解**：固定工作量任务的工期 = ceil(effort / Σunits)，整数工作日。
 *
 * `ceil` 而不是 `round` —— 2.5 天的工作量需要 3 个工作日才装得下（spec §3.2）。
 *
 * Σunits ≤ 0 时无法反解（没有可派的人），退回 `task.duration`：让任务保持在
 * 用户此前设的工期上，而不是塌成 1 天。里程碑恒为 0。
 */
export function effectiveDuration(task: Task, units: number): number {
  if (task.kind === 'milestone') return 0
  if (task.effortMode !== 'fixedEffort') return task.duration

  const effort = task.effort ?? 0
  if (units <= 0) return task.duration
  return Math.max(1, Math.ceil(effort / units))
}

/**
 * **正解**：任务投入（人·工作日）。
 *   fixedEffort —— 取**输入的** effort（工期被反解出来的都是「装得下」的近似）
 *   其余        —— Σunits × 工期
 */
export function taskEffort(task: Task, units: number, duration: number): number {
  if (task.effortMode === 'fixedEffort' && task.effort !== undefined) return task.effort
  return units * duration
}

/**
 * 每个任务的投入。摘要任务 = 子任务之和（自底向上），与 summarizeParents 汇总排期同向。
 * 返回的表**覆盖全部任务**（含无分配者，值为 0）。
 */
export function collectEfforts(
  project: Project,
  leaves: readonly Task[],
  units: ReadonlyMap<TaskId, number>,
  durations: ReadonlyMap<TaskId, number>,
): Record<TaskId, number> {
  const result: Record<TaskId, number> = {}

  for (const leaf of leaves) {
    result[leaf.id] = taskEffort(leaf, units.get(leaf.id) ?? 0, durations.get(leaf.id) ?? leaf.duration)
  }

  const visit = (id: TaskId): number => {
    const task = project.tasks[id]
    if (!task) return 0
    if (task.childIds.length === 0) return result[id] ?? 0
    const sum = task.childIds.reduce((acc, childId) => acc + visit(childId), 0)
    result[id] = sum
    return sum
  }

  for (const rootId of project.rootIds) visit(rootId)
  return result
}

/** 一条分配折算出的工时与成本 */
function assignmentCost(
  resource: Resource,
  assignment: Assignment,
  duration: number,
  hoursPerDay: number,
): { usage: number; hourly: number; hours: number } {
  const hours = assignmentUnits(resource, assignment) * duration * hoursPerDay
  // 费率字段必须兜底 0：createResource 的默认成本是 `{ currency: 'CNY' }`，
  // 两个费率字段都缺省，而**默认资源是最常见的路径**。不兜底会让
  // `undefined * hours` 算出 NaN，再顺着 collectCosts 的 `+=` 把
  // 摘要任务与资源总计整列污染成 NaN —— 一个 NaN 就毁掉整张成本表。
  return {
    usage: resource.cost.usage ?? 0,
    hourly: hours * (resource.cost.hourly ?? 0),
    hours,
  }
}

const ZERO_COST: TaskCosts = { task: 0, resource: 0, total: 0 }

/**
 * 每个任务的成本拆解 + 每个资源的派生总计。摘要任务 = 子任务之和。
 *
 * 工时用**有效工期**（与排期一致），小时费率与一次性使用成本来自资源。
 * `resourceTotals` 预置全部资源（零分配者计 0），供资源面板直接读。
 */
export function collectCosts(
  project: Project,
  leaves: readonly Task[],
  durations: ReadonlyMap<TaskId, number>,
  calendar: Calendar,
): { costs: Record<TaskId, TaskCosts>; resourceTotals: Record<ResourceId, ResourceSummary> } {
  const costs: Record<TaskId, TaskCosts> = {}

  const resourceTotals: Record<ResourceId, ResourceSummary> = {}
  for (const resourceId of Object.keys(project.resources)) {
    resourceTotals[resourceId] = { assignments: 0, hours: 0, cost: 0 }
  }

  for (const leaf of leaves) {
    const duration = durations.get(leaf.id) ?? leaf.duration
    let task = 0
    let resource = 0

    for (const assignment of Object.values(project.assignments)) {
      if (assignment.taskId !== leaf.id) continue
      const assigned = project.resources[assignment.resourceId]
      if (!assigned) continue

      const cost = assignmentCost(assigned, assignment, duration, calendar.hoursPerDay)
      task += cost.usage
      resource += cost.hourly

      const total = resourceTotals[assigned.id]!
      total.assignments += 1
      total.hours += cost.hours
      total.cost += cost.usage + cost.hourly
    }

    costs[leaf.id] = { task, resource, total: task + resource }
  }

  const visit = (id: TaskId): TaskCosts => {
    const task = project.tasks[id]
    if (!task) return ZERO_COST
    if (task.childIds.length === 0) return costs[id] ?? ZERO_COST
    const sum = task.childIds.reduce<TaskCosts>(
      (acc, childId) => {
        const child = visit(childId)
        return {
          task: acc.task + child.task,
          resource: acc.resource + child.resource,
          total: acc.total + child.total,
        }
      },
      { task: 0, resource: 0, total: 0 },
    )
    costs[id] = sum
    return sum
  }

  for (const rootId of project.rootIds) visit(rootId)
  return { costs, resourceTotals }
}
