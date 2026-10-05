import { describe, it, expect } from 'vitest'
import { runSimulation } from './engine'
import type { TaskUncertainty } from './simulationTypes'
import { createProject, createTask, createDependency } from '../model/factories'

describe('runSimulation', () => {
  it('执行指定次数的迭代', () => {
    const project = createProject('测试项目', '2024-01-01')
    const task1 = createTask({ name: '任务1', duration: 10 })
    const task2 = createTask({ name: '任务2', duration: 15 })

    project.tasks[task1.id] = task1
    project.tasks[task2.id] = task2
    project.rootIds = [task1.id, task2.id]
    project.dependencies[`${task1.id}-${task2.id}`] = createDependency(task1.id, task2.id)

    const uncertainties: TaskUncertainty[] = [
      { taskId: task1.id, optimistic: 5, mostLikely: 10, pessimistic: 20 },
      { taskId: task2.id, optimistic: 10, mostLikely: 15, pessimistic: 30 },
    ]

    const result = runSimulation(project, uncertainties, {
      iterations: 100,
      seed: 'test',
      confidenceLevel: 0.95,
    })

    expect(result.iterations).toBe(100)
  })

  it('返回项目工期的统计指标', () => {
    const project = createProject('测试项目', '2024-01-01')
    const task1 = createTask({ name: '任务1', duration: 10 })
    const task2 = createTask({ name: '任务2', duration: 15 })

    project.tasks[task1.id] = task1
    project.tasks[task2.id] = task2
    project.rootIds = [task1.id, task2.id]
    project.dependencies[`${task1.id}-${task2.id}`] = createDependency(task1.id, task2.id)

    const uncertainties: TaskUncertainty[] = [
      { taskId: task1.id, optimistic: 5, mostLikely: 10, pessimistic: 20 },
      { taskId: task2.id, optimistic: 10, mostLikely: 15, pessimistic: 30 },
    ]

    const result = runSimulation(project, uncertainties, {
      iterations: 1000,
      seed: 'test',
    })

    const { projectStats } = result

    // 验证统计指标的存在和有效性
    expect(projectStats.mean).toBeGreaterThan(0)
    expect(projectStats.median).toBeGreaterThan(0)
    expect(projectStats.std).toBeGreaterThan(0)
    expect(projectStats.min).toBeLessThanOrEqual(projectStats.median)
    expect(projectStats.max).toBeGreaterThanOrEqual(projectStats.median)

    // 验证百分位数的单调性
    expect(projectStats.p10).toBeLessThanOrEqual(projectStats.p50)
    expect(projectStats.p50).toBeLessThanOrEqual(projectStats.p90)
    expect(projectStats.p50).toBeCloseTo(projectStats.median, 0.1)
  })

  it('返回各任务工期的统计指标', () => {
    const project = createProject('测试项目', '2024-01-01')
    const task1 = createTask({ name: '任务1', duration: 10 })
    const task2 = createTask({ name: '任务2', duration: 15 })

    project.tasks[task1.id] = task1
    project.tasks[task2.id] = task2
    project.rootIds = [task1.id, task2.id]
    project.dependencies[`${task1.id}-${task2.id}`] = createDependency(task1.id, task2.id)

    const uncertainties: TaskUncertainty[] = [
      { taskId: task1.id, optimistic: 5, mostLikely: 10, pessimistic: 20 },
      { taskId: task2.id, optimistic: 10, mostLikely: 15, pessimistic: 30 },
    ]

    const result = runSimulation(project, uncertainties, {
      iterations: 1000,
      seed: 'test',
    })

    const { taskStats } = result

    // 验证每个任务都有统计数据
    expect(taskStats[task1.id]).toBeDefined()
    expect(taskStats[task2.id]).toBeDefined()

    // 验证任务1的统计指标
    const task1Stats = taskStats[task1.id]
    expect(task1Stats.mean).toBeGreaterThan(0)
    expect(task1Stats.median).toBeGreaterThan(0)
    expect(task1Stats.std).toBeGreaterThan(0)

    // 验证任务2的统计指标
    const task2Stats = taskStats[task2.id]
    expect(task2Stats.mean).toBeGreaterThan(0)
    expect(task2Stats.median).toBeGreaterThan(0)
    expect(task2Stats.std).toBeGreaterThan(0)
  })

  it('返回项目工期的直方图', () => {
    const project = createProject('测试项目', '2024-01-01')
    const task1 = createTask({ name: '任务1', duration: 10 })
    const task2 = createTask({ name: '任务2', duration: 15 })

    project.tasks[task1.id] = task1
    project.tasks[task2.id] = task2
    project.rootIds = [task1.id, task2.id]
    project.dependencies[`${task1.id}-${task2.id}`] = createDependency(task1.id, task2.id)

    const uncertainties: TaskUncertainty[] = [
      { taskId: task1.id, optimistic: 5, mostLikely: 10, pessimistic: 20 },
      { taskId: task2.id, optimistic: 10, mostLikely: 15, pessimistic: 30 },
    ]

    const result = runSimulation(project, uncertainties, {
      iterations: 1000,
      seed: 'test',
      confidenceLevel: 0.95,
    })

    const { histogram } = result

    // 验证直方图结构
    expect(histogram.bins.length).toBeGreaterThan(0)
    expect(histogram.frequencies.length).toBe(histogram.bins.length - 1)

    // 验证所有计数的总和等于迭代次数
    const totalCount = histogram.frequencies.reduce((sum: number, count: number) => sum + count, 0)
    expect(totalCount).toBe(1000)

    // 验证 bins 是单调递增的
    for (let i = 1; i < histogram.bins.length; i++) {
      expect(histogram.bins[i]).toBeGreaterThan(histogram.bins[i - 1])
    }
  })

  it('相同种子产生相同结果', () => {
    const project = createProject('测试项目', '2024-01-01')
    const task1 = createTask({ name: '任务1', duration: 10 })
    const task2 = createTask({ name: '任务2', duration: 15 })

    project.tasks[task1.id] = task1
    project.tasks[task2.id] = task2
    project.rootIds = [task1.id, task2.id]
    project.dependencies[`${task1.id}-${task2.id}`] = createDependency(task1.id, task2.id)

    const uncertainties: TaskUncertainty[] = [
      { taskId: task1.id, optimistic: 5, mostLikely: 10, pessimistic: 20 },
      { taskId: task2.id, optimistic: 10, mostLikely: 15, pessimistic: 30 },
    ]

    const result1 = runSimulation(project, uncertainties, {
      iterations: 100,
      seed: 'fixed-seed',
      confidenceLevel: 0.95,
    })

    const result2 = runSimulation(project, uncertainties, {
      iterations: 100,
      seed: 'fixed-seed',
    })

    // 相同种子应该产生相同的统计结果
    expect(result1.projectStats.mean).toBeCloseTo(result2.projectStats.mean, 5)
    expect(result1.projectStats.median).toBeCloseTo(result2.projectStats.median, 5)
    expect(result1.projectStats.std).toBeCloseTo(result2.projectStats.std, 5)
  })

  it('不同种子产生不同结果', () => {
    const project = createProject('测试项目', '2024-01-01')
    const task1 = createTask({ name: '任务1', duration: 10 })
    const task2 = createTask({ name: '任务2', duration: 15 })

    project.tasks[task1.id] = task1
    project.tasks[task2.id] = task2
    project.rootIds = [task1.id, task2.id]
    project.dependencies[`${task1.id}-${task2.id}`] = createDependency(task1.id, task2.id)

    const uncertainties: TaskUncertainty[] = [
      { taskId: task1.id, optimistic: 5, mostLikely: 10, pessimistic: 20 },
      { taskId: task2.id, optimistic: 10, mostLikely: 15, pessimistic: 30 },
    ]

    const result1 = runSimulation(project, uncertainties, {
      iterations: 100,
      seed: 'seed1',
      confidenceLevel: 0.95,
    })

    const result2 = runSimulation(project, uncertainties, {
      iterations: 100,
      seed: 'seed2',
      confidenceLevel: 0.95,
    })

    // 不同种子通常会产生不同的结果（虽然理论上可能相同，但概率极小）
    const meanDiff = Math.abs(result1.projectStats.mean - result2.projectStats.mean)
    expect(meanDiff).toBeGreaterThan(0)
  })

  it('支持进度回调', () => {
    const project = createProject('测试项目', '2024-01-01')
    const task1 = createTask({ name: '任务1', duration: 10 })

    project.tasks[task1.id] = task1
    project.rootIds = [task1.id]

    const uncertainties: TaskUncertainty[] = [
      { taskId: task1.id, optimistic: 5, mostLikely: 10, pessimistic: 20 },
    ]

    const progressCalls: Array<{ current: number; total: number }> = []

    runSimulation(
      project,
      uncertainties,
      {
        iterations: 10,
        seed: 'test',
        confidenceLevel: 0.95,
      },
      (current, total) => {
        progressCalls.push({ current, total })
      }
    )

    // 验证进度回调被调用
    expect(progressCalls.length).toBe(10)

    // 验证进度递增
    for (let i = 0; i < progressCalls.length; i++) {
      expect(progressCalls[i].current).toBe(i + 1)
      expect(progressCalls[i].total).toBe(10)
    }
  })

  it('处理没有不确定性参数的任务（使用原始工期）', () => {
    const project = createProject('测试项目', '2024-01-01')
    const task1 = createTask({ name: '任务1', duration: 10 })
    const task2 = createTask({ name: '任务2', duration: 15 })

    project.tasks[task1.id] = task1
    project.tasks[task2.id] = task2
    project.rootIds = [task1.id, task2.id]
    // task2 独立，不依赖 task1
    // （依赖会让 task2 的开始时间受 task1 的不确定性影响）

    // 只为 task1 提供不确定性参数
    const uncertainties: TaskUncertainty[] = [
      { taskId: task1.id, optimistic: 5, mostLikely: 10, pessimistic: 20 },
    ]

    const result = runSimulation(project, uncertainties, {
      iterations: 100,
      seed: 'test',
    })

    // task2 没有不确定性参数，使用固定工期 15
    expect(result.taskStats[task2.id]).toBeDefined()
    const task2Stats = result.taskStats[task2.id]

    // 由于 task2 使用固定工期且独立，其标准差应该接近 0
    expect(task2Stats.std).toBeCloseTo(0, 0.1)
    expect(task2Stats.mean).toBeCloseTo(15, 0.5)
  })

  it('记录执行时间戳', () => {
    const project = createProject('测试项目', '2024-01-01')
    const task1 = createTask({ name: '任务1', duration: 10 })

    project.tasks[task1.id] = task1
    project.rootIds = [task1.id]

    const uncertainties: TaskUncertainty[] = [
      { taskId: task1.id, optimistic: 5, mostLikely: 10, pessimistic: 20 },
    ]

    const beforeTime = new Date().toISOString()

    const result = runSimulation(project, uncertainties, {
      iterations: 10,
      seed: 'test',
    })

    const afterTime = new Date().toISOString()

    // 验证时间戳在执行前后之间（使用字符串比较）
    expect(result.executedAt >= beforeTime).toBe(true)
    expect(result.executedAt <= afterTime).toBe(true)

    // 验证是有效的 ISO 字符串
    expect(() => new Date(result.executedAt)).not.toThrow()
  })
})
