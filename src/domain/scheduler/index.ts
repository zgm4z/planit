import type { ComputedSchedule, Project, ScheduleResult, Task, TaskId } from '../model/types'
import type { ResourceBounds } from './effort'
import { runCpm } from './cpm'
import { levelLeaves } from './leveling'
import { detectConflicts, summarizeParents } from './summarize'
import { collectCosts, collectEfforts, effectiveDuration, resourceBounds } from './effort'
import { sumUnits } from '../model/units'

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
 *
 * `fixedEffort` 任务的工期**必须**在 ① 算出来 —— 工期是 CPM 正推的输入。
 * 资源可用期在此翻译成任务级排期边界（见 ResourceBounds）。
 */
export function solve(project: Project): ScheduleResult {
  const leaves = collectLeaves(project)
  const calendar = project.calendars[project.calendarId]

  // ① 有效工期计算：把 effort × 分配 × 资源 解成 CPM 需要的 duration 输入，
  //    同时算出每个任务的资源可用期边界。
  const units = new Map<TaskId, number>()
  const durations = new Map<TaskId, number>()
  const bounds: Record<TaskId, ResourceBounds> = {}

  for (const leaf of leaves) {
    const unit = sumUnits(project, leaf.id)
    units.set(leaf.id, unit)
    durations.set(leaf.id, effectiveDuration(leaf, unit))

    const bound = resourceBounds(project, leaf.id)
    if (bound.earliestStart !== undefined || bound.latestFinish !== undefined) {
      bounds[leaf.id] = bound
    }
  }

  const leafSchedules = runCpm({
    tasks: leaves.map((leaf) => ({ ...leaf, duration: durations.get(leaf.id)! })),
    dependencies: Object.values(project.dependencies),
    calendar,
    direction: project.schedulingDirection,
    projectStart: project.startDate,
    projectEnd: project.endDate,
    resourceBounds: bounds,
  })

  // ⑦ 资源平衡（v0.6）：用 CPM 算出的浮时，把资源超载处的任务往后推。
  //    必须在 ② 之后（要浮时）、在摘要汇总之前（产出的 scheduled* 要被汇总）。
  //    只覆盖叶子的 scheduledStart/Finish —— early/late/slack 一律不动（spec §3）。
  const { result: leveling, dates } = levelLeaves(
    project,
    leaves,
    durations,
    calendar,
    leafSchedules,
  )

  const leveledLeaves: Record<TaskId, ComputedSchedule> = {}
  for (const [id, schedule] of Object.entries(leafSchedules)) {
    const span = dates[id]
    leveledLeaves[id] = span
      ? { ...schedule, scheduledStart: span.start, scheduledFinish: span.finish }
      : schedule
  }

  const schedules = summarizeParents(project.tasks, leveledLeaves, project.rootIds)
  const conflicts = detectConflicts(project.tasks, schedules, project.rootIds)
  const efforts = collectEfforts(project, leaves, units, durations)
  const { costs, resourceTotals } = collectCosts(project, leaves, durations, calendar)

  return { schedules, conflicts, efforts, costs, resourceTotals, leveling }
}

/** 深度优先收集全部叶子任务（childIds 为空者） */
function collectLeaves(project: Project): Task[] {
  const leaves: Task[] = []

  const visit = (id: TaskId): void => {
    const task = project.tasks[id]
    if (!task) return
    if (task.childIds.length === 0) {
      leaves.push(task)
      return
    }
    for (const childId of task.childIds) visit(childId)
  }

  for (const rootId of project.rootIds) visit(rootId)
  return leaves
}
