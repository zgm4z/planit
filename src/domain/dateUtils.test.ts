import { describe, it, expect } from 'vitest'
import { parseDate, formatDate, addDays } from './dateUtils'

describe('parseDate', () => {
  it('把 YYYY-MM-DD 解析为本地时间的对应日期', () => {
    const d = parseDate('2026-03-02')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(2) // 0=一月
    expect(d.getDate()).toBe(2)
  })

  it('按本地时区解释，不引入 UTC 偏移，因此不会差一天', () => {
    const parsed = parseDate('2026-03-02')
    // 与显式按本地时间构造的日期完全一致
    expect(parsed.getTime()).toBe(new Date(2026, 2, 2).getTime())
    // 且在任意时区下日期分量都是 2 号；朴素的 new Date(iso) 按 UTC 解析，
    // 在负偏移时区会退到 1 号 —— 这正是不能用它的原因
    expect(parsed.getDate()).toBe(2)
    expect(parsed.getHours()).toBe(0)
  })
})

describe('formatDate', () => {
  it('月/日补零', () => {
    expect(formatDate(new Date(2026, 2, 2))).toBe('2026-03-02')
  })

  it('两位数的月/日不受影响', () => {
    expect(formatDate(new Date(2026, 11, 31))).toBe('2026-12-31')
  })
})

describe('addDays', () => {
  it('跨月前进', () => {
    expect(addDays('2026-03-30', 3)).toBe('2026-04-02')
  })

  it('跨年倒退', () => {
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('负数跨月', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
})
