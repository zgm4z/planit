import { describe, it, expect } from 'vitest'

import {
  formatCost,
  formatDate,
  formatDays,
  formatEffort,
  formatHours,
  formatPercent,
} from './format'

/**
 * 这些用例钉的是**规范 §1.3 的字面要求**，不是实现的形状 ——
 * 每条都问过「实现写错它会不会红」：
 *   写错 → 四位小数漏出 / 取整值多出 `.0` / 千分位丢失 / 算不出来被当成 0。
 */
describe('formatEffort（工作量：1 位，取整值不加 .0）', () => {
  it('四位小数被收敛到一位 —— 规范点名禁止的 0.8889', () => {
    expect(formatEffort(0.8889)).toBe('0.9')
  })

  it('取整值不加 .0', () => {
    expect(formatEffort(1)).toBe('1')
    expect(formatEffort(5)).toBe('5')
    expect(formatEffort(3)).toBe('3')
  })

  it('保留一位是真的保留（1.15 不被截成 1.1）', () => {
    // 浮点陷阱：1.15 * 10 = 11.499999999999998，朴素 Math.round 会得到 1.1
    expect(formatEffort(1.15)).toBe('1.2')
  })

  it('真的是 0 → "0"（不是空、不是 —）', () => {
    expect(formatEffort(0)).toBe('0')
  })

  it('算不出来（NaN / Infinity）→ null', () => {
    expect(formatEffort(Number.NaN)).toBeNull()
    expect(formatEffort(Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('formatCost（成本：0 位 + 千分位）', () => {
  it('千分位', () => {
    expect(formatCost(1234)).toBe('1,234')
    expect(formatCost(1000000)).toBe('1,000,000')
  })

  it('小数被四舍五入到整数，不带小数点', () => {
    expect(formatCost(1234.5)).toBe('1,235')
    expect(formatCost(999.4)).toBe('999')
    // 四位数不会因为进位漏掉分组
    expect(formatCost(999.6)).toBe('1,000')
  })

  it('0 → "0"；负数保留符号与分组', () => {
    expect(formatCost(0)).toBe('0')
    expect(formatCost(-1500)).toBe('-1,500')
  })
})

describe('formatDays / formatPercent（0 位）', () => {
  it('0 位，且真的会进位', () => {
    expect(formatDays(2)).toBe('2')
    expect(formatDays(2.6)).toBe('3')
    expect(formatPercent(40)).toBe('40')
    expect(formatPercent(39.5)).toBe('40')
    expect(formatPercent(0)).toBe('0')
  })

  it('算不出来 → null', () => {
    expect(formatDays(Number.NaN)).toBeNull()
    expect(formatPercent(Number.NaN)).toBeNull()
  })
})

describe('formatHours（小时：1 位，取整不加 .0）', () => {
  it('整数不带小数、小数保留一位', () => {
    expect(formatHours(16)).toBe('16')
    expect(formatHours(16.5)).toBe('16.5')
  })
})

describe('formatDate（一律 YYYY-MM-DD）', () => {
  it('DateStr 原样通过', () => {
    expect(formatDate('2026-09-14')).toBe('2026-09-14')
  })

  it('带时间的 ISO 串只取日期段（不再出现 2026/09/14 这类本地化形态）', () => {
    expect(formatDate('2026-09-14T00:00:00.000Z')).toBe('2026-09-14')
  })

  it('空值 / 非法形状 → null（算不出来，交给调用方显示 —）', () => {
    expect(formatDate('')).toBeNull()
    expect(formatDate(null)).toBeNull()
    expect(formatDate(undefined)).toBeNull()
    expect(formatDate('2026/09/14')).toBeNull()
    expect(formatDate('下周三')).toBeNull()
  })
})
