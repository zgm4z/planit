import type {
  Calendar,
  ComputedSchedule,
  DateStr,
  Dependency,
  SchedulingDirection,
  Task,
  TaskId,
} from '../model/types'
import type { ResourceBounds } from './effort'
import {
  snapToWorkday,
  snapToWorkdayOrPrevious,
  taskFinish,
  taskStart,
  workdaysBetween,
} from '../calendar/workdays'
import { toDateStr } from '../calendar/dateTime'
import { buildGraph, type TaskGraph } from './graph'
import { backwardBound, forwardBound } from './constraints'
import { usesLateSchedule } from './direction'

export interface CpmInput {
  /** 只传叶子任务。摘要任务由 summarize 阶段汇总，不参与求解 */
  tasks: Task[]
  dependencies: Dependency[]
  calendar: Calendar
  direction: SchedulingDirection
  /** forward 用它做正推起点；backward 下作为无终点时的兜底锚 */
  projectStart: DateStr
  /**
   * forward —— 「最晚必须完成」的期限。未设置即无期限
   * backward —— 逆推终点。未设置时退回用正推算出的完成日
   */
  projectEnd?: DateStr
  /**
   * v0.5：任务级的资源可用期边界（按 taskId）。缺省 = 全部不受限。
   * 见 effort.ts 的 resourceBounds —— 只有设了 availableFrom / availableUntil
   * 的任务才会出现在这张表里，因此「无资源」的既有行为逐字节不变。
   */
  resourceBounds?: Record<TaskId, ResourceBounds>
}

export function runCpm(input: CpmInput): Record<TaskId, ComputedSchedule> {
  const graph = buildGraph(input.tasks, input.dependencies) // 可能抛出 CycleError
  return runCpmWithGraph(input, graph)
}

/** 内部入口：复用 solve context 已构建的任务图；不从 scheduler barrel 导出。 */
export function runCpmWithGraph(
  input: CpmInput,
  graph: TaskGraph,
): Record<TaskId, ComputedSchedule> {
  const { tasks, calendar, direction, projectStart, projectEnd, resourceBounds } = input
  const latestProjectEnd = projectEnd
    ? snapToWorkdayOrPrevious(projectEnd, calendar)
    : undefined

  const byId = new Map(tasks.map((task) => [task.id, task]))

  // ── 正推（early）───────────────────────────────────────
  // 抽成函数是因为 backward 下要跑两次：第一次只是为了拿到
  // 「无终点时」的完成日，第二次才用真正的锚点。
  const forwardPass = (anchor: DateStr) => {
    const earlyStart = new Map<TaskId, DateStr>()
    const earlyFinish = new Map<TaskId, DateStr>()

    for (const id of graph.order) {
      const task = byId.get(id)!
      let start = constraintLowerBound(task, calendar, anchor)

      // 资源可用期的开始下界（availableFrom）—— 与任务自身的约束取较晚者
      const earliest = resourceBounds?.[id]?.earliestStart
      if (earliest && earliest > start) start = earliest

      for (const dep of graph.incoming.get(id) ?? []) {
        const fromTask = byId.get(dep.fromTaskId)!
        const bound = forwardBound({
          dep,
          fromStart: earlyStart.get(dep.fromTaskId)!,
          fromFinish: earlyFinish.get(dep.fromTaskId)!,
          toDuration: task.duration,
          fromDuration: fromTask.duration,
          cal: calendar,
        })
        if (bound > start) start = bound
      }

      start = snapToWorkday(start, calendar)
      earlyStart.set(id, start)

      // 可用期是任务级的**上下界**：availableFrom = 下界（最早能开始），
      // availableUntil = 上界（最晚能结束）。二者**有意只各进一趟** ——
      // 下界只进正推（见上方 earliestStart），上界只进逆推（见 backwardPass 的
      // latestFinish）。这与既有的约束机制 constraintLowerBound /
      // constraintUpperBound 完全同构：下界刻画最早起点、上界刻画最晚终点，
      // 各归其位。切勿为了「两趟都不越界」把两条边界都塞进两趟。
      //
      // 刻意**不**在正推里夹上界：earlyFinish 是任务的真实完成日，甘特条宽度、
      // 依赖连线端点、TaskBar 几何全基于它，夹到 availableUntil 会把一条 N 天的
      // 任务谎报成更短。可用期不可行（availableUntil 早于自然完成日）时，逆推
      // 会把上界体现成负浮时，由 detectConflicts 如实报冲突 —— 只如实报，不夹
      // 边界调和。
      earlyFinish.set(id, taskFinish(start, task.duration, calendar))
    }

    return { earlyStart, earlyFinish }
  }

  // ── 逆推（late）────────────────────────────────────────
  const backwardPass = (anchor: DateStr) => {
    const lateStart = new Map<TaskId, DateStr>()
    const lateFinish = new Map<TaskId, DateStr>()

    for (const id of [...graph.order].reverse()) {
      const task = byId.get(id)!
      let finish = constraintUpperBound(task, calendar, anchor)

      // 资源可用期的结束上界（availableUntil）—— 与任务自身的约束取较早者
      const latest = resourceBounds?.[id]?.latestFinish
      if (latest) {
        const latestWorkday = snapToWorkdayOrPrevious(latest, calendar)
        if (latestWorkday < finish) finish = latestWorkday
      }

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

      // 刻意**不**在逆推里夹下界 availableFrom（它与上界一样只各进一趟，见
      // forwardPass 顶部的说明）：lateStart 由 lateFinish 忠实倒推，晚窗口
      // [lateStart, lateFinish] 才始终有序。夹下界会让 lateStart 越过 lateFinish
      // —— 晚窗口反转，任何按 lateStart→lateFinish 求宽度的消费方得到负跨度。
      // 不可行（availableFrom 晚于 endDate 倒推出的开始日）时同样只以负浮时
      // 如实报冲突，不在这里夹。
      lateStart.set(id, taskStart(finish, task.duration, calendar))
    }

    return { lateStart, lateFinish }
  }

  // ── 定锚 ───────────────────────────────────────────────
  const firstPass = forwardPass(projectStart)
  let earlyStart = firstPass.earlyStart
  let earlyFinish = firstPass.earlyFinish
  const forwardFinish = latestOf([...earlyFinish.values()], projectStart)

  let reverseAnchor: DateStr
  if (direction === 'backward') {
    reverseAnchor = latestProjectEnd ?? forwardFinish
  } else {
    // forward 下 projectEnd 是「最晚必须完成」的期限：比算出的完成日更早时
    // 以它为准逆推，slack 自然变负，detectConflicts 会如实报出来。
    reverseAnchor =
      latestProjectEnd !== undefined && latestProjectEnd < forwardFinish
        ? latestProjectEnd
        : forwardFinish
  }

  const { lateStart, lateFinish } = backwardPass(reverseAnchor)

  if (direction === 'backward') {
    // 项目从终点往回推。正推锚点改用逆推结果里最早的开始日 ——
    // 这样「最早链」与「最晚链」共用同一个起点，totalSlack 才是真正的
    // 「可推迟量」，而不是「相对项目起点的前置量」。关键路径因此与
    // forward 完全一致（spec §4.4 判据 2）。
    //
    // earlyStart 与 earlyFinish 必须**一起**换掉：forward 模式下
    // scheduledFinish 就是从 earlyFinish 取的，只换 earlyStart 会让
    // 两个字段描述两个不同的排期。
    const reran = forwardPass(earliestOf([...lateStart.values()], projectStart))
    earlyStart = reran.earlyStart
    earlyFinish = reran.earlyFinish
  }

  // ── 自由宽延 ──────────────────────────────────────────
  //
  // 每条出边的松弛 = 「该依赖自己的正向下界」到「后继实际 earlyStart」的距离。
  // 用 forwardBound（而不是 spec §5.2 的 `workdaysBetween(earlyFinish, toEarlyStart) - 1`）
  // 是因为后者在 lag ≠ 0 时会高估：带 lag 的边一推就把后继带走，松弛应为 0。
  //
  // lag = 0 的 FS 边恒有 forwardBound = addWorkdays(earlyFinish, 1)，于是
  // workdaysBetween(addWorkdays(earlyFinish, 1), toEarlyStart)
  //   === workdaysBetween(earlyFinish, toEarlyStart) - 1
  // —— 两式在 lag = 0 时逐字等价，只是新式对四种依赖类型都成立。
  const freeSlackOf = (id: TaskId): number => {
    const successors = graph.outgoing.get(id) ?? []
    const totalSlack = workdaysBetween(earlyStart.get(id)!, lateStart.get(id)!, calendar)
    if (successors.length === 0) return totalSlack

    return Math.min(
      ...successors.map((dep) =>
        workdaysBetween(
          forwardBound({
            dep,
            fromStart: earlyStart.get(id)!,
            fromFinish: earlyFinish.get(id)!,
            toDuration: byId.get(dep.toTaskId)!.duration,
            fromDuration: byId.get(id)!.duration,
            cal: calendar,
          }),
          earlyStart.get(dep.toTaskId)!,
          calendar,
        ),
      ),
    )
  }

  // ── 浮时与关键路径 ─────────────────────────────────────
  const result: Record<TaskId, ComputedSchedule> = {}
  for (const id of graph.order) {
    const task = byId.get(id)!
    const slack = workdaysBetween(earlyStart.get(id)!, lateStart.get(id)!, calendar)
    const useLate = usesLateSchedule(task)

    result[id] = {
      earlyStart: earlyStart.get(id)!,
      earlyFinish: earlyFinish.get(id)!,
      lateStart: lateStart.get(id)!,
      lateFinish: lateFinish.get(id)!,
      scheduledStart: useLate ? lateStart.get(id)! : earlyStart.get(id)!,
      scheduledFinish: useLate ? lateFinish.get(id)! : earlyFinish.get(id)!,
      totalSlack: slack,
      freeSlack: freeSlackOf(id),
      isCritical: slack === 0,
    }
  }
  return result
}

/** 约束给出的「最早开始」下界。auto 任务下界即项目起点 */
function constraintLowerBound(task: Task, cal: Calendar, projectStart: DateStr): DateStr {
  if (task.scheduling.mode === 'auto') return projectStart

  // 约束日期是承载时刻的字段：进入 `taskStart` / `taskFinish` / 直接作为边界返回前先归一。
  const { type } = task.scheduling
  const date = toDateStr(task.scheduling.date)
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

  // 约束日期是承载时刻的字段：进入 `taskStart` / `taskFinish` / 直接作为边界返回前先归一。
  const { type } = task.scheduling
  const date = toDateStr(task.scheduling.date)
  switch (type) {
    case 'finishOn':
      return date
    case 'finishNoLaterThan':
      return snapToWorkdayOrPrevious(date, cal)
    case 'startOn':
      return taskFinish(date, task.duration, cal)
    case 'startNoLaterThan':
      return taskFinish(snapToWorkdayOrPrevious(date, cal), task.duration, cal)
    case 'startNoEarlierThan':
    case 'finishNoEarlierThan':
      return projectFinish
  }
}

function latestOf(dates: DateStr[], fallback: DateStr): DateStr {
  if (dates.length === 0) return fallback
  return dates.reduce((a, b) => (a > b ? a : b))
}

/** 取最早日期。空数组时用 fallback（与 latestOf 对称） */
function earliestOf(dates: DateStr[], fallback: DateStr): DateStr {
  if (dates.length === 0) return fallback
  return dates.reduce((a, b) => (a < b ? a : b))
}
