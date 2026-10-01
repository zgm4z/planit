import type { CalendarException, CalendarId, DateStr } from '../domain/model/types'
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
}
