import type { Calendar, DateStr } from '../model/types'
import { addDays, parseDate } from '../dateUtils'

// 把基础日期工具转出去，让 calendar/ 的调用方不必同时 import 两个模块
export { parseDate, formatDate, addDays } from '../dateUtils'

/** 单次搜索的上限，避免日历配置错误导致死循环 */
const MAX_SCAN_DAYS = 3660

/** 周一 = 0 … 周日 = 6，与 Calendar.workingDays 的索引顺序一致 */
export function workdayIndex(iso: DateStr): number {
  const jsDay = parseDate(iso).getDay() // 0 = 周日
  return (jsDay + 6) % 7
}

export function isWorkday(iso: DateStr, cal: Calendar): boolean {
  const exception = cal.exceptions[iso]
  if (exception) return exception.kind === 'custom'
  return cal.workingDays[workdayIndex(iso)]
}

export function nextWorkday(iso: DateStr, cal: Calendar): DateStr {
  let cursor = addDays(iso, 1)
  for (let i = 0; i < MAX_SCAN_DAYS; i += 1) {
    if (isWorkday(cursor, cal)) return cursor
    cursor = addDays(cursor, 1)
  }
  throw new Error(`nextWorkday: 从 ${iso} 起扫描 ${MAX_SCAN_DAYS} 天未找到工作日，请检查日历配置`)
}

export function prevWorkday(iso: DateStr, cal: Calendar): DateStr {
  let cursor = addDays(iso, -1)
  for (let i = 0; i < MAX_SCAN_DAYS; i += 1) {
    if (isWorkday(cursor, cal)) return cursor
    cursor = addDays(cursor, -1)
  }
  throw new Error(`prevWorkday: 从 ${iso} 起扫描 ${MAX_SCAN_DAYS} 天未找到工作日，请检查日历配置`)
}

export function snapToWorkday(iso: DateStr, cal: Calendar): DateStr {
  return isWorkday(iso, cal) ? iso : nextWorkday(iso, cal)
}

/**
 * 在 `iso` 基础上推进 `n` 个工作日。`n` 可为负。
 * 起点若落在非工作日，先吸附到下一个工作日再计数。
 */
export function addWorkdays(iso: DateStr, n: number, cal: Calendar): DateStr {
  let cursor = snapToWorkday(iso, cal)
  for (let i = 0; i < Math.abs(n); i += 1) {
    cursor = n > 0 ? nextWorkday(cursor, cal) : prevWorkday(cursor, cal)
  }
  return cursor
}

/**
 * 计算 [a, b) 区间内的工作日数量（左闭右开）。
 * 若 a > b，返回负数。
 */
export function workdaysBetween(a: DateStr, b: DateStr, cal: Calendar): number {
  if (a === b) return 0
  const sign = a < b ? 1 : -1
  const from = sign > 0 ? a : b
  const to = sign > 0 ? b : a

  let count = 0
  let cursor = from
  while (cursor < to) {
    if (isWorkday(cursor, cal)) count += 1
    cursor = addDays(cursor, 1)
  }
  return count * sign
}

/**
 * 任务的结束日期：从 `start` 起，工期为 `duration` 个工作日（含起始日）。
 * 工期为 0（里程碑）时返回 `start` 本身吸附到的工作日。
 */
export function taskFinish(start: DateStr, duration: number, cal: Calendar): DateStr {
  if (duration <= 0) return snapToWorkday(start, cal)
  return addWorkdays(start, duration - 1, cal)
}

/** 任务的开始日期：从 `finish` 倒推 `duration` 个工作日（含结束日）。 */
export function taskStart(finish: DateStr, duration: number, cal: Calendar): DateStr {
  if (duration <= 0) return snapToWorkday(finish, cal)
  return addWorkdays(finish, -(duration - 1), cal)
}
