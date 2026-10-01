import type {
  Calendar,
  DateStr,
  Project,
  ResourceId,
  TaskId,
  ResourceOverload,
} from '../model/types'
import { assignmentUnits } from '../model/units'
import { workdaysInRange } from '../calendar/workdays'

/** 超载判定阈值：`> 1 + ε` 才算超载。0.5 / 0.25 这类单位累加带浮点误差，ε 防误报 */
const OVERLOAD_EPSILON = 1e-9

/** 一个任务在某一版排期里的占位区间（含首尾工作日） */
export interface LeveledDates {
  start: DateStr
  finish: DateStr
}

/**
 * 每个资源每日负载：`resourceId → (date → Σ assignmentUnits)`。
 *
 * **这是「资源负载」的唯一实现** —— UI 与算法都读它，绝不重算 `availability × units ×
 * efficiency`（Σunits 的同一份原语在 `model/units.ts`，见 v0.5 的教训）。
 *
 * `dates` 是「任务的占位区间」（可能是 CPM 的 early/scheduled，也可能是平衡后的）。
 * 悬空分配（指向不存在资源）与缺区间的任务（摘要）被忽略。
 */
export function resourceDayLoad(
  project: Project,
  dates: Readonly<Record<TaskId, LeveledDates>>,
  calendar: Calendar,
): Map<ResourceId, Map<DateStr, number>> {
  const load = new Map<ResourceId, Map<DateStr, number>>()

  for (const assignment of Object.values(project.assignments)) {
    const resource = project.resources[assignment.resourceId]
    const span = dates[assignment.taskId]
    if (!resource || !span) continue

    const units = assignmentUnits(resource, assignment)
    if (units <= 0) continue

    let byDay = load.get(resource.id)
    if (!byDay) {
      byDay = new Map<DateStr, number>()
      load.set(resource.id, byDay)
    }
    for (const day of workdaysInRange(span.start, span.finish, calendar)) {
      byDay.set(day, (byDay.get(day) ?? 0) + units)
    }
  }

  return load
}

/** 负载表 → 超载清单（`load > 1 + ε`）。顺序确定：先资源 id，再日期升序 */
export function collectOverloads(
  load: ReadonlyMap<ResourceId, ReadonlyMap<DateStr, number>>,
): ResourceOverload[] {
  const out: ResourceOverload[] = []
  for (const [resourceId, byDay] of load) {
    for (const [date, value] of byDay) {
      if (value > 1 + OVERLOAD_EPSILON) out.push({ resourceId, date, load: value })
    }
  }
  return out.sort((a, b) =>
    a.resourceId !== b.resourceId
      ? a.resourceId < b.resourceId
        ? -1
        : 1
      : a.date < b.date
        ? -1
        : a.date > b.date
          ? 1
          : 0,
  )
}
