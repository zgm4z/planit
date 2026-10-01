import { describe, it, expect } from 'vitest'
import { createCalendar } from '../model/factories'
import {
  addDays,
  workdayIndex,
  isWorkday,
  nextWorkday,
  prevWorkday,
  snapToWorkday,
  addWorkdays,
  workdaysBetween,
} from './workdays'

// 2026-03-06 是周五，03-07 周六，03-08 周日，03-09 周一
const cal = createCalendar()

const withHoliday = (date: string) => {
  const c = createCalendar()
  c.exceptions[date] = { kind: 'holiday' }
  return c
}

describe('addDays', () => {
  it('跨月推进', () => {
    expect(addDays('2026-03-30', 3)).toBe('2026-04-02')
  })
  it('跨年倒退', () => {
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
  })
})

describe('workdayIndex', () => {
  it('周一为 0，周日为 6', () => {
    expect(workdayIndex('2026-03-09')).toBe(0) // 周一
    expect(workdayIndex('2026-03-15')).toBe(6) // 周日
  })
})

describe('isWorkday', () => {
  it('周五是工作日，周六不是', () => {
    expect(isWorkday('2026-03-06', cal)).toBe(true)
    expect(isWorkday('2026-03-07', cal)).toBe(false)
  })

  it('例外日覆盖周规则', () => {
    expect(isWorkday('2026-03-09', withHoliday('2026-03-09'))).toBe(false)
  })
})

describe('nextWorkday / prevWorkday', () => {
  it('从周五推到下周一', () => {
    expect(nextWorkday('2026-03-06', cal)).toBe('2026-03-09')
  })
  it('从周一退回上周五', () => {
    expect(prevWorkday('2026-03-09', cal)).toBe('2026-03-06')
  })
  it('跳过节假日', () => {
    expect(nextWorkday('2026-03-06', withHoliday('2026-03-09'))).toBe('2026-03-10')
  })
})

describe('snapToWorkday', () => {
  it('落在工作日的日期原样返回', () => {
    expect(snapToWorkday('2026-03-06', cal)).toBe('2026-03-06')
  })
  it('落在周六则吸附到下一个工作日', () => {
    expect(snapToWorkday('2026-03-07', cal)).toBe('2026-03-09')
  })
})

describe('addWorkdays', () => {
  it('加 1 个工作日从周五落到下周一', () => {
    expect(addWorkdays('2026-03-06', 1, cal)).toBe('2026-03-09')
  })
  it('加 0 个工作日返回吸附后的自身', () => {
    expect(addWorkdays('2026-03-07', 0, cal)).toBe('2026-03-09')
  })
  it('减 1 个工作日从周一退到上周五', () => {
    expect(addWorkdays('2026-03-09', -1, cal)).toBe('2026-03-06')
  })
  it('起点在非工作日时先吸附再计数', () => {
    // 03-07 周六吸附为 03-09 周一，再加 1 个工作日 = 03-10
    expect(addWorkdays('2026-03-07', 1, cal)).toBe('2026-03-10')
  })
  it('跨越节假日', () => {
    // 03-06 周五 + 2 个工作日，03-09 是假期 → 03-10、03-11
    expect(addWorkdays('2026-03-06', 2, withHoliday('2026-03-09'))).toBe('2026-03-11')
  })
})

describe('workdaysBetween', () => {
  it('同一天为 0', () => {
    expect(workdaysBetween('2026-03-06', '2026-03-06', cal)).toBe(0)
  })
  it('左闭右开：周五到周一为 1 个工作日（只数周五）', () => {
    expect(workdaysBetween('2026-03-06', '2026-03-09', cal)).toBe(1)
  })
  it('整周为 5 个工作日', () => {
    expect(workdaysBetween('2026-03-09', '2026-03-16', cal)).toBe(5)
  })
  it('反向区间返回负数', () => {
    expect(workdaysBetween('2026-03-09', '2026-03-06', cal)).toBe(-1)
  })
})
