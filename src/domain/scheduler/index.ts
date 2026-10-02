import type { ComputedSchedule, Project, ScheduleResult, TaskId } from '../model/types'
import { runCpmWithGraph } from './cpm'
import { levelLeaves } from './leveling'
import { detectConflicts, summarizeParents } from './summarize'
import { collectCosts, collectEfforts, effectiveDuration } from './effort'
import { collectBaselineDiffs, collectEarnedValues } from './earnedValue'
import { toDateStr } from '../calendar/dateTime'
import { buildScheduleContext } from './context'

export { CycleError } from './graph'
export { runCpm } from './cpm'
export { summarizeParents, detectConflicts } from './summarize'

/**
 * 排期求解的唯一入口。纯函数，不依赖任何 React 或 store。
 *
 * 管线（spec §3.3）：
 *   ① 有效工期计算   ← v0.5 填充（v0.1 时是恒等变换）
 *   ② 拓扑排序 + 环检测 ┐
 *   ③ 正推 / ④ 逆推 / ⑤ 浮时 ├ 都在 runCpm 里
 *   ⑥ 摘要汇总 + 冲突检测 ┘
 *   ⑦ 资源平衡        ← v0.6 填充（CPM 之后、摘要之前；只改 scheduled*）
 *   ⑧ 基线与挣值      ← v1.0 填充（派生；差异用最终 scheduled*，挣值的 BAC 取 costs.total）
 *
 * `fixedEffort` 任务的工期**必须**在 ① 算出来 —— 工期是 CPM 正推的输入。
 * 资源可用期在此翻译成任务级排期边界（见 ResourceBounds）。
 */
export function solve(project: Project): ScheduleResult {
  const context = buildScheduleContext(project)
  const leaves = context.leaves
  const calendar = context.calendar

  // ① 有效工期计算：把 effort × 分配 × 资源 解成 CPM 需要的 duration 输入，
  //    同时算出每个任务的资源可用期边界。
  const durations = new Map<TaskId, number>()

  for (const leaf of leaves) {
    const unit = context.unitsByTask.get(leaf.id) ?? 0
    durations.set(leaf.id, effectiveDuration(leaf, unit))
  }
  const bounds = Object.fromEntries(context.resourceBoundsByTask)

  const leafSchedules = runCpmWithGraph({
    tasks: leaves.map((leaf) => ({ ...leaf, duration: durations.get(leaf.id)! })),
    dependencies: Object.values(project.dependencies),
    calendar,
    direction: project.schedulingDirection,
    // CPM 的起点 / 终点锚点消费的是日粒度：先把承载时刻的字段归一，
    // 否则引擎内部 `parseDate` 拿到带时刻串会静默算出 NaN。
    projectStart: toDateStr(project.startDate),
    projectEnd: project.endDate ? toDateStr(project.endDate) : undefined,
    resourceBounds: bounds,
  }, context.graph)

  // ⑦ 资源平衡（v0.6）：用 CPM 算出的浮时，把资源超载处的任务往后推。
  //    必须在 ② 之后（要浮时）、在摘要汇总之前（产出的 scheduled* 要被汇总）。
  //    只覆盖叶子的 scheduledStart/Finish —— early/late/slack 一律不动（spec §3）。
  const { result: leveling, dates } = levelLeaves(context, durations, leafSchedules)

  const leveledLeaves: Record<TaskId, ComputedSchedule> = {}
  for (const [id, schedule] of Object.entries(leafSchedules)) {
    const span = dates[id]
    leveledLeaves[id] = span
      ? { ...schedule, scheduledStart: span.start, scheduledFinish: span.finish }
      : schedule
  }

  const schedules = summarizeParents(project.tasks, leveledLeaves, project.rootIds)
  const conflicts = detectConflicts(project.tasks, schedules, project.rootIds)
  const efforts = collectEfforts(context, durations)
  const { costs, resourceTotals } = collectCosts(context, durations)

  // ⑧ 基线与挣值（v1.0）：全部**派生**，不进 Project、不入撤销栈。
  //    必须在摘要汇总之后 —— 差异的「当前」端要最终的 scheduled*；
  //    也必须在 collectCosts 之后 —— 挣值的 BAC 取 costs.total。
  const earnedValues = collectEarnedValues(project, costs, leaves)
  const baselineDiffs = collectBaselineDiffs(project, schedules)

  return { schedules, conflicts, efforts, costs, resourceTotals, leveling, earnedValues, baselineDiffs }
}
