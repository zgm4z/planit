import { describe, it, expect } from 'vitest'
import {
  sampleFromBeta,
  sampleProjectDurations,
  createSeededRng,
  hashSeed,
} from './sampling'
import type { Project, TaskUncertainty } from '../model/types'

describe('createSeededRng', () => {
  it('生成可复现的随机数序列', () => {
    const rng1 = createSeededRng(42)
    const rng2 = createSeededRng(42)

    const samples1 = Array.from({ length: 10 }, () => rng1())
    const samples2 = Array.from({ length: 10 }, () => rng2())

    expect(samples1).toEqual(samples2)
  })

  it('不同种子生成不同序列', () => {
    const rng1 = createSeededRng(42)
    const rng2 = createSeededRng(43)

    const samples1 = Array.from({ length: 10 }, () => rng1())
    const samples2 = Array.from({ length: 10 }, () => rng2())

    expect(samples1).not.toEqual(samples2)
  })

  it('生成 [0, 1) 区间的值', () => {
    const rng = createSeededRng(12345)
    const samples = Array.from({ length: 100 }, () => rng())

    samples.forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    })
  })
})

describe('hashSeed', () => {
  it('字符串转换为数字种子', () => {
    const seed = hashSeed('test-seed')
    expect(typeof seed).toBe('number')
    expect(seed).toBeGreaterThan(0)
  })

  it('相同字符串生成相同种子', () => {
    expect(hashSeed('test')).toBe(hashSeed('test'))
  })

  it('不同字符串生成不同种子', () => {
    expect(hashSeed('test1')).not.toBe(hashSeed('test2'))
  })
})

describe('sampleFromBeta', () => {
  const rng = createSeededRng(42)

  it('三点相同时返回确定值', () => {
    const result = sampleFromBeta(10, 10, 10, rng)
    expect(result).toBe(10)
  })

  it('采样值在 [O, P] 区间内', () => {
    const rng = createSeededRng(12345)
    const samples = Array.from({ length: 100 }, () => sampleFromBeta(5, 10, 20, rng))

    samples.forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(5)
      expect(v).toBeLessThanOrEqual(20)
    })
  })

  it('采样均值接近 PERT 期望值', () => {
    const rng = createSeededRng(54321)
    const o = 5
    const m = 10
    const p = 20

    // PERT 期望值: (O + 4M + P) / 6
    const expected = (o + 4 * m + p) / 6

    const samples = Array.from({ length: 10000 }, () => sampleFromBeta(o, m, p, rng))
    const mean = samples.reduce((sum, v) => sum + v, 0) / samples.length

    // 允许 5% 的误差
    expect(mean).toBeCloseTo(expected, 0)
    expect(Math.abs(mean - expected)).toBeLessThan(expected * 0.05)
  })

  it('无效输入抛出错误', () => {
    expect(() => sampleFromBeta(10, 5, 20, rng)).toThrow('Invalid three-point estimates')
    expect(() => sampleFromBeta(5, 20, 10, rng)).toThrow('Invalid three-point estimates')
  })
})

describe('sampleProjectDurations', () => {
  const mockProject: Project = {
    id: 'test',
    name: 'Test Project',
    schemaVersion: 1,
    startDate: '2024-01-01T09:00',
    schedulingDirection: 'forward',
    calendarId: 'default',
    calendars: {
      default: {
        id: 'default',
        name: 'Default',
        workingDays: [true, true, true, true, true, false, false],
        hoursPerDay: 8,
        exceptions: {},
      },
    },
    tasks: {
      task1: {
        id: 'task1',
        name: 'Task 1',
        parentId: null,
        childIds: [],
        kind: 'task',
        duration: 10,
        scheduling: { mode: 'auto' },
        progress: 0,
        effortMode: 'fixedDuration',
        schedulingOrder: 'asap',
        note: '',
        allowSplitting: false,
        priority: 0,
        delay: 0,
      },
      task2: {
        id: 'task2',
        name: 'Task 2',
        parentId: null,
        childIds: [],
        kind: 'task',
        duration: 20,
        scheduling: { mode: 'auto' },
        progress: 0,
        effortMode: 'fixedDuration',
        schedulingOrder: 'asap',
        note: '',
        allowSplitting: false,
        priority: 0,
        delay: 0,
      },
    },
    rootIds: ['task1', 'task2'],
    dependencies: {},
    resources: {},
    assignments: {},
    baselines: [],
    activeBaselineId: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  }

  it('无不确定性时使用确定性工期', () => {
    const rng = createSeededRng(42)
    const uncertainties: TaskUncertainty[] = []

    const durations = sampleProjectDurations(mockProject, uncertainties, rng)

    expect(durations.task1).toBe(10)
    expect(durations.task2).toBe(20)
  })

  it('有不确定性时采样随机工期', () => {
    const rng = createSeededRng(42)
    const uncertainties: TaskUncertainty[] = [
      { taskId: 'task1', optimistic: 5, mostLikely: 10, pessimistic: 20 },
    ]

    const durations = sampleProjectDurations(mockProject, uncertainties, rng)

    // task1 有不确定性，应该在 [5, 20] 区间
    expect(durations.task1).toBeGreaterThanOrEqual(5)
    expect(durations.task1).toBeLessThanOrEqual(20)

    // task2 没有不确定性，使用确定性工期
    expect(durations.task2).toBe(20)
  })

  it('为所有任务生成工期', () => {
    const rng = createSeededRng(42)
    const uncertainties: TaskUncertainty[] = []

    const durations = sampleProjectDurations(mockProject, uncertainties, rng)

    expect(Object.keys(durations).length).toBe(2)
    expect(durations).toHaveProperty('task1')
    expect(durations).toHaveProperty('task2')
  })

  it('使用相同种子生成相同结果', () => {
    const uncertainties: TaskUncertainty[] = [
      { taskId: 'task1', optimistic: 5, mostLikely: 10, pessimistic: 20 },
      { taskId: 'task2', optimistic: 10, mostLikely: 20, pessimistic: 40 },
    ]

    const rng1 = createSeededRng(12345)
    const durations1 = sampleProjectDurations(mockProject, uncertainties, rng1)

    const rng2 = createSeededRng(12345)
    const durations2 = sampleProjectDurations(mockProject, uncertainties, rng2)

    expect(durations1).toEqual(durations2)
  })
})
