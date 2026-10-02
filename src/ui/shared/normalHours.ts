import type { Calendar } from '../../domain/model/types'
import { DEFAULT_START_TIME } from '../../domain/calendar/dateTime'

/**
 * 「正常时数」网格（星期几 × 小时）的**唯一**几何计算处。
 *
 * 为什么单独成模块而不是写进 `CalendarView.tsx`：网格要画一条绿块，绿块的起止
 * 是从 `Calendar` **推**出来的（模型没有「几点到几点」）。这条推导只有一处实现，
 * 才不会有第二处写成别的口径（本项目栽过「同一规则两份实现」多次）。
 * 放 `shared/` 还满足 `packageDeps.test.ts`：它只吃 `Calendar` 与领域常量，
 * **不** import 任何兄弟包。
 */

/** 网格纵轴的行数：一天 24 小时（00–23）。 */
export const HOURS_IN_DAY = 24

/**
 * 一天里全部小时的序号 —— 组件按它逐行铺。
 * 一提就知道顺序是 0..23，别在组件里再 `Array.from({length:24})` 一遍。
 */
export const HOURS = Array.from({ length: HOURS_IN_DAY }, (_, hour) => hour)

/**
 * 上班时刻的「小时」部分（09:00 → 9）。
 *
 * 取值**只从 `DEFAULT_START_TIME` 来** —— 组件与网格里都不许另写 `'09:00'` 字面量，
 * 否则常量改了、网格不改，绿块与实际默认上班时刻就静默错位。
 */
export const START_HOUR = Number(DEFAULT_START_TIME.slice(0, 2))

/**
 * 星期几的 i18n 键，**顺序即 `Calendar.workingDays` 的索引**（0 = 周一 … 6 = 周日）。
 * 网格的横轴就按这个顺序铺 —— 刻意**不是**参照里「周日打头」的排法（判断点 2，
 * 见 CalendarView 的注释）：全 App 的索引约定就是周一打头，两处不一致会读成 bug。
 */
export const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

/** 某一天的上班时段 —— 小时区间 `[from, to)`（左闭右开）。 */
export interface WorkBlock {
  from: number
  to: number
}

/**
 * 第 `dayIndex` 天（0 = 周一，与 `workingDays` 同序）的上班时段 `[from, to)`。
 * 该天不上班（或时段算不出长度为 0）时返回 `null` —— 网格那一列就不画绿块。
 *
 * 起点恒为 `START_HOUR`：模型只存「每日工时」的**长度**，不存开始时刻，
 * 故按项目默认上班时刻起算（与项目开始日 / 任务约束用同一个默认）。
 *
 * ⚠️ `to` 截到 24：纵轴只有 00–23。`hoursPerDay` 大到把下班点推过午夜时
 * （如 09:00 + 16h），跨过去的那几个小时画不出来 —— 这里**截断**而非回绕。
 * 这是本可视化的已知边界：模型允许的工时上限是「任意大」，而一天只有 24 小时。
 */
export function workBlockOfDay(calendar: Calendar, dayIndex: number): WorkBlock | null {
  if (!calendar.workingDays[dayIndex]) return null
  const to = Math.min(HOURS_IN_DAY, START_HOUR + calendar.hoursPerDay)
  // 长度为 0（hoursPerDay ≤ 0）时没有可画的块 —— 返回 null 而不是 0 高的空块
  return to > START_HOUR ? { from: START_HOUR, to } : null
}
