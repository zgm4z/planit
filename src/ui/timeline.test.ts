import { describe, it, expect } from 'vitest'
import { createScale, barRect, MIN_BAR_WIDTH_RATIO } from './timeline'

describe('createScale', () => {
  it('xOf 把日期映射为距起始日的像素偏移', () => {
    const scale = createScale('2026-03-02', 30)
    expect(scale.xOf('2026-03-02')).toBe(0)
    expect(scale.xOf('2026-03-04')).toBe(60)
  })

  it('widthOf 含首尾两天', () => {
    const scale = createScale('2026-03-02', 30)
    expect(scale.widthOf('2026-03-02', '2026-03-04')).toBe(90)
  })

  it('单日任务宽度等于一天', () => {
    const scale = createScale('2026-03-02', 30)
    expect(scale.widthOf('2026-03-02', '2026-03-02')).toBe(30)
  })

  it('起始日之前的日期返回负偏移', () => {
    const scale = createScale('2026-03-02', 30)
    expect(scale.xOf('2026-03-01')).toBe(-30)
  })

  it('跨周末时按自然日计算偏移（周末照样占位置）', () => {
    const scale = createScale('2026-03-06', 30) // 周五
    expect(scale.xOf('2026-03-09')).toBe(90) // 到周一隔了 3 个自然日
  })

  it('dateAt 是 xOf 的逆运算', () => {
    const scale = createScale('2026-03-02', 30)
    expect(scale.dateAt(scale.xOf('2026-03-11'))).toBe('2026-03-11')
  })
})

describe('barRect', () => {
  const scale = createScale('2026-03-02', 30)

  it('x 等于开始日的像素偏移', () => {
    expect(barRect(scale, '2026-03-04', '2026-03-05').x).toBe(60)
  })

  it('宽度等于 widthOf（含首尾自然日）', () => {
    expect(barRect(scale, '2026-03-02', '2026-03-04').width).toBe(90)
  })

  it('跨周末的条横跨周末（自然日），而不是按工作日收缩', () => {
    // 周五 → 周一：2 个工作日，但占 4 个自然日
    const friday = createScale('2026-03-06', 30)
    expect(barRect(friday, '2026-03-06', '2026-03-09').width).toBe(120)
  })

  it('零工期也保底一天宽度的一部分，不会退化成 0', () => {
    const month = createScale('2026-03-02', 4)
    expect(barRect(month, '2026-03-02', '2026-03-02').width).toBe(4)
    expect(MIN_BAR_WIDTH_RATIO).toBe(0.6)
  })
})
