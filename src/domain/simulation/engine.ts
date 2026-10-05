import type { Project } from '../model/types'
import type {
  SimulationConfig,
  SimulationResult,
  TaskUncertainty,
  DistributionStats,
} from './simulationTypes'
import { sampleProjectDurations, createSeededRng, hashSeed } from './sampling'
import { computeStatistics, computePercentile, generateHistogram } from './statistics'
import { solve } from '../scheduler'

/**
 * 运行蒙特卡洛模拟。
 *
 * 对于每次迭代：
 * 1. 根据任务不确定性参数采样随机工期
 * 2. 使用采样工期重新调度项目
 * 3. 记录项目完成时间和各任务的完成时间
 *
 * 最后汇总所有迭代的结果，计算统计指标。
 *
 * @param project - 项目数据
 * @param uncertainties - 任务不确定性参数
 * @param config - 模拟配置
 * @param onProgress - 进度回调（可选），接收当前迭代数和总迭代数
 * @returns 模拟结果
 */
export function runSimulation(
  project: Project,
  uncertainties: TaskUncertainty[],
  config: SimulationConfig,
  onProgress?: (current: number, total: number) => void
): SimulationResult {
  const { iterations, seed } = config

  // 创建随机数生成器
  const rng = createSeededRng(typeof seed === 'string' ? hashSeed(seed) : seed ?? Date.now())

  // 存储每次迭代的结果
  const projectDurations: number[] = []
  const taskDurationSamples: Record<string, number[]> = {}

  // 初始化任务采样数组
  for (const taskId of Object.keys(project.tasks)) {
    taskDurationSamples[taskId] = []
  }

  // 执行迭代
  for (let i = 0; i < iterations; i++) {
    // 1. 采样随机工期
    const sampledDurations = sampleProjectDurations(project, uncertainties, rng)

    // 2. 创建临时项目副本，使用采样工期
    const tempProject: Project = {
      ...project,
      tasks: Object.fromEntries(
        Object.entries(project.tasks).map(([id, task]) => [
          id,
          {
            ...task,
            duration: sampledDurations[id],
          },
        ])
      ),
    }

    // 3. 重新调度项目
    const scheduleResult = solve(tempProject)
    const { schedules } = scheduleResult

    // 4. 记录项目完成时间（取所有任务的最晚结束时间）
    let projectEndTime = 0
    for (const schedule of Object.values(schedules)) {
      if (schedule.scheduledFinish) {
        const endTime = new Date(schedule.scheduledFinish).getTime()
        if (endTime > projectEndTime) {
          projectEndTime = endTime
        }
      }
    }

    // 转换为工作日数（以项目开始时间为基准）
    const projectStartTime = new Date(project.startDate).getTime()
    const durationInMs = projectEndTime - projectStartTime
    const calendar = project.calendars[project.calendarId]
    const hoursPerDay = calendar.hoursPerDay
    const msPerDay = hoursPerDay * 60 * 60 * 1000
    const durationInDays = durationInMs / msPerDay

    projectDurations.push(durationInDays)

    // 5. 记录各任务的采样工期（而不是调度后的时间跨度）
    for (const taskId of Object.keys(project.tasks)) {
      taskDurationSamples[taskId].push(sampledDurations[taskId])
    }

    // 进度回调
    if (onProgress) {
      onProgress(i + 1, iterations)
    }
  }

  // 计算项目工期的统计指标
  const projectBasicStats = computeStatistics(projectDurations)
  const projectStats: DistributionStats = {
    mean: projectBasicStats.mean,
    median: projectBasicStats.median,
    std: projectBasicStats.stdDev,
    min: projectBasicStats.min,
    max: projectBasicStats.max,
    p10: computePercentile(projectDurations, 10),
    p50: computePercentile(projectDurations, 50),
    p90: computePercentile(projectDurations, 90),
  }

  // 计算各任务工期的统计指标
  const taskStats: Record<string, DistributionStats> = {}
  for (const [taskId, samples] of Object.entries(taskDurationSamples)) {
    if (samples.length > 0) {
      const basicStats = computeStatistics(samples)
      taskStats[taskId] = {
        mean: basicStats.mean,
        median: basicStats.median,
        std: basicStats.stdDev,
        min: basicStats.min,
        max: basicStats.max,
        p10: computePercentile(samples, 10),
        p50: computePercentile(samples, 50),
        p90: computePercentile(samples, 90),
      }
    }
  }

  // 计算项目工期的直方图
  const histogramBins = generateHistogram(projectDurations)
  const histogram = {
    bins: histogramBins.flatMap((bin, i) =>
      i === 0 ? [bin.min, bin.max] : [bin.max]
    ),
    frequencies: histogramBins.map((bin) => bin.count),
  }

  return {
    iterations,
    projectStats,
    taskStats,
    histogram,
    executedAt: new Date().toISOString(),
  }
}
