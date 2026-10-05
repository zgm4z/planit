/**
 * 蒙特卡洛模拟的类型定义
 */

/**
 * 任务不确定性参数
 */
export interface TaskUncertainty {
  taskId: string
  optimistic: number // 乐观工期（天）
  mostLikely: number // 最可能工期（天）
  pessimistic: number // 悲观工期（天）
}

/**
 * 模拟配置
 */
export interface SimulationConfig {
  iterations: number // 迭代次数
  seed?: number | string // 随机种子
  confidenceLevel?: number // 置信水平（默认 0.95）
}

/**
 * 分布统计指标
 */
export interface DistributionStats {
  mean: number // 均值
  median: number // 中位数
  std: number // 标准差
  min: number // 最小值
  max: number // 最大值
  p10: number // 第 10 百分位
  p50: number // 第 50 百分位（中位数）
  p90: number // 第 90 百分位
}

/**
 * 直方图数据
 */
export interface HistogramData {
  bins: number[] // 区间边界
  frequencies: number[] // 各区间频数
}

/**
 * 模拟结果
 */
export interface SimulationResult {
  projectStats: DistributionStats // 项目整体工期统计
  taskStats: Record<string, DistributionStats> // 各任务工期统计
  histogram: HistogramData // 项目工期分布直方图
  iterations: number // 实际运行的迭代次数
  executedAt: string // 执行时间戳（ISO 8601 格式）
}
