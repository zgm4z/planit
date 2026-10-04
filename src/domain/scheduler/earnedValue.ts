import type {
  Baseline,
  BaselineComparison,
  Calendar,
  ComputedSchedule,
  DateStr,
  EarnedValue,
  Project,
  Task,
  TaskCosts,
  TaskId,
} from '../model/types'
import { workdaysBetween, workdaysInRange, type WorkdayIndex } from '../calendar/workdays'
import { toDateStr } from '../calendar/dateTime'

/**
 * 活动基线（activeBaselineId 指向的那一份）。
 *
 * `project.baselines ?? []` 是防御性的：手写的 Project 字面量（测试 / 旧夹具）
 * 可能没有这个字段。**不是**在容忍生产路径的缺字段 —— 生产一律经 createProject。
 */
export function activeBaseline(project: Project): Baseline | undefined {
  if (!project.activeBaselineId) return undefined
  return (project.baselines ?? []).find((baseline) => baseline.id === project.activeBaselineId)
}

/**
 * 计划完成比例（0–1）：基准排期里截至基准日**应已完成**的工作日数 / 基线总工作日数。
 *
 * 截至基准日 = `workdaysInRange(entry.start, min(基准日, entry.finish))` 的长度
 * —— 用 v0.6 的日期原语（含首尾）数工作日，**不在这里重写日期迭代**。
 * 基准日早于基线开始 → 0；不早于基线结束 → 1。
 * 里程碑（start === finish）视为 1 个工作日：日期到点即「该完成」。
 */
function plannedFraction(
  entry: { start: DateStr; finish: DateStr },
  statusDate: DateStr,
  cal: Calendar,
  index?: WorkdayIndex,
): number {
  // 参与比较的三个日期都先过唯一归一化入口，再落到**中性名**的局部量上：
  //   · `entry.start/finish` 本版仍是纯日期（spec 判断 B），包 `toDateStr` 对未来免疫；
  //   · `statusDate` 调用方已归一，`toDateStr` 幂等；
  //   · 用 `start/asOf/finish` 而非字段名，与 `effort.ts` 的 `from/until` 同源 —— 免得
  //     `dateTime.guard.test.ts`（按**字段名**紧贴运算符判违规）把已归一的量判成裸比较。
  const start = toDateStr(entry.start)
  const finish = toDateStr(entry.finish)
  const total = workdaysInRange(start, finish, cal, index).length
  if (total === 0) return 0 // 异常快照（finish < start）—— 不除零
  const asOf = toDateStr(statusDate)
  if (asOf < start) return 0
  const cap = asOf < finish ? asOf : finish
  return workdaysInRange(start, cap, cal, index).length / total
}

const clampPercent = (progress: number): number => Math.min(100, Math.max(0, progress))

const ZERO_EV: EarnedValue = { bac: 0, ev: 0, pv: null, sv: null }

/**
 * 每任务的挣值。**唯一实现** —— 列与 Inspector 都读它的输出，绝不重算
 * `BAC × progress/100`（本项目最恨的「同一概念两份实现」）。
 *
 *   BAC = costs.total（引擎已算好；摘要为子任务之和）
 *   EV  = BAC × clamp(progress, 0, 100)/100     ← progress 是 0–100（spec 缺陷 D1）
 *   PV  = BAC × plannedFraction(基线快照, 基准日)   ← 需要活动基线 + 基准日
 *   SV  = EV − PV                                ← **货币**（与工作日的 startVariance 不同量纲）
 *
 * 缺活动基线 / 缺基准日时 PV 与 SV 取 **null**（不是 0）—— 0 会被读成
 * 「完全按计划」，那是误导（计划偏差 4）。
 * 摘要任务 = 子任务汇总；PV 为 null 当且仅当**任一**子任务的 PV 是 null。
 *
 * 为什么是「任一」而不是「全部」（本版评审修正）：基线保存后**新增一个叶子任务**
 * 是基线工作流的正常操作 —— 新叶子在快照里没有条目，其 PV 为 null，而老叶子有值。
 * 若跳过 null 只累加有值的部分，摘要就会给出一个由**部分** PV 拼成、看起来完整的
 * SV，把「未纳入基线的任务」的 EV 也算进差异，**SV 被高估**。这与「缺活动基线 /
 * 缺基准日就 null」同源：算不出来就 null，不假装。
 */
export function collectEarnedValues(
  project: Project,
  costs: Record<TaskId, TaskCosts>,
  leaves: readonly Task[],
  // 可选日历例外索引：`solve()` 传 context 预建的那份。`plannedFraction` 的
  // `workdaysInRange` 数的是「基线区间内的工作日」（区间可跨整个基线跨度），带索引
  // 走 O(log k)；省略 → 逐日实现，结果相同。
  calendarIndex?: WorkdayIndex,
): Record<TaskId, EarnedValue> {
  const calendar = project.calendars[project.calendarId]
  const baseline = activeBaseline(project)
  // `project.statusDate` 是承载时刻的字段（spec §2.2）—— 进入比较前先归一，
  // 否则 `'…T18:00' < '…'` 恒假、`workdaysInRange` 收到带时刻串会静默算错。
  const statusDate = project.statusDate ? toDateStr(project.statusDate) : undefined

  const result: Record<TaskId, EarnedValue> = {}

  for (const leaf of leaves) {
    const bac = costs[leaf.id]?.total ?? 0
    const ev = bac * (clampPercent(leaf.progress) / 100)

    const entry = baseline?.entries[leaf.id]
    const pv =
      entry && statusDate ? bac * plannedFraction(entry, statusDate, calendar, calendarIndex) : null

    result[leaf.id] = { bac, ev, pv, sv: pv === null ? null : ev - pv }
  }

  const visit = (id: TaskId): EarnedValue => {
    const task = project.tasks[id]
    if (!task) return ZERO_EV
    if (task.childIds.length === 0) return result[id] ?? ZERO_EV

    let bac = 0
    let ev = 0
    let pv: number | null = null
    // 任一子任务 PV 为 null（该子任务未纳入基线快照 —— 如保存基线后新增的叶子 ——
    // 或缺基准日）→ 摘要 PV 同样为 null。只累加有值的部分会高估 SV（见函数头注释）。
    let pvIncomplete = false
    for (const childId of task.childIds) {
      const child = visit(childId)
      bac += child.bac
      ev += child.ev
      if (child.pv === null) pvIncomplete = true
      else pv = (pv ?? 0) + child.pv
    }
    if (pvIncomplete) pv = null

    const merged: EarnedValue = { bac, ev, pv, sv: pv === null ? null : ev - pv }
    result[id] = merged
    return merged
  }

  for (const rootId of project.rootIds) visit(rootId)
  return result
}

/**
 * 每任务相对活动基线的排期差异。**唯一实现**（spec §1.3）。
 *
 * 「当前」端取 `scheduledStart` / `scheduledFinish` —— 即**用户看到的日期**
 * （含 v0.6 资源平衡的最终结果），与全仓口径一致（spec 缺陷 D10）。
 * 差异是**工作日**（`workdaysBetween`），正数 = 延后。
 *
 * 快照里指向**已删除任务**的条目被跳过（spec §1.2：「查不到对应任务就跳过」）——
 * 这里不产出 diff 键，因此该任务的差异列无从渲染（它的行本就不存在）。
 * 摘要任务不在快照里 → 同样没有 diff 键。
 */
export function collectBaselineDiffs(
  project: Project,
  schedules: Record<TaskId, ComputedSchedule>,
  // 可选日历例外索引：`solve()` 传 context 预建的那份（差异区间可能跨整个项目）。
  // 省略 → `workdaysBetween` 走逐日实现，结果相同。
  calendarIndex?: WorkdayIndex,
): Record<TaskId, BaselineComparison> {
  const baseline = activeBaseline(project)
  if (!baseline) return {}

  const calendar = project.calendars[project.calendarId]
  const result: Record<TaskId, BaselineComparison> = {}

  for (const [taskId, entry] of Object.entries(baseline.entries)) {
    if (!project.tasks[taskId]) continue // 已删除的任务：跳过
    const schedule = schedules[taskId]
    if (!schedule) continue

    result[taskId] = {
      baselineStart: entry.start,
      baselineFinish: entry.finish,
      startVariance: workdaysBetween(entry.start, schedule.scheduledStart, calendar, calendarIndex),
      finishVariance: workdaysBetween(entry.finish, schedule.scheduledFinish, calendar, calendarIndex),
    }
  }

  return result
}
