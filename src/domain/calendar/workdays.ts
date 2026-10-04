import type { Calendar, DateStr, Scheduling } from '../model/types'
import { dayToIso, epochDay, weekdayMon0 } from '../dateUtils'

// 把基础日期工具转出去，让 calendar/ 的调用方不必同时 import 两个模块
export { parseDate, formatDate, addDays } from '../dateUtils'

/** 单次搜索的上限，避免日历配置错误导致死循环 */
const MAX_SCAN_DAYS = 3660

/**
 * ── 内部一律走「天整数」（见 dateUtils 顶部的说明）──────────────────────────
 *
 * 对外的函数保持 `DateStr` 入参出参**不变**：每个函数把字符串边界各转一次
 * `epochDay(iso)`，之后全用整数运算，末尾 `dayToIso` 转回。下面的 `*Day` 是
 * **这份字符串 API 的内部实现**（模块私有，不导出）—— 提速来自 `epochDay`/
 * `dayToIso` 的 memo 命中，而不是让调用方直接用整数。若将来某个热点确实需要
 * 直接吃天整数，再按需把对应的 `*Day` 导出；现在不预留死接口。
 *
 * `cal.exceptions` 只按**单日精确查表**（见 calendarCommands 的区间展开说明）。
 * 这里**不预计算**例外集合：日历对象在测试里会被就地改动
 * （`c.exceptions[date] = ...`），任何按对象身份缓存例外表的方案都会读到陈旧值；
 * 直接 `cal.exceptions[dayToIso(day)]` 查活动数据，既安全又只多一次查表。
 */
/** 周一 = 0 … 周日 = 6，与 Calendar.workingDays 的索引顺序一致 */
export function workdayIndex(iso: DateStr): number {
  return weekdayMon0(epochDay(iso))
}

/** 天整数版 `isWorkday`（字符串 API 的内部实现） */
function isWorkdayDay(day: number, cal: Calendar): boolean {
  // ⚠️ 查的是**规范键** `dayToIso(day)`，不是调用方原样的 `iso` 串。对规范输入
  // （`YYYY-MM-DD`，`dateTime.guard.test.ts` 守卫的形状，也是全仓唯一产出的形状）
  // 两者恒等；但 `'2026-3-6'` 这类非规范串会先被规范化，再查例外表 —— 与旧实现
  // 「拿原串直接查表」在非规范输入下结果可能不同（旧：查不到 → 按工作日；新：命中
  // 规范键 → 按例外）。这是有意的：例外表本就以规范日期为键。
  const exception = cal.exceptions[dayToIso(day)]
  if (exception) return exception.kind === 'custom'
  return cal.workingDays[weekdayMon0(day)]
}

export function isWorkday(iso: DateStr, cal: Calendar): boolean {
  return isWorkdayDay(epochDay(iso), cal)
}

function nextWorkdayDay(day: number, cal: Calendar): number {
  for (let i = 1; i <= MAX_SCAN_DAYS; i += 1) {
    const cursor = day + i
    if (isWorkdayDay(cursor, cal)) return cursor
  }
  throw new Error(`nextWorkday: 从 ${dayToIso(day)} 起扫描 ${MAX_SCAN_DAYS} 天未找到工作日，请检查日历配置`)
}

export function nextWorkday(iso: DateStr, cal: Calendar): DateStr {
  return dayToIso(nextWorkdayDay(epochDay(iso), cal))
}

function prevWorkdayDay(day: number, cal: Calendar): number {
  for (let i = 1; i <= MAX_SCAN_DAYS; i += 1) {
    const cursor = day - i
    if (isWorkdayDay(cursor, cal)) return cursor
  }
  throw new Error(`prevWorkday: 从 ${dayToIso(day)} 起扫描 ${MAX_SCAN_DAYS} 天未找到工作日，请检查日历配置`)
}

export function prevWorkday(iso: DateStr, cal: Calendar): DateStr {
  return dayToIso(prevWorkdayDay(epochDay(iso), cal))
}

function snapToWorkdayDay(day: number, cal: Calendar): number {
  return isWorkdayDay(day, cal) ? day : nextWorkdayDay(day, cal)
}

export function snapToWorkday(iso: DateStr, cal: Calendar): DateStr {
  return dayToIso(snapToWorkdayDay(epochDay(iso), cal))
}

/** 上界归一：保留工作日，否则向前吸附到最近的工作日（当日或之前）。 */
function snapToWorkdayOrPreviousDay(day: number, cal: Calendar): number {
  let cursor = day
  for (let i = 0; i < MAX_SCAN_DAYS; i += 1) {
    if (isWorkdayDay(cursor, cal)) return cursor
    cursor -= 1
  }
  throw new Error(
    `snapToWorkdayOrPrevious: 从 ${dayToIso(day)} 起扫描 ${MAX_SCAN_DAYS} 天未找到工作日，请检查日历配置`,
  )
}

export function snapToWorkdayOrPrevious(iso: DateStr, cal: Calendar): DateStr {
  return dayToIso(snapToWorkdayOrPreviousDay(epochDay(iso), cal))
}

/**
 * 在 `iso` 基础上推进 `n` 个工作日。`n` 可为负。
 * 起点若落在非工作日，先吸附到下一个工作日再计数。
 */
function addWorkdaysDay(day: number, n: number, cal: Calendar): number {
  let cursor = snapToWorkdayDay(day, cal)
  for (let i = 0; i < n; i += 1) cursor = nextWorkdayDay(cursor, cal)
  for (let i = 0; i > n; i -= 1) cursor = prevWorkdayDay(cursor, cal)
  return cursor
}

export function addWorkdays(iso: DateStr, n: number, cal: Calendar): DateStr {
  return dayToIso(addWorkdaysDay(epochDay(iso), n, cal))
}

/**
 * 计算 [a, b) 区间内的工作日数量（左闭右开）。
 * 若 a > b，返回负数。
 */
function workdaysBetweenDay(a: number, b: number, cal: Calendar): number {
  if (a === b) return 0
  const sign = a < b ? 1 : -1
  const from = sign > 0 ? a : b
  const to = sign > 0 ? b : a

  let count = 0
  for (let cursor = from; cursor < to; cursor += 1) {
    if (isWorkdayDay(cursor, cal)) count += 1
  }
  return count * sign
}

export function workdaysBetween(a: DateStr, b: DateStr, cal: Calendar): number {
  return workdaysBetweenDay(epochDay(a), epochDay(b), cal)
}

/**
 * 任务的结束日期：从 `start` 起，工期为 `duration` 个工作日（含起始日）。
 * 工期为 0（里程碑）时返回 `start` 本身吸附到的工作日。
 */
function taskFinishDay(start: number, duration: number, cal: Calendar): number {
  if (duration <= 0) return snapToWorkdayDay(start, cal)
  return addWorkdaysDay(start, duration - 1, cal)
}

export function taskFinish(start: DateStr, duration: number, cal: Calendar): DateStr {
  return dayToIso(taskFinishDay(epochDay(start), duration, cal))
}

/** 任务的开始日期：从 `finish` 倒推 `duration` 个工作日（含结束日）。 */
function taskStartDay(finish: number, duration: number, cal: Calendar): number {
  if (duration <= 0) return snapToWorkdayDay(finish, cal)
  return addWorkdaysDay(finish, -(duration - 1), cal)
}

export function taskStart(finish: DateStr, duration: number, cal: Calendar): DateStr {
  return dayToIso(taskStartDay(epochDay(finish), duration, cal))
}

/**
 * 一个 manual 排期区间：从 `start` 起、宽 `duration` 个工作日。
 *
 * 「开始日 + 工期 → 结束日」的算式**只有 `taskFinish` 一处实现**；本函数把该算式与
 * manual 的区间形态**绑成一个**，供命令层（moveTo / resize）与拖拽影子（barDrag）
 * 共用 —— 免得各调用点各写一份 `taskFinish(...)` 而悄悄漂移（Task 2 的拖拽 / 命令
 * 不一致正是这么来的）。
 *
 * 日历缺失（畸形项目）时退回 `finish = start`，绝不产出非法日期。
 */
export function manualInterval(
  start: DateStr,
  duration: number,
  cal: Calendar | undefined,
): Scheduling {
  return { mode: 'manual', start, finish: cal ? taskFinish(start, duration, cal) : start }
}

/**
 * `[start, finish]` 区间内的**含首尾**工作日数。两端先 `snapToWorkday` 归一
 * （与 manual 区间 / 拖拽落点同口径）；`start > finish` 时返回 0。
 *
 * 与 `workdaysBetween`（左闭右开、只计数）配对：本函数把「排期跨度」折成「工期」，
 * 是 `taskFinish` / `taskStart` 的逆运算（对工作日对齐的区间）。
 */
export function workdaysInclusive(start: DateStr, finish: DateStr, cal: Calendar): number {
  const from = snapToWorkdayDay(epochDay(start), cal)
  const to = snapToWorkdayDay(epochDay(finish), cal)
  if (from > to) return 0
  return workdaysBetweenDay(from, to, cal) + 1
}

/**
 * `[start, finish]` 区间内的全部工作日（**含首尾**），升序。
 * `start` 落在非工作日时先吸附到下一个工作日（与 `snapToWorkday` 同口径）。
 * `start > finish` 时返回空数组。
 *
 * 与 `workdaysBetween` 的分工：后者只**计数**（左闭右开），本函数给**列表** ——
 * 负载要逐个日期累加，需要列表。日期迭代只此一处，别在调度器里再写一遍。
 */
export function workdaysInRange(start: DateStr, finish: DateStr, cal: Calendar): DateStr[] {
  const out: DateStr[] = []
  let cursor = snapToWorkdayDay(epochDay(start), cal)
  const to = epochDay(finish)
  while (cursor <= to) {
    out.push(dayToIso(cursor))
    cursor = nextWorkdayDay(cursor, cal)
  }
  return out
}
