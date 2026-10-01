import type { CalendarException, DateStr } from '../../domain/model/types'
import { addDays } from '../../domain/dateUtils'

export interface ExceptionRange {
  start: DateStr
  end: DateStr
  kind: 'holiday' | 'custom'
}

/**
 * 把逐日的 `Calendar.exceptions` 聚合成「连续同类」的区间（升序）。
 *
 * 为什么需要它：区间例外在**命令层被逐日展开**（见 `calendarCommands.ts`），
 * 展示时要还原成人能读的区间（`2026-03-16 → 2026-03-20 · 假日`）。
 * 分组规则**只有这一处**：日期连续（`addDays(前一条.end, 1) === 当天`）且 kind 相同。
 */
export function groupExceptions(exceptions: Record<DateStr, CalendarException>): ExceptionRange[] {
  const ranges: ExceptionRange[] = []
  for (const day of Object.keys(exceptions).sort()) {
    const kind = exceptions[day].kind
    const last = ranges[ranges.length - 1]
    if (last && last.kind === kind && addDays(last.end, 1) === day) last.end = day
    else ranges.push({ start: day, end: day, kind })
  }
  return ranges
}
