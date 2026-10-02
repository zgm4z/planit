import { describe, it, expect } from 'vitest'
import { createCalendar } from '../../domain/model/factories'
import { DEFAULT_START_TIME } from '../../domain/calendar/dateTime'
import { HOURS, HOURS_IN_DAY, START_HOUR, WEEKDAY_KEYS, workBlockOfDay } from './normalHours'

describe('normalHours 常量', () => {
  it('纵轴 24 行、序号 0..23', () => {
    expect(HOURS_IN_DAY).toBe(24)
    expect(HOURS).toHaveLength(24)
    expect(HOURS[0]).toBe(0)
    expect(HOURS[23]).toBe(23)
  })

  it('START_HOUR 从 DEFAULT_START_TIME 推导，不是另写的字面量', () => {
    expect(START_HOUR).toBe(Number(DEFAULT_START_TIME.slice(0, 2)))
    expect(START_HOUR).toBe(9)
  })

  it('星期键的顺序 = workingDays 的索引序（周一打头）', () => {
    expect(WEEKDAY_KEYS).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
  })
})

describe('workBlockOfDay', () => {
  it('上班日：从 START_HOUR 起算 hoursPerDay 小时', () => {
    const calendar = createCalendar() // 周一–周五上班，每日 8 小时
    expect(workBlockOfDay(calendar, 0)).toEqual({ from: 9, to: 17 })
    expect(workBlockOfDay(calendar, 4)).toEqual({ from: 9, to: 17 })
  })

  it('非上班日（周六 / 周日）没有绿块', () => {
    const calendar = createCalendar()
    expect(workBlockOfDay(calendar, 5)).toBeNull()
    expect(workBlockOfDay(calendar, 6)).toBeNull()
  })

  it('每日工时 9 小时 → 09:00–18:00（与参照 / 真实夹具一致）', () => {
    const calendar = { ...createCalendar(), hoursPerDay: 9 }
    expect(workBlockOfDay(calendar, 0)).toEqual({ from: 9, to: 18 })
  })

  it('跨过午夜的工时截到 24（纵轴只有 00–23）', () => {
    const calendar = { ...createCalendar(), hoursPerDay: 20 } // 09:00 + 20h = 29:00
    expect(workBlockOfDay(calendar, 0)).toEqual({ from: 9, to: 24 })
  })

  it('工时 ≤ 0 时不画（返回 null，而不是 0 高的空块）', () => {
    const calendar = { ...createCalendar(), hoursPerDay: 0 }
    expect(workBlockOfDay(calendar, 0)).toBeNull()
  })
})
