import { describe, it, expect } from 'vitest'
import { monthMatrix, shiftMonth } from './calendarGrid'

describe('monthMatrix', () => {
  it('2026-03：3 月 1 日是周日 → 网格前 6 格是 2 月末补白（起点 2 月 23 日周一），共 42 格', () => {
    const cells = monthMatrix('2026-03-10')
    expect(cells).toHaveLength(42)
    // 首格**对应** 2026-02-23（周一），但它属于邻月 → 补白为 null（与 doc 注释一致）。
    // 原计划的期望值写成了 '2026-02-23'，那会让 cells[0] 是邻月日期，
    // 与本文件「补白为 null」的用例、以及第三个「本月日期数 = 月天数」的用例直接冲突。
    expect(cells.slice(0, 6)).toEqual([null, null, null, null, null, null])
    expect(cells[6]).toBe('2026-03-01')
  })

  it('本月每一天都在网格里（按日序、无重复），且补白为 null', () => {
    const cells = monthMatrix('2026-03-10')
    const inMonth = cells.filter((cell): cell is string => cell !== null)
    // 恰好 31 天 —— 不能用 `长度 % 7 === 0` 之类的数学巧合当判据（31 不是 7 的倍数）
    expect(inMonth).toHaveLength(31)
    expect(inMonth[0]).toBe('2026-03-01')
    expect(inMonth[30]).toBe('2026-03-31')
    for (let day = 1; day <= 31; day += 1) {
      expect(cells).toContain(`2026-03-${String(day).padStart(2, '0')}`)
    }
    // 2026-03-31 是周二 → 之后到第 42 格全为 null
    expect(cells[cells.length - 1]).toBeNull()
  })

  it('网格里属于本月的日期数量 = 该月天数（不混入相邻月）', () => {
    const cells = monthMatrix('2026-02-15')
    expect(cells.filter((cell) => cell?.startsWith('2026-02')).length).toBe(28)
  })
})

describe('shiftMonth', () => {
  it('+1 / -1 跨年正确', () => {
    expect(shiftMonth('2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftMonth('2026-01-15', -1)).toBe('2025-12-01')
  })
})
