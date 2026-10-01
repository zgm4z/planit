import type {
  Calendar,
  ComputedSchedule,
  DateStr,
  Dependency,
  Task,
  TaskId,
} from '../model/types'
import { snapToWorkday, taskFinish, taskStart, workdaysBetween } from '../calendar/workdays'
import { buildGraph } from './graph'
import { backwardBound, forwardBound } from './constraints'

export interface CpmInput {
  /** 只传叶子任务。摘要任务由 summarize 阶段汇总，不参与求解 */
  tasks: Task[]
  dependencies: Dependency[]
  calendar: Calendar
  /** 项目基准开始日期，正推的起点 */
  projectStart: DateStr
}

export function runCpm(input: CpmInput): Record<TaskId, ComputedSchedule> {
  const { tasks, dependencies, calendar, projectStart } = input

  const graph = buildGraph(tasks, dependencies) // 可能抛出 CycleError
  const byId = new Map(tasks.map((task) => [task.id, task]))

  // ── 正推 ──────────────────────────────────────────────
  const earlyStart = new Map<TaskId, DateStr>()
  const earlyFinish = new Map<TaskId, DateStr>()

  for (const id of graph.order) {
    const task = byId.get(id)!
    let start = constraintLowerBound(task, calendar, projectStart)

    for (const dep of graph.incoming.get(id) ?? []) {
      const bound = forwardBound({
        dep,
        fromStart: earlyStart.get(dep.fromTaskId)!,
        fromFinish: earlyFinish.get(dep.fromTaskId)!,
        toDuration: task.duration,
        cal: calendar,
      })
      if (bound > start) start = bound
    }

    start = snapToWorkday(start, calendar)
    earlyStart.set(id, start)
    earlyFinish.set(id, taskFinish(start, task.duration, calendar))
  }

  const projectFinish = latestOf([...earlyFinish.values()], projectStart)

  // ── 逆推 ──────────────────────────────────────────────
  const lateStart = new Map<TaskId, DateStr>()
  const lateFinish = new Map<TaskId, DateStr>()

  for (const id of [...graph.order].reverse()) {
    const task = byId.get(id)!
    let finish = constraintUpperBound(task, calendar, projectFinish)

    for (const dep of graph.outgoing.get(id) ?? []) {
      const bound = backwardBound({
        dep,
        toStart: lateStart.get(dep.toTaskId)!,
        toFinish: lateFinish.get(dep.toTaskId)!,
        fromDuration: task.duration,
        cal: calendar,
      })
      if (bound < finish) finish = bound
    }

    finish = snapToWorkday(finish, calendar)
    lateFinish.set(id, finish)
    lateStart.set(id, taskStart(finish, task.duration, calendar))
  }

  // ── 浮时与关键路径 ────────────────────────────────────
  const result: Record<TaskId, ComputedSchedule> = {}
  for (const id of graph.order) {
    const slack = workdaysBetween(earlyStart.get(id)!, lateStart.get(id)!, calendar)
    result[id] = {
      earlyStart: earlyStart.get(id)!,
      earlyFinish: earlyFinish.get(id)!,
      lateStart: lateStart.get(id)!,
      lateFinish: lateFinish.get(id)!,
      totalSlack: slack,
      isCritical: slack === 0,
    }
  }
  return result
}

/** 约束给出的「最早开始」下界。auto 任务下界即项目起点 */
function constraintLowerBound(task: Task, cal: Calendar, projectStart: DateStr): DateStr {
  if (task.scheduling.mode === 'auto') return projectStart

  const { type, date } = task.scheduling
  switch (type) {
    case 'startOn':
    case 'startNoEarlierThan':
      return date
    case 'finishOn':
    case 'finishNoEarlierThan':
      return taskStart(date, task.duration, cal)
    case 'startNoLaterThan':
    case 'finishNoLaterThan':
      return projectStart
  }
}

/** 约束给出的「最晚结束」上界。auto 任务上界即项目完成日 */
function constraintUpperBound(task: Task, cal: Calendar, projectFinish: DateStr): DateStr {
  if (task.scheduling.mode === 'auto') return projectFinish

  const { type, date } = task.scheduling
  switch (type) {
    case 'finishOn':
    case 'finishNoLaterThan':
      return date
    case 'startOn':
    case 'startNoLaterThan':
      return taskFinish(date, task.duration, cal)
    case 'startNoEarlierThan':
    case 'finishNoEarlierThan':
      return projectFinish
  }
}

function latestOf(dates: DateStr[], fallback: DateStr): DateStr {
  if (dates.length === 0) return fallback
  return dates.reduce((a, b) => (a > b ? a : b))
}
