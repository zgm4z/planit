import { describe, it, expect } from 'vitest'
import { computeStatistics, computePercentile, generateHistogram } from './statistics'

describe('computeStatistics', () => {
  it('计算基本统计量', () => {
    const values = [10, 20, 30, 40, 50]
    const stats = computeStatistics(values)

    expect(stats.mean).toBe(30)
    expect(stats.median).toBe(30)
    expect(stats.min).toBe(10)
    expect(stats.max).toBe(50)
    expect(stats.stdDev).toBeCloseTo(14.142, 2)
  })

  it('处理单个值', () => {
    const stats = computeStatistics([42])
    expect(stats.mean).toBe(42)
    expect(stats.median).toBe(42)
    expect(stats.min).toBe(42)
    expect(stats.max).toBe(42)
    expect(stats.stdDev).toBe(0)
  })

  it('处理偶数个值时计算中位数', () => {
    const values = [10, 20, 30, 40]
    const stats = computeStatistics(values)
    expect(stats.median).toBe(25) // (20 + 30) / 2
  })

  it('空数组抛出错误', () => {
    expect(() => computeStatistics([])).toThrow('Cannot compute statistics for empty array')
  })
})

describe('computePercentile', () => {
  const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]

  it('计算 P50（中位数）', () => {
    expect(computePercentile(values, 50)).toBe(55)
  })

  it('计算 P90', () => {
    expect(computePercentile(values, 90)).toBe(91)
  })

  it('计算 P10', () => {
    expect(computePercentile(values, 10)).toBe(19)
  })

  it('计算边界值 P0', () => {
    expect(computePercentile(values, 0)).toBe(10)
  })

  it('计算边界值 P100', () => {
    expect(computePercentile(values, 100)).toBe(100)
  })

  it('百分位数超出范围时抛出错误', () => {
    expect(() => computePercentile(values, -1)).toThrow('Percentile must be between 0 and 100')
    expect(() => computePercentile(values, 101)).toThrow('Percentile must be between 0 and 100')
  })

  it('空数组抛出错误', () => {
    expect(() => computePercentile([], 50)).toThrow('Cannot compute percentile for empty array')
  })
})

describe('generateHistogram', () => {
  it('生成固定区间数的直方图', () => {
    const values = [10, 15, 20, 25, 30, 35, 40, 45, 50]
    const histogram = generateHistogram(values, 4)

    expect(histogram).toHaveLength(4)
    expect(histogram[0].min).toBe(10)
    expect(histogram[3].max).toBe(50)

    // 验证百分比总和为 100
    const totalPercentage = histogram.reduce((sum, bin) => sum + bin.percentage, 0)
    expect(totalPercentage).toBeCloseTo(100, 1)
  })

  it('自动计算区间数', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1)
    const histogram = generateHistogram(values)

    expect(histogram.length).toBeGreaterThan(0)
    expect(histogram.length).toBeLessThanOrEqual(50)
  })

  it('处理单个值', () => {
    const histogram = generateHistogram([42], 1)
    expect(histogram).toHaveLength(1)
    expect(histogram[0].min).toBe(42)
    expect(histogram[0].max).toBe(42)
    expect(histogram[0].count).toBe(1)
    expect(histogram[0].percentage).toBe(100)
  })

  it('空数组返回空直方图', () => {
    const histogram = generateHistogram([])
    expect(histogram).toHaveLength(0)
  })

  it('验证区间覆盖所有值', () => {
    const values = [5, 10, 15, 20, 25, 30]
    const histogram = generateHistogram(values, 3)

    const totalCount = histogram.reduce((sum, bin) => sum + bin.count, 0)
    expect(totalCount).toBe(values.length)
  })
})
