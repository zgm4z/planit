import type {
  ComputedSchedule,
  ConflictInfo,
  Task,
  TaskId,
} from '../model/types'

/**
 * 把叶子任务的排期合并成完整的排期表：叶子结果原样保留，
 * 摘要任务自底向上汇总。
 *
 * 汇总规则（见设计文档 5.5）：
 *   earlyStart  = min(children.earlyStart)
 *   earlyFinish = max(children.earlyFinish)
 *   lateStart   = min(children.lateStart)
 *   lateFinish  = max(children.lateFinish)
 *   scheduledStart  = min(children.scheduledStart)
 *   scheduledFinish = max(children.scheduledFinish)
 *   totalSlack  = min(children.totalSlack)   ← 最紧的子任务决定整个摘要
 *   freeSlack   = min(children.freeSlack)    ← 同 totalSlack 口径
 *   isCritical  = any(children.isCritical)
 *
 * 前提：childIds 构成一棵树（无环）。树形不变量由命令层保证，
 * 与依赖环不同，这里不做环检测。
 */
export function summarizeParents(
  tasks: Record<TaskId, Task>,
  leafSchedules: Record<TaskId, ComputedSchedule>,
  rootIds: TaskId[],
): Record<TaskId, ComputedSchedule> {
  const result: Record<TaskId, ComputedSchedule> = { ...leafSchedules }

  const visit = (id: TaskId): ComputedSchedule | null => {
    const task = tasks[id]
    if (!task) return null

    if (task.childIds.length === 0) {
      return leafSchedules[id] ?? null
    }

    // 单趟累加 min/max，不逐字段 `.map()` 出中间数组 —— 每个分组 6 个临时数组的分配
    // 是纯 CPM 里 summarize 的主要成本（列在 profile 的 `visit` 名下）。语义与
    // 原来的 `minOf(children.map(...))` / `Math.min(...)` 逐字等价。
    let earlyStart: string | undefined
    let earlyFinish: string | undefined
    let lateStart: string | undefined
    let lateFinish: string | undefined
    let scheduledStart: string | undefined
    let scheduledFinish: string | undefined
    let totalSlack = Number.POSITIVE_INFINITY
    let freeSlack = Number.POSITIVE_INFINITY
    let isCritical = false
    let count = 0

    for (const childId of task.childIds) {
      const child = visit(childId)
      if (child === null) continue
      count += 1
      if (earlyStart === undefined || child.earlyStart < earlyStart) earlyStart = child.earlyStart
      if (earlyFinish === undefined || child.earlyFinish > earlyFinish) earlyFinish = child.earlyFinish
      if (lateStart === undefined || child.lateStart < lateStart) lateStart = child.lateStart
      if (lateFinish === undefined || child.lateFinish > lateFinish) lateFinish = child.lateFinish
      if (scheduledStart === undefined || child.scheduledStart < scheduledStart) scheduledStart = child.scheduledStart
      if (scheduledFinish === undefined || child.scheduledFinish > scheduledFinish) scheduledFinish = child.scheduledFinish
      if (child.totalSlack < totalSlack) totalSlack = child.totalSlack
      if (child.freeSlack < freeSlack) freeSlack = child.freeSlack
      if (child.isCritical) isCritical = true
    }

    // 有 childIds 但子任务全部缺失（数据损坏）时，退化为不做汇总
    if (count === 0) return null

    const summary: ComputedSchedule = {
      earlyStart: earlyStart!,
      earlyFinish: earlyFinish!,
      lateStart: lateStart!,
      lateFinish: lateFinish!,
      scheduledStart: scheduledStart!,
      scheduledFinish: scheduledFinish!,
      totalSlack,
      freeSlack,
      isCritical,
    }
    result[id] = summary
    return summary
  }

  for (const rootId of rootIds) visit(rootId)
  return result
}

/**
 * 如实记录排期矛盾，不做调和。摘要任务本身不判冲突。
 * 判定**时机**不变：叶子任务浮时为负即驱动（最早与最晚排期窗口不可行）。
 *
 * 归因（Task 4）：负浮时所在任务若在逆推时记下了 `conflictBinding`（其最紧上界
 * 唯一由一条指向 manual 后继的出边给出），则报 `dependencyViolation` 并带上依赖
 * 参数；否则维持中性的 `infeasibleSchedule`（成因是约束 / 资源 / auto 后继，
 * 不误报到某个 manual 依赖上）。manual 任务浮时恒 0，从不触发这里。
 *
 * 前提：childIds 构成一棵树（无环）。树形不变量由命令层保证，
 * 与依赖环不同，这里不做环检测。
 */
export function detectConflicts(
  tasks: Record<TaskId, Task>,
  schedules: Record<TaskId, ComputedSchedule>,
  rootIds: TaskId[],
): ConflictInfo[] {
  const conflicts: ConflictInfo[] = []

  const visit = (id: TaskId): void => {
    const task = tasks[id]
    if (!task) return

    if (task.childIds.length > 0) {
      for (const childId of task.childIds) visit(childId)
      return
    }

    const schedule = schedules[id]
    if (!schedule || schedule.totalSlack >= 0) return

    const binding = schedule.conflictBinding
    conflicts.push(
      binding
        ? {
            taskId: id,
            kind: 'dependencyViolation',
            slack: schedule.totalSlack,
            depType: binding.depType,
            lagDays: binding.lagDays,
            boundary: binding.boundary,
          }
        : {
            taskId: id,
            kind: 'infeasibleSchedule',
            slack: schedule.totalSlack,
          },
    )
  }

  for (const rootId of rootIds) visit(rootId)
  return conflicts
}
