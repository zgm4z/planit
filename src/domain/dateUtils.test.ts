import { describe, it, expect } from 'vitest'
import { parseDate, formatDate, addDays, epochDay, dayToIso, weekdayMon0 } from './dateUtils'

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

/**
 * 天整数核心（`epochDay` / `dayToIso` / `weekdayMon0`）的回归。
 *
 * 这些函数是排期热点的内部表示（见 dateUtils 顶部说明），必须是**纯民用历算术** ——
 * 与 `Date`、时区、DST 全无关，才能让整日排期在任意 TZ 下逐字节一致。
 * 断言都是确定性的（无墙钟）：一旦有人把实现退回按字符串/`Date` 解析而引入
 * 偏移或 DST 跳变，这里会直接变红。
 */
describe('天整数核心', () => {
  it('epochDay 以 1970-01-01 为第 0 天', () => {
    expect(epochDay('1970-01-01')).toBe(0)
    expect(epochDay('1970-01-05')).toBe(4)
    expect(epochDay('1969-12-31')).toBe(-1)
  })

  it('dayToIso(epochDay(iso)) 对闰日 / 跨年 / DST 边界都还原原串', () => {
    for (const iso of [
      '2024-02-29', // 闰日
      '2026-03-08', // 美东 DST 春令（跳 2:00→3:00）
      '2026-11-01', // 美东 DST 秋令（跳 2:00→1:00）
      '2025-12-31',
      '2026-01-01',
      '2038-01-19',
    ]) {
      expect(dayToIso(epochDay(iso))).toBe(iso)
    }
  })

  it('weekdayMon0 周一=0 … 周日=6（与 Calendar.workingDays 同序）', () => {
    expect(weekdayMon0(epochDay('2026-03-02'))).toBe(0) // 周一
    expect(weekdayMon0(epochDay('2026-03-08'))).toBe(6) // 周日
    expect(epochDay('2026-03-08') - epochDay('2026-03-02')).toBe(6)
  })

  it('跨 DST 的 addDays 正好推进一天，不跳、不重（整日算术对 DST 免疫）', () => {
    // 春令 / 秋令前后各跨一天：以「天整数差 = 1」作判据，与机器本地时区无关
    expect(epochDay(addDays('2026-03-08', 1)) - epochDay('2026-03-08')).toBe(1)
    expect(epochDay(addDays('2026-11-01', 1)) - epochDay('2026-11-01')).toBe(1)
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09')
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02')
  })
})
