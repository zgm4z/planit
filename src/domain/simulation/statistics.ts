import type { HistogramBin } from '../model/types'

/**
 * 计算数值数组的统计摘要。
 *
 * @param values - 工期样本数组（工作日）
 * @returns 统计摘要：均值、中位数、标准差、最小值、最大值
 */
export function computeStatistics(values: number[]): {
  mean: number
  median: number
  stdDev: number
  min: number
  max: number
} {
  if (values.length === 0) {
    throw new Error('Cannot compute statistics for empty array')
  }

  // 排序以计算中位数和百分位数
  const sorted = [...values].sort((a, b) => a - b)

  // 均值
  const sum = values.reduce((acc, v) => acc + v, 0)
  const mean = sum / values.length

  // 中位数
  const mid = Math.floor(sorted.length / 2)
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]

  // 标准差
  const squaredDiffs = values.map((v) => Math.pow(v - mean, 2))
  const variance = squaredDiffs.reduce((acc, v) => acc + v, 0) / values.length
  const stdDev = Math.sqrt(variance)

  // 最小值和最大值
  const min = sorted[0]
  const max = sorted[sorted.length - 1]

  return { mean, median, stdDev, min, max }
}

/**
 * 计算指定百分位数。
 *
 * @param values - 工期样本数组（工作日）
 * @param percentile - 百分位数（0-100）
 * @returns 该百分位数对应的值
 */
export function computePercentile(values: number[], percentile: number): number {
  if (values.length === 0) {
    throw new Error('Cannot compute percentile for empty array')
  }
  if (percentile < 0 || percentile > 100) {
    throw new Error('Percentile must be between 0 and 100')
  }

  const sorted = [...values].sort((a, b) => a - b)
  const index = (percentile / 100) * (sorted.length - 1)
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  const weight = index - lower

  // 线性插值
  return sorted[lower] * (1 - weight) + sorted[upper] * weight
}

/**
 * 生成工期分布的直方图。
 *
 * 使用 Freedman-Diaconis 规则自动确定区间数量，
 * 或者使用指定的区间数量。
 *
 * @param values - 工期样本数组（工作日）
 * @param binCount - 可选的区间数量（默认自动计算，典型值 20-50）
 * @returns 直方图区间数组
 */
export function generateHistogram(
  values: number[],
  binCount?: number
): HistogramBin[] {
  if (values.length === 0) {
    return []
  }

  const sorted = [...values].sort((a, b) => a - b)
  const min = sorted[0]
  const max = sorted[sorted.length - 1]

  // 自动计算区间数量：Freedman-Diaconis 规则
  let numBins = binCount
  if (!numBins) {
    const q1 = computePercentile(values, 25)
    const q3 = computePercentile(values, 75)
    const iqr = q3 - q1
    const binWidth = (2 * iqr) / Math.pow(values.length, 1 / 3)
    numBins = Math.max(10, Math.min(50, Math.ceil((max - min) / binWidth)))
  }

  // 确保至少有一个区间
  numBins = Math.max(1, numBins)

  const binWidth = (max - min) / numBins
  const bins: HistogramBin[] = []

  for (let i = 0; i < numBins; i++) {
    const binMin = min + i * binWidth
    const binMax = i === numBins - 1 ? max : min + (i + 1) * binWidth

    // 计算落在该区间的样本数
    // 左闭右开区间 [binMin, binMax)，最后一个区间是 [binMin, binMax]
    const count = sorted.filter((v) => {
      if (i === numBins - 1) {
        return v >= binMin && v <= binMax
      }
      return v >= binMin && v < binMax
    }).length

    bins.push({
      min: binMin,
      max: binMax,
      count,
      percentage: (count / values.length) * 100,
    })
  }

  return bins
}
