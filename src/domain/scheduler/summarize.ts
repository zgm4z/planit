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

    const children = task.childIds
      .map(visit)
      .filter((s): s is ComputedSchedule => s !== null)

    // 有 childIds 但子任务全部缺失（数据损坏）时，退化为不做汇总
    if (children.length === 0) return null

    const summary: ComputedSchedule = {
      earlyStart: minOf(children.map((c) => c.earlyStart)),
      earlyFinish: maxOf(children.map((c) => c.earlyFinish)),
      lateStart: minOf(children.map((c) => c.lateStart)),
      lateFinish: maxOf(children.map((c) => c.lateFinish)),
      scheduledStart: minOf(children.map((c) => c.scheduledStart)),
      scheduledFinish: maxOf(children.map((c) => c.scheduledFinish)),
      totalSlack: Math.min(...children.map((c) => c.totalSlack)),
      freeSlack: Math.min(...children.map((c) => c.freeSlack)),
      isCritical: children.some((c) => c.isCritical),
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

function minOf(dates: string[]): string {
  return dates.reduce((a, b) => (a < b ? a : b))
}

function maxOf(dates: string[]): string {
  return dates.reduce((a, b) => (a > b ? a : b))
}
