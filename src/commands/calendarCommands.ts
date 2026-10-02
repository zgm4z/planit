import type { CalendarException, CalendarId, DateStr } from '../domain/model/types'
import { addDays } from '../domain/dateUtils'
import { DEFAULT_FINISH_TIME, DEFAULT_START_TIME, ensureDateTime } from '../domain/calendar/dateTime'
import type { CommandHandler } from './types'

export interface SetWorkingDaysPayload {
  calendarId: CalendarId
  workingDays: [boolean, boolean, boolean, boolean, boolean, boolean, boolean]
}
export interface AddExceptionPayload {
  calendarId: CalendarId
  date: DateStr
  exception: CalendarException
}
export interface RemoveExceptionPayload { calendarId: CalendarId; date: DateStr }
export interface CalendarSetHoursPerDayPayload { hoursPerDay: number }

/** 区间例外的类型 —— 与 CalendarException 的 kind 对齐（holiday = 非工作日，custom = 工作日） */
export type ExceptionRangeKind = 'holiday' | 'custom'

export interface AddExceptionRangePayload {
  calendarId: CalendarId
  start: DateStr
  end: DateStr
  kind: ExceptionRangeKind
}
export interface RemoveExceptionRangePayload { calendarId: CalendarId; start: DateStr; end: DateStr }

/** 单次展开的天数上限 —— 与 workdays.ts 的 MAX_SCAN_DAYS 同量级，防畸形 payload 造成死循环 */
const MAX_RANGE_DAYS = 3660

export const calendarHandlers: Record<string, CommandHandler<any>> = {
  'calendar.setWorkingDays': (draft, payload: SetWorkingDaysPayload) => {
    const calendar = draft.calendars[payload.calendarId]
    if (!calendar) return
    // 复制成新数组，避免把外部数组的引用直接塞进 draft
    calendar.workingDays = [...payload.workingDays] as typeof calendar.workingDays
  },

  'calendar.addException': (draft, payload: AddExceptionPayload) => {
    const calendar = draft.calendars[payload.calendarId]
    if (!calendar) return
    calendar.exceptions[payload.date] = payload.exception
  },

  'calendar.removeException': (draft, payload: RemoveExceptionPayload) => {
    const calendar = draft.calendars[payload.calendarId]
    if (!calendar) return
    delete calendar.exceptions[payload.date]
  },

  // v0.5：项目面板的「投入单位转换」可编辑（spec §4.3）。
  // 输入框驱动 → 合并键 `calendar.setHoursPerDay`（单日历，无 id）。
  'calendar.setHoursPerDay': (draft, payload: CalendarSetHoursPerDayPayload) => {
    const calendar = draft.calendars[draft.calendarId]
    if (calendar) calendar.hoursPerDay = Math.max(1, Math.round(payload.hoursPerDay))
  },

  /**
   * v0.7：按**日期区间**添加例外 —— 逐日展开成单日条目。
   *
   * 为什么逐日展开而不是写一条 `{kind:'custom', start, end}`：引擎的 `isWorkday`
   * （`domain/calendar/workdays.ts:16-20`）**只按单日精确查表**，`custom.start/end`
   * 是全项目没人读的死数据；而 `holiday` 变体根本没有区间字段。逐日展开是唯一一份
   * 规则，两种 kind 一致，且**不改引擎、不改 schema**（spec §4.2 / 计划偏差 2）。
   *
   * 一条命令 = 一条撤销记录（绝不在这里循环 dispatch）。
   * 反向区间（end < start）是 no-op；区间长度夹到 MAX_RANGE_DAYS。
   */
  'calendar.addExceptionRange': (draft, payload: AddExceptionRangePayload) => {
    const calendar = draft.calendars[payload.calendarId]
    if (!calendar) return
    if (payload.end < payload.start) return

    let cursor = payload.start
    for (let i = 0; i < MAX_RANGE_DAYS && cursor <= payload.end; i += 1) {
      calendar.exceptions[cursor] = payload.kind === 'holiday'
        ? { kind: 'holiday' }
        : {
            // v0.8：`custom.start/end` 已是 `DateTimeStr`。这里按**单日**写入带时刻的
            // 形状（09:00–18:00），否则会落盘成「纯日期 + DateTimeStr 字段」的混合形状
            // 与类型不符。注意 `isWorkday` 仍**只查键（日）**，start/end 至今是死数据
            // （时段粒度排期不做，spec §9）—— 本改动只为让落盘形状与类型一致。
            kind: 'custom',
            start: ensureDateTime(cursor, DEFAULT_START_TIME),
            end: ensureDateTime(cursor, DEFAULT_FINISH_TIME),
          }
      cursor = addDays(cursor, 1)
    }
  },

  // 删除区间内的每一天；区间外的键原样保留。
  'calendar.removeExceptionRange': (draft, payload: RemoveExceptionRangePayload) => {
    const calendar = draft.calendars[payload.calendarId]
    if (!calendar) return
    if (payload.end < payload.start) return

    let cursor = payload.start
    for (let i = 0; i < MAX_RANGE_DAYS && cursor <= payload.end; i += 1) {
      delete calendar.exceptions[cursor]
      cursor = addDays(cursor, 1)
    }
  },
}
