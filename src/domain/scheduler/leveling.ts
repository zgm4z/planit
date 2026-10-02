import type {
  Calendar,
  ComputedSchedule,
  DateStr,
  Dependency,
  LevelingResult,
  Project,
  ResourceId,
  Task,
  TaskId,
  ResourceOverload,
} from '../model/types'
import { assignmentUnits } from '../model/units'
import { workdaysInRange } from '../calendar/workdays'
import { buildGraph } from './graph'
import { forwardBound } from './constraints'
import { addWorkdays, snapToWorkday, taskFinish, workdaysBetween } from '../calendar/workdays'
import { toDateStr } from '../calendar/dateTime'

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

/** 推量的默认上限 —— 兜底防止异常数据造成死循环（正常会在浮时耗尽前收敛） */
const MAX_ITERATIONS = 100000

/**
 * 延迟正推：以每个任务当前的 `scheduledStart` 为**基线**，先加 `delays[id]` 个工作日，
 * 再取「所有入边 `forwardBound` 的最大值」。
 *
 * **不违反依赖是结构保证**：每个任务的 start 是显式地对全部入边下界取 max ——
 * 与 `runCpm` 的正推同一条规则（`forwardBound` 是同一份实现）。所以只要基线本身
 * 不违反依赖，加上任意的非负延迟也不会违反。
 *
 * 基线用 `scheduledStart`（asap 叶子 = earlyStart、alap 叶子 = lateStart）：
 * 对 alap 任务，基线即它已用满浮时的位置（见 remainingSlack），延迟恒被夹成 0。
 */
function leveledForwardPass(
  leaves: readonly Task[],
  dependencies: Dependency[],
  durations: ReadonlyMap<TaskId, number>,
  calendar: Calendar,
  base: Readonly<Record<TaskId, LeveledDates>>,
  delays: ReadonlyMap<TaskId, number>,
): Record<TaskId, LeveledDates> {
  const graph = buildGraph(leaves, dependencies)
  const out: Record<TaskId, LeveledDates> = {}

  for (const id of graph.order) {
    let start = addWorkdays(base[id]!.start, delays.get(id) ?? 0, calendar)

    for (const dep of graph.incoming.get(id) ?? []) {
      const from = out[dep.fromTaskId]!
      const bound = forwardBound({
        dep,
        fromStart: from.start,
        fromFinish: from.finish,
        toDuration: durations.get(id) ?? 0,
        cal: calendar,
      })
      if (bound > start) start = bound
    }

    start = snapToWorkday(start, calendar)
    out[id] = { start, finish: taskFinish(start, durations.get(id) ?? 0, calendar) }
  }

  return out
}

/** 剩余浮时 = 从当前排期到 `lateStart` 的工作日数。alap / 关键 / 负浮时任务均为 0 */
function remainingSlack(schedule: ComputedSchedule, calendar: Calendar): number {
  return Math.max(0, workdaysBetween(schedule.scheduledStart, schedule.lateStart, calendar))
}

/**
 * 某叶子是否在 `date` 这天、占用资源 `resourceId`（= 是否该超载的当事任务之一）。
 *
 * 判据必须与 `resourceDayLoad` 一致：后者跳过 `units <= 0` 的分配，所以这里也用
 * `assignmentUnits(...) > 0`（而非「存在分配」）—— 否则一条 `units=0` 的分配会让
 * 对负载毫无贡献的任务被当成候选推走，白耗浮时并在 `delays` 里报出与超载无关的值。
 */
function covers(
  project: Project,
  dates: Readonly<Record<TaskId, LeveledDates>>,
  taskId: TaskId,
  resourceId: ResourceId,
  date: DateStr,
): boolean {
  const span = dates[taskId]
  if (!span || date < span.start || date > span.finish) return false
  for (const assignment of Object.values(project.assignments)) {
    if (assignment.taskId !== taskId || assignment.resourceId !== resourceId) continue
    const resource = project.resources[assignment.resourceId]
    if (resource && assignmentUnits(resource, assignment) > 0) return true
  }
  return false
}

/** 平衡是否越界：任一任务的 start 超过它的 lateStart（= 推迟了项目完成） */
function exceedsLateStart(
  next: Readonly<Record<TaskId, LeveledDates>>,
  schedules: Readonly<Record<TaskId, ComputedSchedule>>,
): boolean {
  for (const [id, span] of Object.entries(next)) {
    const schedule = schedules[id]
    if (schedule && span.start > schedule.lateStart) return true
  }
  return false
}

/**
 * 资源平衡（spec §2）。**纯函数**：输入 CPM 的排期，输出「平衡后每叶子的占位区间」
 * 与「推量 / 无法消除的超载」。
 *
 * 迭代（spec §2 伪码）：
 *   ① 算负载 → ② 找超载最严重的（资源/日期）→ ③ 在当事任务里选优先级最低的、推 1 个工作日
 *   → ④ 越界则回退并试下一个候选；全推不动 → 按**当前负载**冻结该格 → 继续下一处。
 *
 * 「用浮时推」= 推量恒被夹到 `remainingSlack`（每次推后校验 `∀ start ≤ lateStart`）。
 * 因此**绝不违反依赖、绝不推迟项目完成**（ROADMAP 验收判据）。
 *
 * ── v0.6.1：冻结必须「按负载」，不能是永久 ────────────────────────────────
 * 旧实现把「推不动」的格子永久 `blocked`。但「推不动」只对**当时的候选集**成立：
 * 后续别的格子被推时，可能把新的**可动**任务挪到这一格上，负载反而增长，
 * 而此时循环再也不回来看它 —— 真实数据里 `黄伟斌 @ 2026-09-21` 因此从本来
 * 不可约的 6 涨到 8（6 个 `startOn` 锁死任务 + 2 个本可推走的 auto 任务）。
 *
 * 修法：`frozenAt: cellKey → 冻结时的负载`。每轮**只跳过「当前负载 ≤ 冻结负载」**的格子；
 * 一旦负载增长（说明有新候选落到该格上，旧冻结失效）就重新纳入考虑。
 *
 * 这个判据是**充分**的：格子负载只有在「某任务被成功推走/推来」时才会变，而一次
 * 只动一个任务；只要负载没涨，覆盖该格的任务集合就没有新增（任务只会越排越晚、
 * 绝不回退，故离开的任务也不会回来），冻结时的候选集仍全部浮时耗尽 → 依然推不动。
 *
 * ── 终止性论证 ────────────────────────────────────────────────────────
 * 记 S = Σ 各任务剩余浮时。每一轮迭代要么：
 *   (a) 成功推一次 → 某个 `delays` 严格 +1（`delays` 单调不减）→ Σ delays 严格 +1；
 *   (b) 没有候选可推 → 冻结（或更新）某个格子，把它的冻结负载抬到当前值。
 * (a) 至多发生 S 次（Σ delays ≤ S，且只会增）。
 * 对同一格子的两次冻结之间，必然发生过至少一次成功推（否则它的负载不会超过上次
 * 冻结值，也就不会被重新纳入考虑）→ 每个格子的冻结次数 ≤ 1 + S。
 * 故总轮数 ≤ S + #格子 × (1 + S)，有限。`MAX_ITERATIONS` 仍是最后的兜底。
 */
export function levelLeaves(
  project: Project,
  leaves: readonly Task[],
  durations: ReadonlyMap<TaskId, number>,
  calendar: Calendar,
  schedules: Readonly<Record<TaskId, ComputedSchedule>>,
): { result: LevelingResult; dates: Record<TaskId, LeveledDates> } {
  const dependencies = Object.values(project.dependencies)

  const base: Record<TaskId, LeveledDates> = {}
  const slack = new Map<TaskId, number>()
  for (const leaf of leaves) {
    const schedule = schedules[leaf.id]
    base[leaf.id] = schedule
      ? { start: schedule.scheduledStart, finish: schedule.scheduledFinish }
      // 无排期兜底：这两处日期随后进 `addWorkdays`，必须是纯日期 —— 先归一。
      : { start: toDateStr(project.startDate), finish: toDateStr(project.startDate) }
    slack.set(leaf.id, schedule ? remainingSlack(schedule, calendar) : 0)
  }

  // 初始延迟 = 用户 delay（工作日，floor），夹到剩余浮时（偏差 2）
  const delays = new Map<TaskId, number>()
  for (const leaf of leaves) {
    delays.set(leaf.id, Math.min(Math.max(0, Math.round(leaf.delay)), slack.get(leaf.id) ?? 0))
  }

  let dates = leveledForwardPass(leaves, dependencies, durations, calendar, base, delays)

  // 推不动的超载（资源@日期）→ 记录**冻结时的负载**（不是永久标记）。
  // 只在「当前负载 ≤ 冻结负载」时跳过：负载一旦增长就说明旧冻结的候选集已失效，
  // 需要重新尝试（详见函数头注释的 v0.6.1 说明与终止性论证）。
  const frozenAt = new Map<string, number>()
  const cellKey = (resourceId: ResourceId, date: DateStr): string => `${resourceId}@${date}`

  for (let iter = 0; iter < MAX_ITERATIONS; iter += 1) {
    const overloads = collectOverloads(resourceDayLoad(project, dates, calendar)).filter(
      (overload) => {
        const frozen = frozenAt.get(cellKey(overload.resourceId, overload.date))
        return frozen === undefined || overload.load > frozen
      },
    )
    if (overloads.length === 0) break

    // ② 超载最严重者：负载降序，其次资源 id、日期升序（确定性）
    overloads.sort((a, b) =>
      b.load !== a.load
        ? b.load - a.load
        : a.resourceId !== b.resourceId
          ? a.resourceId < b.resourceId
            ? -1
            : 1
          : a.date < b.date
            ? -1
            : a.date > b.date
              ? 1
              : 0,
    )
    const worst = overloads[0]

    // ③ 候选 = 该资源该日的当事叶子，按优先级升序（数值小 = 先推），同序按 id 升序
    const candidates = leaves
      .filter((leaf) => covers(project, dates, leaf.id, worst.resourceId, worst.date))
      .sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : 1))

    let pushed = false
    for (const candidate of candidates) {
      if ((delays.get(candidate.id) ?? 0) >= (slack.get(candidate.id) ?? 0)) continue // 浮时耗尽

      delays.set(candidate.id, (delays.get(candidate.id) ?? 0) + 1)
      const next = leveledForwardPass(leaves, dependencies, durations, calendar, base, delays)
      if (exceedsLateStart(next, schedules)) {
        delays.set(candidate.id, (delays.get(candidate.id) ?? 0) - 1) // 回退
        continue
      }
      dates = next
      pushed = true
      break
    }

    // ④ 所有候选都推不动 → 按**当时的负载**冻结该格（负载再涨会被重新纳入考虑）
    if (!pushed) frozenAt.set(cellKey(worst.resourceId, worst.date), worst.load)
  }

  return {
    result: {
      delays: Object.fromEntries(delays),
      unresolved: collectOverloads(resourceDayLoad(project, dates, calendar)),
    },
    dates,
  }
}
