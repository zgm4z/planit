import type {
  Calendar,
  ComputedSchedule,
  ConflictBinding,
  DateStr,
  DateTimeStr,
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
import { asLag, backwardBound, effectiveLagWorkdays, forwardBound } from './constraints'
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
      const scheduling = task.scheduling

      // manual：区间为定值 —— 直接取归一后的 manual 区间，**跳过**入边下界、
      // 约束下界与资源可用期下界（availableFrom）的 max（spec §2.2 + Ruling 2：
      // manual 不被任何机制移动，违反只报冲突）。其**出边照常**给后继提供下界。
      if (scheduling.mode === 'manual') {
        const span = manualSpan(scheduling, calendar)
        earlyStart.set(id, span.start)
        earlyFinish.set(id, span.finish)
        continue
      }

      let start = schedulingLowerBound(scheduling, task.duration, calendar, anchor)

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
      // latestFinish）。这与既有的约束机制 schedulingLowerBound /
      // schedulingUpperBound 完全同构：下界刻画最早起点、上界刻画最晚终点，
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
    // 负浮时归因：本任务最紧上界由哪条出边给出（仅当该边指向 manual 后继时才有意义）
    const bindings = new Map<TaskId, ConflictBinding>()

    for (const id of [...graph.order].reverse()) {
      const task = byId.get(id)!
      const scheduling = task.scheduling

      // manual：区间为定值 —— lateStart / lateFinish 直接取归一后的 manual 区间，
      // **跳过**出边上界、约束上界与资源可用期上界（availableUntil）的 min
      // （spec §2.2：manual 不被任何机制移动）。其**入边照常**给前置提供上界 ——
      // 前置被 manual 顶住 → 负浮时 → 冲突（由 detectConflicts 如实上报）。
      // manual 自身 late = early（浮时恒 0）→ 永不产生冲突，也就无需记录 binding。
      if (scheduling.mode === 'manual') {
        const span = manualSpan(scheduling, calendar)
        lateStart.set(id, span.start)
        lateFinish.set(id, span.finish)
        continue
      }

      let finish = schedulingUpperBound(scheduling, task.duration, calendar, anchor)

      // 资源可用期的结束上界（availableUntil）—— 与任务自身的约束取较早者
      const latest = resourceBounds?.[id]?.latestFinish
      if (latest) {
        const latestWorkday = snapToWorkdayOrPrevious(latest, calendar)
        if (latestWorkday < finish) finish = latestWorkday
      }

      // 约束 + 资源 给出的上界（不含出边）。归因时用它做「非依赖来源」的对照：
      // 只有出边**严格更紧**时，负浮时才可能归因到某个 manual 后继。
      const nonEdgeBound = finish

      // 逐出边取上界，并记下每条边给出的 bound 与其后继是否为 manual。
      const edgeBounds: { dep: Dependency; bound: DateStr; manual: boolean }[] = []
      for (const dep of graph.outgoing.get(id) ?? []) {
        const bound = backwardBound({
          dep,
          toStart: lateStart.get(dep.toTaskId)!,
          toFinish: lateFinish.get(dep.toTaskId)!,
          fromDuration: task.duration,
          cal: calendar,
        })
        edgeBounds.push({
          dep,
          bound,
          manual: byId.get(dep.toTaskId)!.scheduling.mode === 'manual',
        })
        if (bound < finish) finish = bound
      }

      finish = snapToWorkday(finish, calendar)
      lateFinish.set(id, finish)

      // 归因规则（本任务的负浮时由谁顶出来）：
      //   · 出边上界必须**严格紧于**约束 / 资源上界（`nonEdgeBound > finish`）；
      //   · 且所有「恰好取到最紧上界」的出边**都是**指向 manual 后继的
      //     （任何一条非 manual 出边打平，就说明 manual 后继并非唯一成因 → 不归因）；
      //   · 命中时取确定的一条（按 dep.id 升序）记下 binding。
      // 归因只是「显示用」的结构化提示；负浮时本身照旧如实上报，不改排期。
      if (nonEdgeBound > finish) {
        const tightest = edgeBounds.filter((edge) => edge.bound === finish)
        if (tightest.length > 0 && tightest.every((edge) => edge.manual)) {
          const chosen = [...tightest].sort((a, b) => (a.dep.id < b.dep.id ? -1 : 1))[0]
          const dep = chosen.dep
          // boundary 是「该边消费的后继端日期」：FS/SS 看后继开始（manual 即其 start），
          // FF/SF 看后继结束（manual 即其 finish）—— 正是 UI 要展示的「边界 {date}」。
          const boundary =
            dep.type === 'FF' || dep.type === 'SF'
              ? lateFinish.get(dep.toTaskId)!
              : lateStart.get(dep.toTaskId)!
          const lag = asLag(dep.lag)
          // elapsedDays 折不成工作日数（effectiveLagWorkdays 返回 NaN）——
          // 记 0，且文案不嵌数值（Ruling 2）。
          const lagDays =
            lag.kind === 'elapsedDays' ? 0 : effectiveLagWorkdays(lag, task.duration)
          bindings.set(id, { depType: dep.type, lagDays, boundary })
        }
      }

      // 刻意**不**在逆推里夹下界 availableFrom（它与上界一样只各进一趟，见
      // forwardPass 顶部的说明）：lateStart 由 lateFinish 忠实倒推，晚窗口
      // [lateStart, lateFinish] 才始终有序。夹下界会让 lateStart 越过 lateFinish
      // —— 晚窗口反转，任何按 lateStart→lateFinish 求宽度的消费方得到负跨度。
      // 不可行（availableFrom 晚于 endDate 倒推出的开始日）时同样只以负浮时
      // 如实报冲突，不在这里夹。
      lateStart.set(id, taskStart(finish, task.duration, calendar))
    }

    return { lateStart, lateFinish, bindings }
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

  const { lateStart, lateFinish, bindings: conflictBindings } = backwardPass(reverseAnchor)

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
    // manual 任务不可推迟（early = late = manual 区间）→ 自由宽延恒 0。
    // 不特判的话，「按出边松弛算」会在关键路径上的 manual 任务上得出正的 freeSlack
    // （totalSlack 却是 0），破坏 types.ts 对 `freeSlack ≤ totalSlack` 的约定。
    if (byId.get(id)!.scheduling.mode === 'manual') return 0

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
    // 负浮时归因（派生量，不落盘）：仅当本任务确为负浮时且逆推记下了 binding 时带上。
    const binding = slack < 0 ? conflictBindings.get(id) : undefined

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
      ...(binding ? { conflictBinding: binding } : {}),
    }
  }
  return result
}

/**
 * manual 任务的**归一区间**：两端都向前吸附到工作日（`snapToWorkday`，与拖拽落点
 * 同口径）。向前吸附（而非 finish 向前吸附）保证区间有序（start ≤ finish）、
 * 里程碑 `start === finish` 成立，且早链晚链取值一致 —— manual 不被任何机制移动。
 *
 * 引擎**不消费** `Task.duration`：区间宽度即真相。
 */
function manualSpan(
  scheduling: { start: DateTimeStr; finish: DateTimeStr },
  cal: Calendar,
): { start: DateStr; finish: DateStr } {
  return {
    start: snapToWorkday(toDateStr(scheduling.start), cal),
    finish: snapToWorkday(toDateStr(scheduling.finish), cal),
  }
}

/** `Scheduling` 的 auto 形态。manual 由各 pass 在进入边界计算前 `continue` 掉。 */
type AutoScheduling = Extract<Task['scheduling'], { mode: 'auto' }>

/**
 * auto 任务给出的「最早开始」下界（spec §2.3「各归其位」）：
 * - auto + `startConstraint.startNoEarlierThan` → 该日期
 * - auto + `finishConstraint.finishNoEarlierThan` → `taskStart(date, duration)` 折算
 * - 无 start 侧下界约束 → 项目起点
 *
 * 约束日期是承载时刻的字段：进入 `taskStart` / 直接作为边界返回前先 `toDateStr` 归一。
 * 两条下界同时存在时取较晚者（任务须同时满足）。
 *
 * ⚠️ 形参是 **auto 形态**、不含 manual：manual 任务在 forwardPass 里已 `continue`
 * （区间为定值，不取任何下界的 max —— spec §2.2 + Ruling 2），永不走到这里。
 * 用 `AutoScheduling` 把这条「不可达」变成「不可表示」：manual 传进来直接编译不过，
 * 不会留下两处（一处实测、一处死角）的 manual 语义。
 */
function schedulingLowerBound(
  scheduling: AutoScheduling,
  duration: number,
  cal: Calendar,
  projectStart: DateStr,
): DateStr {
  const bounds: DateStr[] = []
  if (scheduling.startConstraint?.type === 'startNoEarlierThan') {
    bounds.push(toDateStr(scheduling.startConstraint.date))
  }
  if (scheduling.finishConstraint?.type === 'finishNoEarlierThan') {
    bounds.push(taskStart(toDateStr(scheduling.finishConstraint.date), duration, cal))
  }
  return bounds.length === 0 ? projectStart : bounds.reduce((a, b) => (a > b ? a : b))
}

/**
 * auto 任务给出的「最晚结束」上界（spec §2.3）：
 * - auto + `finishConstraint.finishNoLaterThan` → `snapToWorkdayOrPrevious(date)`
 * - auto + `startConstraint.startNoLaterThan` → `taskFinish(snapToWorkdayOrPrevious(date), duration)`
 * - 无 finish 侧上界约束 → 项目完成日
 *
 * 周末上界语义（`snapToWorkdayOrPrevious` 一族）保持不动。两条上界同时存在时取较早者。
 *
 * ⚠️ 同样只接受 **auto 形态**（理由见 `schedulingLowerBound`）：manual 的上界在
 * backwardPass 里由 `manualSpan` 直接给定，不走这里。
 */
function schedulingUpperBound(
  scheduling: AutoScheduling,
  duration: number,
  cal: Calendar,
  projectFinish: DateStr,
): DateStr {
  const bounds: DateStr[] = []
  if (scheduling.finishConstraint?.type === 'finishNoLaterThan') {
    bounds.push(snapToWorkdayOrPrevious(toDateStr(scheduling.finishConstraint.date), cal))
  }
  if (scheduling.startConstraint?.type === 'startNoLaterThan') {
    bounds.push(
      taskFinish(snapToWorkdayOrPrevious(toDateStr(scheduling.startConstraint.date), cal), duration, cal),
    )
  }
  return bounds.length === 0 ? projectFinish : bounds.reduce((a, b) => (a < b ? a : b))
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
