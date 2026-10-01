import { describe, it, expect } from 'vitest'
import {
  createScale,
  barRect,
  milestoneRect,
  MIN_BAR_WIDTH_RATIO,
  MILESTONE_SIZE,
} from './timeline'
import { ROW_HEIGHT } from './useSharedVirtualizer'

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

describe('milestoneRect', () => {
  const scale = createScale('2026-03-02', 30)

  it('外接盒是边长的 √2 倍（45° 旋转）', () => {
    const rect = milestoneRect(scale, '2026-03-04')
    expect(rect.width).toBeCloseTo(MILESTONE_SIZE * Math.SQRT2, 6)
    expect(rect.height).toBeCloseTo(MILESTONE_SIZE * Math.SQRT2, 6)
    expect(rect.width).toBeCloseTo(16.9706, 3)
  })

  it('左上角相对 xOf 向左偏移 MILESTONE_SIZE/2 - MILESTONE_SIZE·√2/2（≈ -2.485）', () => {
    // 2026-03-04 的 xOf = 60 → 57.5147
    expect(milestoneRect(scale, '2026-03-04').x).toBeCloseTo(57.5147, 3)
  })

  it('菱形中心 = xOf + 半个边长 —— 依赖端点靠这条不变量对齐', () => {
    const rect = milestoneRect(scale, '2026-03-04')
    expect(rect.x + rect.width / 2).toBeCloseTo(scale.xOf('2026-03-04') + MILESTONE_SIZE / 2, 6)
  })

  it('垂直方向在行内居中', () => {
    const rect = milestoneRect(scale, '2026-03-04')
    expect(rect.y).toBeCloseTo((ROW_HEIGHT - MILESTONE_SIZE * Math.SQRT2) / 2, 6)
  })
})
