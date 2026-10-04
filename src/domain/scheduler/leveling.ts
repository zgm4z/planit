import type {
  Calendar,
  ComputedSchedule,
  DateStr,
  LevelingResult,
  ResourceId,
  Task,
  TaskId,
  ResourceOverload,
} from '../model/types'
import type { ScheduleContext } from './context'
import type { TaskGraph } from './graph'
import { forwardBound } from './constraints'
import {
  addWorkdays,
  nextWorkday,
  snapToWorkday,
  taskFinish,
  workdaysBetween,
  workdaysInRange,
} from '../calendar/workdays'
import { toDateStr } from '../calendar/dateTime'

/** 超载判定阈值：`> 1 + ε` 才算超载。0.5 / 0.25 这类单位累加带浮点误差，ε 防误报 */
const OVERLOAD_EPSILON = 1e-9

/** 一个任务在某一版排期里的占位区间（含首尾工作日） */
export interface LeveledDates {
  start: DateStr
  finish: DateStr
}

/** `resourceDayLoad` 的**可选**工作日 memo：`taskId → 该任务当前区间的全部工作日`。
 *  同一区间的 `workdaysInRange` 只算一次 —— `levelLeaves` 每轮重建负载时，绝大多数
 *  任务区间没变，省下的正是最贵的日期解析（`nextWorkday` 链）。纯 memo，不改变结果；
 *  省略时行为与不带缓存完全一致（UI 调用点不受影响）。 */
export type WorkdayCache = Map<TaskId, { start: DateStr; finish: DateStr; days: DateStr[] }>

/**
 * 每个资源每日负载：`resourceId → (date → Σ assignmentUnits)`。
 *
 * **这是「资源负载」的唯一实现** —— UI 与算法都读它，绝不重算 `availability × units ×
 * efficiency`（Σunits 的同一份原语在 `model/units.ts`，见 v0.5 的教训）。
 *
 * `dates` 是「任务的占位区间」（可能是 CPM 的 early/scheduled，也可能是平衡后的）。
 * 悬空分配（指向不存在资源）与缺区间的任务（摘要）被忽略。
 *
 * `cache` 见 `WorkdayCache`：仅供 `levelLeaves` 的内部循环复用，省略即无缓存。
 */
export function resourceDayLoad(
  context: ScheduleContext,
  dates: Readonly<Record<TaskId, LeveledDates>>,
  cache?: WorkdayCache,
): Map<ResourceId, Map<DateStr, number>> {
  const load = new Map<ResourceId, Map<DateStr, number>>()

  for (const [resourceId, assignments] of context.assignmentsByResource) {
    let byDay: Map<DateStr, number> | undefined
    for (const assignment of assignments) {
      const span = dates[assignment.taskId]
      const units = context.assignmentUnitsById.get(assignment.id) ?? 0
      if (!span || units <= 0) continue

      const cached = cache?.get(assignment.taskId)
      let days: DateStr[]
      if (cached && cached.start === span.start && cached.finish === span.finish) {
        days = cached.days
      } else {
        days = workdaysInRange(span.start, span.finish, context.calendar)
        cache?.set(assignment.taskId, { start: span.start, finish: span.finish, days })
      }

      byDay ??= new Map<DateStr, number>()
      for (const day of days) {
        byDay.set(day, (byDay.get(day) ?? 0) + units)
      }
    }
    if (byDay) load.set(resourceId, byDay)
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

/**
 * 平衡的安全预算：无论输入多刁钻，`levelLeaves` 都必须在有界步数 / 墙钟内返回。
 *
 * **为什么要有它**：修订前「每轮推 1 个工作日」的策略，迭代数以「总需推迟的**任务-日**」
 * 计 —— 500 叶子、~20% 超容的计划要十几万轮，每轮又全量重算负载 + 正推，于是
 * n³ 级卡死主线程（浏览器假死数分钟）。主修复（直接跳到可行槽位）已把轮数压到
 * O(叶子数)，但**不能**把「绝不冻 UI」寄托在修复的正确性上：任何未来的病态输入都应
 * **优雅降级** —— 到点即停，把未消除的超载交给 `unresolved` 如实上报。慢而诚实的答案
 * 好过冻死的标签页。
 *
 * 预算取值：`maxElapsedMs` 取 **4s** —— 这是「主线程可接受的同步上限」，而非「完整性
 * 保证」：500 叶子 / 15 资源高争用实测 ~1.6s，安然在其下；更大的计划若需更久，就在 4s
 * 处**优雅截断**（`budgetExhausted=true` + 如实 unresolved），而不是把标签页冻住数分钟。
 * `maxIterations`（10 万）是与之配套的结构性兜底（正常收敛远在其下：500 叶子约 800 轮）。
 */
export interface LevelingBudget {
  /** 迭代轮数上限（每轮最多推走一个候选；见 levelLeaves 的终止性论证） */
  maxIterations: number
  /** 墙钟上限（毫秒）。到点即停，剩余超载交给 unresolved —— 绝不冻 UI */
  maxElapsedMs: number
}

const DEFAULT_BUDGET: LevelingBudget = { maxIterations: 100000, maxElapsedMs: 4000 }

/**
 * **测试专用**钩子（生产调用点不传）。`levelLeaves` 每轮开始时回调**当前的增量负载表**
 * 与对应的 `dates`，供不变量测试与 `resourceDayLoad(context, dates)` 的全量重建对拍 ——
 * 这是「增量状态静默漂移」这一经典 bug 的守卫。缺省 undefined 时零开销（一个短路判断）。
 */
export interface LevelingHooks {
  onIteration?: (
    load: ReadonlyMap<ResourceId, ReadonlyMap<DateStr, number>>,
    dates: Readonly<Record<TaskId, LeveledDates>>,
  ) => void
}

/** 一个叶子在某资源上的占用量（只收 units > 0 的分配，与 `resourceDayLoad` 同口径） */
interface ResourceUsage {
  readonly resourceId: ResourceId
  readonly units: number
}

/** 增量维护的「超载格」：与 `collectOverloads` 的产出同形，但只存当前超载的格。
 *  `key` 是 `cellKeyOf(resourceId, date)` 的缓存 —— 每轮扫描超载集都要查 `frozenAt`，
 *  预存键省掉每格每轮的字符串拼接。 */
interface OverloadedCell {
  readonly resourceId: ResourceId
  readonly date: DateStr
  readonly key: string
  load: number
}

/**
 * `a` 是否比 `b` 更该被选中为「最坏格」。判据与旧实现的
 * 「先 `collectOverloads`（资源 id、日期升序）→ 再按负载降序稳定排序 → 取首个」
 * **等价**：负载降序，同负载时资源 id 升序、日期升序。
 */
function isWorseCell(a: OverloadedCell, b: OverloadedCell): boolean {
  if (a.load !== b.load) return a.load > b.load
  if (a.resourceId !== b.resourceId) return a.resourceId < b.resourceId
  return a.date < b.date
}

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
  graph: TaskGraph,
  durations: ReadonlyMap<TaskId, number>,
  calendar: Calendar,
  base: Readonly<Record<TaskId, LeveledDates>>,
  delays: ReadonlyMap<TaskId, number>,
  manualIds: ReadonlySet<TaskId>,
): Record<TaskId, LeveledDates> {
  const out: Record<TaskId, LeveledDates> = {}

  for (const id of graph.order) {
    // manual：区间为定值 —— 跳过延迟与全部入边下界（与 runCpm 的正推同一条规则，
    // spec §2.2：manual 不被任何机制移动）。其**出边照常**给后继提供下界（out 已落表）。
    // 不特判会让 base 里的 manual.start 被前驱的 forwardBound 顶掉 —— 那正是「被机制移动」。
    if (manualIds.has(id)) {
      out[id] = { start: base[id]!.start, finish: base[id]!.finish }
      continue
    }

    let start = addWorkdays(base[id]!.start, delays.get(id) ?? 0, calendar)

    for (const dep of graph.incoming.get(id) ?? []) {
      const from = out[dep.fromTaskId]!
      const bound = forwardBound({
        dep,
        fromStart: from.start,
        fromFinish: from.finish,
        toDuration: durations.get(id) ?? 0,
        fromDuration: durations.get(dep.fromTaskId) ?? 0,
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
 * 候选 T 起步落在 `target` 是否**可行**：它占位的每一天、它持有的每个资源上，
 * 「其余任务当日负载 + T 的占用量」都不超 100%。这是把「推 1 天再测」换成
 * 「一次算到可行槽位」的核心判据（见 `levelLeaves`）。
 *
 * 微妙处：`load` 是**含 T 当前占用**的全量负载。若某天同时落在 T 的当前区间与目标区间，
 * T 本就占着它（搬与不搬，该天负载不变）→ 只看 current；否则 current 里没有 T →
 * 看 `current + units`。
 *
 * 取舍（**有意**）：判据要求**整段**都放得下。于是「哪儿都放不下」的候选**根本不会被移动**
 * —— 而旧实现仍会把它推 1 个工作日，可能因此压低峰值。差分模糊测试下两种做法各有胜负
 * （约 35 差 / 36 好，最差一例残余超载多 3.0 单位；200/300 叶子规模上新实现反而更好，
 * 500 叶子略差）。之所以选「不移动」：回退到逐日推进，会把这个修复所针对的**高争用**
 * 场景重新拖慢 —— 那正是它要解决的问题。这不是 bug，别按 bug 修。
 */
function fitsAt(
  calendar: Calendar,
  durations: ReadonlyMap<TaskId, number>,
  usagesByLeaf: ReadonlyMap<TaskId, readonly ResourceUsage[]>,
  load: ReadonlyMap<ResourceId, ReadonlyMap<DateStr, number>>,
  current: LeveledDates | undefined,
  taskId: TaskId,
  target: DateStr,
): boolean {
  const usages = usagesByLeaf.get(taskId)
  if (!usages || usages.length === 0) return true
  const finish = taskFinish(target, durations.get(taskId) ?? 0, calendar)
  for (const day of workdaysInRange(target, finish, calendar)) {
    const inCurrent = current !== undefined && day >= current.start && day <= current.finish
    for (const usage of usages) {
      const value = load.get(usage.resourceId)?.get(day) ?? 0
      const without = inCurrent ? value - usage.units : value
      if (without + usage.units > 1 + OVERLOAD_EPSILON) return false
    }
  }
  return true
}

/**
 * 从候选 T 的**当前起点**起逐工作日找**最早的可行起点**（`fitsAt` 通过且 ≤ `lateStart`）。
 * 找不到（浮时窗口内没有能容纳它的位置）→ null，调用方试下一个候选。
 *
 * 起点含当前起点：候选必然覆盖某个超载格，故当前起点一定被判不可行 —— 于是第一个
 * 返回的 target 必**严格晚于**当前起点（`delays` 严格 +，终止性与单调性由此保证）。
 */
function findFeasibleStart(
  calendar: Calendar,
  durations: ReadonlyMap<TaskId, number>,
  usagesByLeaf: ReadonlyMap<TaskId, readonly ResourceUsage[]>,
  load: ReadonlyMap<ResourceId, ReadonlyMap<DateStr, number>>,
  dates: Readonly<Record<TaskId, LeveledDates>>,
  taskId: TaskId,
  lateStart: DateStr,
): DateStr | null {
  const current = dates[taskId]
  if (!current) return null
  let target = current.start
  while (target <= lateStart) {
    if (fitsAt(calendar, durations, usagesByLeaf, load, current, taskId, target)) return target
    target = nextWorkday(target, calendar)
  }
  return null
}

/**
 * 平衡是否越界：任一任务的 start 超过它的 lateStart（= 推迟了项目完成）。
 * `order` 传入 `graph.order`（= `next` 的键集且同序）—— 避免每轮用 `Object.entries`
 * 为 10k 个任务分配 10k 个 `[key, value]` 数组（GC 热点），结果不变。
 */
function exceedsLateStart(
  order: readonly TaskId[],
  next: Readonly<Record<TaskId, LeveledDates>>,
  schedules: Readonly<Record<TaskId, ComputedSchedule>>,
): boolean {
  for (const id of order) {
    const span = next[id]
    const schedule = schedules[id]
    if (span && schedule && span.start > schedule.lateStart) return true
  }
  return false
}

/**
 * 资源平衡（spec §2）。**纯函数**：输入 CPM 的排期，输出「平衡后每叶子的占位区间」
 * 与「推量 / 无法消除的超载」。
 *
 * 迭代（spec §2 伪码）：
 *   ① 算负载 → ② 找超载最严重的（资源/日期）→ ③ 在当事任务里选优先级最低者，
 *   **一次跳到最早的可行槽位** → ④ 越界则回退并试下一个候选；全推不动 → 按**当前负载**
 *   冻结该格 → 继续下一处。
 *
 * 「用浮时推」= 目标恒被夹到 `lateStart`（`findFeasibleStart` 的搜索上界，等价于旧
 * 实现的 `remainingSlack` 夹取），且推后仍校验 `∀ start ≤ lateStart`。
 * 因此**绝不违反依赖、绝不推迟项目完成**（ROADMAP 验收判据）。
 *
 * ── v0.7：整段跳到可行槽位（性能修复）────────────────────────────────────
 * 旧实现「每轮推 1 个工作日」，迭代数 ∝ 需推迟的**任务-日**总数；每轮还全量重算负载
 * + 一次整图正推 → 总代价 ≈ n³，500 叶子即卡死主线程数分钟。
 * 现改为：对候选 T，用 `findFeasibleStart` **一次**算出最早的可行起点并跳过去，
 * 只跑**一次** `leveledForwardPass`。每次成功推 target 都严格晚于当前起点，
 * 故 `delays` 严格 +≥1 个工作日、单调递增，收敛所需的「推」次数由 10⁵ 降到 O(叶子数)。
 *
 * ⚠️ **结果不与旧实现逐字等价。** 旧实现逐日推进、可能停在某个非最优点；新实现直接取
 * 最早可行槽位，两者在「候选无处可放」时的处理也不同（见 `fitsAt` 上方的取舍说明）。
 * 既有黄金夹具的期望值**未变**，但那是这几个小夹具的巧合，**不是普遍保证**——同一输入
 * 在新旧实现下可能得到不同的日期（只要都满足上面那三条判据就都是合法输出）。
 * 别把「夹具没变」当成「可以安全回退到逐日推进」的依据。
 *
 * ── v0.6.1：冻结必须「按负载」，不能是永久 ────────────────────────────────
 * 旧实现把「推不动」的格子永久 `blocked`。但「推不动」只对**当时的候选集**成立：
 * 后续别的格子被推时，可能把新的**可动**任务挪到这一格上，负载反而增长，
 * 而此时循环再也不回来看它 —— 真实数据里 `黄伟斌 @ 2026-09-21` 因此从本来
 * 不可约的 6 涨到 8（6 个锁死任务 + 2 个本可推走的 auto 任务）。
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
 *   (a) 成功推一次 → 某个 `delays` 严格 +≥1（`delays` 单调不减）→ Σ delays 严格 +≥1；
 *   (b) 没有候选可推 → 冻结（或更新）某个格子，把它的冻结负载抬到当前值。
 * (a) 至多发生 S 次（Σ delays ≤ S，且只会增）。
 * 对同一格子的两次冻结之间，必然发生过至少一次成功推（否则它的负载不会超过上次
 * 冻结值，也就不会被重新纳入考虑）→ 每个格子的冻结次数 ≤ 1 + S。
 * 故总轮数 ≤ S + #格子 × (1 + S)，有限。`budget` 是最后的安全网：即便论证被未来改动
 * 破坏，也只会优雅降级（留 unresolved），绝不挂起。
 */
export function levelLeaves(
  context: ScheduleContext,
  durations: ReadonlyMap<TaskId, number>,
  schedules: Readonly<Record<TaskId, ComputedSchedule>>,
  budget: LevelingBudget = DEFAULT_BUDGET,
  hooks?: LevelingHooks,
): { result: LevelingResult; dates: Record<TaskId, LeveledDates> } {
  const { project, leaves, calendar, graph } = context

  const base: Record<TaskId, LeveledDates> = {}
  const slack = new Map<TaskId, number>()
  // manual 任务：区间为定值，平衡不得推动（spec §2.5）。它们在 CPM 里 slack 恒 0，
  // 剩余浮时本就不会被推；但延迟正推的**基线**若被前驱下界改写同样算「被移动」，
  // 故这里显式收集，交给 leveledForwardPass 跳过。
  const manualIds = new Set<TaskId>()
  for (const leaf of leaves) {
    const schedule = schedules[leaf.id]
    base[leaf.id] = schedule
      ? { start: schedule.scheduledStart, finish: schedule.scheduledFinish }
      // 无排期兜底：这两处日期随后进 `addWorkdays`，必须是纯日期 —— 先归一。
      : { start: toDateStr(project.startDate), finish: toDateStr(project.startDate) }
    slack.set(leaf.id, schedule ? remainingSlack(schedule, calendar) : 0)
    if (leaf.scheduling.mode === 'manual') manualIds.add(leaf.id)
  }

  // 初始延迟 = 用户 delay（工作日，floor），夹到剩余浮时（偏差 2）
  const delays = new Map<TaskId, number>()
  for (const leaf of leaves) {
    delays.set(leaf.id, Math.min(Math.max(0, Math.round(leaf.delay)), slack.get(leaf.id) ?? 0))
  }

  // 预索引：每个叶子持有的资源及占用量（同一资源的多条分配先求和）；每个资源被哪些
  // 叶子持有。判据与 `resourceDayLoad` 一致 —— 只收 `units > 0` 的分配，否则一条
  // `units=0` 的分配会让对负载毫无贡献的任务被当成候选推走（白耗浮时、污染 delays）。
  // 「候选 = 该资源该日的当事叶子」由此直接查表，不再每轮全量扫 leaves。
  const usagesByLeaf = new Map<TaskId, ResourceUsage[]>()
  const leavesByResource = new Map<ResourceId, TaskId[]>()
  const leafById = new Map<TaskId, Task>()
  for (const leaf of leaves) {
    leafById.set(leaf.id, leaf)
    const perResource = new Map<ResourceId, number>()
    for (const assignment of context.assignmentsByTask.get(leaf.id) ?? []) {
      const units = context.assignmentUnitsById.get(assignment.id) ?? 0
      if (units <= 0) continue
      perResource.set(assignment.resourceId, (perResource.get(assignment.resourceId) ?? 0) + units)
    }
    const usages: ResourceUsage[] = [...perResource].map(([resourceId, units]) => ({
      resourceId,
      units,
    }))
    usagesByLeaf.set(leaf.id, usages)
    for (const usage of usages) {
      const list = leavesByResource.get(usage.resourceId) ?? []
      list.push(leaf.id)
      leavesByResource.set(usage.resourceId, list)
    }
  }

  let dates = leveledForwardPass(graph, durations, calendar, base, delays, manualIds)

  // 推不动的超载（资源@日期）→ 记录**冻结时的负载**（不是永久标记）。
  // 只在「当前负载 ≤ 冻结负载」时跳过：负载一旦增长就说明旧冻结的候选集已失效，
  // 需要重新尝试（详见函数头注释的 v0.6.1 说明与终止性论证）。
  const frozenAt = new Map<string, number>()
  const cellKeyOf = (resourceId: ResourceId, date: DateStr): string => `${resourceId}@${date}`

  // 未变任务的工作日列表 memo（日期解析是热点，见 WorkdayCache）：初始建表用一次，
  // 之后每次接受推动时，被移动任务的**旧区间**通常已在此命中。
  const workdayCache: WorkdayCache = new Map()

  // ── 增量负载（v0.8）─────────────────────────────────────────────────────
  // 旧实现每轮 `resourceDayLoad` 全量重建负载表 + `collectOverloads` 全表扫描排序 ——
  // 这是 10k×15 资源下 ~8.4ms/轮的主要来源（resourceDayLoad 25.7%、collectOverloads
  // 14.6%）。现在负载表**只建一次**，此后每次**接受**的推动只对「日期发生变化的叶子」
  // 施加 delta（旧区间减、新区间加）；被 `leveledForwardPass` 带走的后继同样在
  // `dates` 的差集里，故一并覆盖。**拒绝**的推动已回滚 → 不施加 delta、状态不动。
  // 超载集合同步增量维护：某格负载跨越阈值时才进/出集合。每轮改为对**超载集合**
  // 单次扫描取最坏格（不再全表扫描 + 全排序）。结果与旧实现逐字节一致，见
  // `leveling.incremental.test.ts` 的不变量与差分测试。
  const load = resourceDayLoad(context, dates, workdayCache)
  const overloaded = new Map<string, OverloadedCell>()
  for (const [resourceId, byDay] of load) {
    for (const [date, value] of byDay) {
      if (value > 1 + OVERLOAD_EPSILON) {
        const key = cellKeyOf(resourceId, date)
        overloaded.set(key, { resourceId, date, key, load: value })
      }
    }
  }

  /**
   * 对单格施加 delta，并同步维护结构 + 超载集合。
   * 结构维护与 `resourceDayLoad` 的全量重建**同形**：负载归 0 的日键删除、资源表空则删除
   * ——否则残留 0 键会让不变量测试与重建结果结构不一致。
   */
  const bump = (resourceId: ResourceId, date: DateStr, delta: number): void => {
    const key = cellKeyOf(resourceId, date)
    const byDay = load.get(resourceId)
    const oldValue = byDay?.get(date) ?? 0
    const newValue = oldValue + delta

    if (newValue <= 0) {
      if (byDay) {
        byDay.delete(date)
        if (byDay.size === 0) load.delete(resourceId)
      }
    } else if (byDay) {
      byDay.set(date, newValue)
    } else {
      const created = new Map<DateStr, number>()
      created.set(date, newValue)
      load.set(resourceId, created)
    }

    if (newValue > 1 + OVERLOAD_EPSILON) {
      const cell = overloaded.get(key)
      if (cell) cell.load = newValue
      else overloaded.set(key, { resourceId, date, key, load: newValue })
    } else if (oldValue > 1 + OVERLOAD_EPSILON) {
      overloaded.delete(key)
    }
  }

  /** 某任务某区间的全部工作日；命中 `workdayCache` 则复用（与 `resourceDayLoad` 同口径） */
  const daysOf = (taskId: TaskId, span: LeveledDates): DateStr[] => {
    const cached = workdayCache.get(taskId)
    if (cached && cached.start === span.start && cached.finish === span.finish) return cached.days
    const days = workdaysInRange(span.start, span.finish, calendar)
    workdayCache.set(taskId, { start: span.start, finish: span.finish, days })
    return days
  }

  /** 接受一次推动后，对**所有**日期变化的叶子施加增量（先按格净额合并，减少浮点运算） */
  const applyDeltas = (
    before: Readonly<Record<TaskId, LeveledDates>>,
    after: Record<TaskId, LeveledDates>,
  ): void => {
    const net = new Map<string, { resourceId: ResourceId; date: DateStr; delta: number }>()
    const add = (resourceId: ResourceId, date: DateStr, delta: number): void => {
      const key = cellKeyOf(resourceId, date)
      const entry = net.get(key)
      if (entry) entry.delta += delta
      else net.set(key, { resourceId, date, delta })
    }
    for (const id of graph.order) {
      const from = before[id]!
      const to = after[id]!
      if (from.start === to.start && from.finish === to.finish) continue
      const usages = usagesByLeaf.get(id)
      if (!usages || usages.length === 0) continue
      for (const usage of usages) {
        // 悬空资源（分配指向不存在的资源）在 `resourceDayLoad` 里被忽略 —— 这里同步忽略，
        // 否则 delta 会给不存在的资源凭空建出负载格，与全量重建不一致。
        if (!context.assignmentsByResource.has(usage.resourceId)) continue
        for (const day of daysOf(id, from)) add(usage.resourceId, day, -usage.units)
        for (const day of daysOf(id, to)) add(usage.resourceId, day, usage.units)
      }
    }
    for (const { resourceId, date, delta } of net.values()) {
      // delta === 0：该格上一任务离开、另一任务以等量单位进入（净额抵消）→ 跳过 bump。
      // 全量重建会按新的任务集合重新求和，两者在非二进制分数单位下可能差 ~1e-16
      // （远低于 1e-9 阈值，不影响任何决策）；不变量测试用相对容差覆盖这一情形。
      if (delta !== 0) bump(resourceId, date, delta)
    }
  }

  const startedAt = Date.now()
  let iterations = 0
  let budgetExhausted = false

  for (;;) {
    hooks?.onIteration?.(load, dates)

    // ② 超载最严重者：对**超载集合**单次扫描。跳过「已冻结且负载未增长」的格
    //    （v0.6.1：负载一旦超过冻结值就重新纳入考虑）。判据与旧实现等价 —— 见 isWorseCell。
    let worst: OverloadedCell | undefined
    for (const cell of overloaded.values()) {
      const frozen = frozenAt.get(cell.key)
      if (frozen !== undefined && cell.load <= frozen) continue
      if (worst === undefined || isWorseCell(cell, worst)) worst = cell
    }
    if (worst === undefined) break

    // 安全预算：到点即停，把剩余超载留给 unresolved 如实上报（绝不冻 UI）。
    // 放在「确认仍有超载」之后，故只有**真被截断**时才置位 —— 正常收敛不会误报。
    if (iterations >= budget.maxIterations || Date.now() - startedAt >= budget.maxElapsedMs) {
      budgetExhausted = true
      break
    }
    iterations += 1

    // ③ 候选 = 该资源该日的当事叶子，按优先级升序（数值小 = 先推），同序按 id 升序
    const candidates = (leavesByResource.get(worst.resourceId) ?? [])
      .filter((id) => {
        const span = dates[id]
        return span !== undefined && worst!.date >= span.start && worst!.date <= span.finish
      })
      .map((id) => leafById.get(id)!)
      .sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : 1))

    let pushed = false
    for (const candidate of candidates) {
      const lateStart = schedules[candidate.id]?.lateStart
      if (lateStart === undefined) continue // 无排期 → 无浮时预算，不可推

      // 一次跳到最早的可行槽位（而非逐日推）。target > 当前起点 ⇒ delays 严格 +。
      const target = findFeasibleStart(
        calendar,
        durations,
        usagesByLeaf,
        load,
        dates,
        candidate.id,
        lateStart,
      )
      if (target === null) continue // 浮时窗口内无可行槽位 → 试下一个候选

      const previous = delays.get(candidate.id) ?? 0
      delays.set(candidate.id, workdaysBetween(base[candidate.id]!.start, target, calendar))
      const next = leveledForwardPass(graph, durations, calendar, base, delays, manualIds)
      if (exceedsLateStart(graph.order, next, schedules)) {
        delays.set(candidate.id, previous) // 回退
        continue
      }
      applyDeltas(dates, next) // 接受：把负载增量化到新状态
      dates = next
      pushed = true
      break
    }

    // ④ 所有候选都推不动 → 按**当时的负载**冻结该格（负载再涨会被重新纳入考虑）
    if (!pushed) frozenAt.set(cellKeyOf(worst.resourceId, worst.date), worst.load)
  }

  return {
    result: {
      delays: Object.fromEntries(delays),
      // 收敛后的 unresolved 仍走一次全量重建：一次性、可忽略，且保证与用户可见输出
      // 完全同源（不把增量状态的浮点尾差暴露到结果里）。
      unresolved: collectOverloads(resourceDayLoad(context, dates)),
      budgetExhausted,
      iterations,
    },
    dates,
  }
}
