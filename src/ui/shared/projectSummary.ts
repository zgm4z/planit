import type { ComputedSchedule, DateStr, Project, TaskId } from '../../domain/model/types'
import { workdaysBetween } from '../../domain/calendar/workdays'

export interface ProjectSummary {
  start: DateStr
  finish: DateStr
  /** 含首尾两天，与甘特条宽度口径一致 */
  totalWorkdays: number
  /** 全部任务数（含摘要任务） */
  taskCount: number
}

/**
 * 项目摘要（spec §4「复用 StatusBar 的算法」）。**唯一的一份** ——
 * StatusBar 与项目面板都调它，避免「跨度」出现第二套实现。
 *
 * 只用**叶子任务**统计跨度：摘要任务的排期是从子任务汇总来的，
 * 重复计入不会改变 min/max，但会掩盖「没有叶子就没有真实排期」这一事实。
 * 没有任何叶子排期时返回 null（调用方决定空态文案）。
 *
 * ── 为什么带记忆化 ────────────────────────────────────────────────────────
 * 这是一次**全项目扫描**（12,400 任务会分配若干个同长度数组）。StatusBar 与
 * 项目面板在渲染期各调一次，而两者都会随滚动**每帧重渲染**（虚拟化器把可见
 * 区间存成内部 state，父组件 ProjectView 因此每帧重渲染）。入参不变时重算
 * 纯属浪费 —— 实测单次 ≈3ms。
 *
 * 缓存键就是**入参本身的对象标识**：project 每次变更都是新引用（immer + 展开，
 * 见 projectStore 的 dispatch），`result.schedules` 每次求解也是新对象。
 * 因此「引用相同 ⟺ 内容相同」，缓存不会给出陈旧结果。WeakMap 不阻止 GC。
 */
export function computeProjectSummary(
  project: Project,
  schedules: Record<TaskId, ComputedSchedule>,
): ProjectSummary | null {
  const cached = readSummaryCache(project, schedules)
  if (cached !== undefined) return cached

  const summary = computeProjectSummaryUncached(project, schedules)
  writeSummaryCache(project, schedules, summary)
  return summary
}

/**
 * 关键任务数（叶子口径）。与项目摘要同一类**全项目扫描**，故同样记忆化。
 *
 * 只按叶子统计 —— 摘要任务的关键标记是从子任务继承来的，重复计数会翻倍。
 */
export function countCriticalLeafTasks(
  project: Project,
  schedules: Record<TaskId, ComputedSchedule>,
): number {
  let bySchedules = criticalCache.get(project)
  if (!bySchedules) {
    bySchedules = new WeakMap()
    criticalCache.set(project, bySchedules)
  }

  const cached = bySchedules.get(schedules)
  if (cached !== undefined) return cached

  // 原 StatusBar 的实现即：叶子任务里、有排期且 isCritical 的条数
  // （`schedules[id]` 缺失 → undefined → 不计入，与旧的 `.filter(Boolean)` 等价）
  const count = Object.values(project.tasks).filter(
    (task) => task.childIds.length === 0 && schedules[task.id]?.isCritical,
  ).length
  bySchedules.set(schedules, count)
  return count
}

// ── 记忆化实现 ───────────────────────────────────────────────────────────
// 缓存键 = (project, schedules) 的对象标识（嵌套 WeakMap）。1 条就够：
// 同一次渲染周期里两个调用方用**同一对**引用，命中即省下一次全量扫描。
// 引用相同 ⟺ 内容相同（见上），WeakMap 不阻止 GC，故无陈旧、无泄漏。
//
// ⚠️ 「引用变 ⟺ 内容变」这条等价**依赖一条仓库级不变式：`project` 与 `schedules`
// 只换引用、绝不原地修改**。store 的每条写路径（`dispatch` / `undo` / `redo` /
// `loadProject` / `closeProject`）都返回新对象，命令层改的是 immer draft，`solve()`
// 每次产新 schedules —— 所以「内容变」必然伴随「引用变」。
//
// **若有调用方原地改了 `project` 却不换引用，这里会静默返回陈旧的摘要。**
// 仓库里确实存在这种写法（测试用例，见 `CalendarView.test.tsx` 对
// `project.calendars.default.exceptions` 的赋值）—— 它们随后都克隆了一次引用才没暴露。
// 新增调用方请照做：要么换引用，要么别原地改。

const summaryCache = new WeakMap<
  Project,
  WeakMap<Record<TaskId, ComputedSchedule>, ProjectSummary | null>
>()
const criticalCache = new WeakMap<
  Project,
  WeakMap<Record<TaskId, ComputedSchedule>, number>
>()

/** 命中返回值；未命中返回 undefined（ProjectSummary 本身不会返回 undefined） */
function readSummaryCache(
  project: Project,
  schedules: Record<TaskId, ComputedSchedule>,
): ProjectSummary | null | undefined {
  return summaryCache.get(project)?.get(schedules)
}

function writeSummaryCache(
  project: Project,
  schedules: Record<TaskId, ComputedSchedule>,
  summary: ProjectSummary | null,
): void {
  let bySchedules = summaryCache.get(project)
  if (!bySchedules) {
    bySchedules = new WeakMap()
    summaryCache.set(project, bySchedules)
  }
  bySchedules.set(schedules, summary)
}

function computeProjectSummaryUncached(
  project: Project,
  schedules: Record<TaskId, ComputedSchedule>,
): ProjectSummary | null {
  const leaves = Object.values(project.tasks)
    .filter((task) => task.childIds.length === 0)
    .map((task) => schedules[task.id])
    .filter((schedule): schedule is ComputedSchedule => Boolean(schedule))

  if (leaves.length === 0) return null

  const start = leaves.reduce(
    (acc, schedule) => (schedule.scheduledStart < acc ? schedule.scheduledStart : acc),
    leaves[0].scheduledStart,
  )
  const finish = leaves.reduce(
    (acc, schedule) => (schedule.scheduledFinish > acc ? schedule.scheduledFinish : acc),
    leaves[0].scheduledFinish,
  )
  const calendar = project.calendars[project.calendarId]

  return {
    start,
    finish,
    totalWorkdays: workdaysBetween(start, finish, calendar) + 1,
    taskCount: Object.keys(project.tasks).length,
  }
}
