import { describe, it, expect, beforeEach } from 'vitest'
import { useSimulationStore } from './simulationStore'
import type { SimulationConfig, TaskUncertainty } from '../domain/simulation/types'

describe('useSimulationStore', () => {
  beforeEach(() => {
    // 重置 store 状态
    useSimulationStore.getState().clear()
  })

  describe('初始状态', () => {
    it('默认状态为空', () => {
      const state = useSimulationStore.getState()
      expect(state.config).toBeNull()
      expect(state.uncertainties).toEqual([])
      expect(state.result).toBeNull()
      expect(state.isRunning).toBe(false)
      expect(state.progress).toBe(0)
      expect(state.lastError).toBeNull()
    })
  })

  describe('setConfig', () => {
    it('设置模拟配置', () => {
      const config: SimulationConfig = {
        iterations: 1000,
        seed: 'test-seed',
        confidenceLevel: 0.95,
      }

      useSimulationStore.getState().setConfig(config)
      expect(useSimulationStore.getState().config).toEqual(config)
    })
  })

  describe('setUncertainties', () => {
    it('设置任务不确定性参数数组', () => {
      const uncertainties: TaskUncertainty[] = [
        { taskId: 'task1', optimistic: 5, mostLikely: 10, pessimistic: 20 },
        { taskId: 'task2', optimistic: 10, mostLikely: 20, pessimistic: 40 },
      ]

      useSimulationStore.getState().setUncertainties(uncertainties)
      expect(useSimulationStore.getState().uncertainties).toEqual(uncertainties)
    })

    it('覆盖现有不确定性参数', () => {
      const initial: TaskUncertainty[] = [
        { taskId: 'task1', optimistic: 5, mostLikely: 10, pessimistic: 20 },
      ]
      const updated: TaskUncertainty[] = [
        { taskId: 'task2', optimistic: 10, mostLikely: 20, pessimistic: 40 },
      ]

      useSimulationStore.getState().setUncertainties(initial)
      useSimulationStore.getState().setUncertainties(updated)
      expect(useSimulationStore.getState().uncertainties).toEqual(updated)
    })
  })

  describe('updateUncertainty', () => {
    it('添加新的不确定性参数', () => {
      const uncertainty: TaskUncertainty = {
        taskId: 'task1',
        optimistic: 5,
        mostLikely: 10,
        pessimistic: 20,
      }

      useSimulationStore.getState().updateUncertainty(uncertainty)
      expect(useSimulationStore.getState().uncertainties).toEqual([uncertainty])
    })

    it('更新现有任务的不确定性参数', () => {
      const initial: TaskUncertainty = {
        taskId: 'task1',
        optimistic: 5,
        mostLikely: 10,
        pessimistic: 20,
      }
      const updated: TaskUncertainty = {
        taskId: 'task1',
        optimistic: 3,
        mostLikely: 8,
        pessimistic: 15,
      }

      useSimulationStore.getState().updateUncertainty(initial)
      useSimulationStore.getState().updateUncertainty(updated)

      const uncertainties = useSimulationStore.getState().uncertainties
      expect(uncertainties).toHaveLength(1)
      expect(uncertainties[0]).toEqual(updated)
    })

    it('只更新目标任务，不影响其他任务', () => {
      const task1: TaskUncertainty = {
        taskId: 'task1',
        optimistic: 5,
        mostLikely: 10,
        pessimistic: 20,
      }
      const task2: TaskUncertainty = {
        taskId: 'task2',
        optimistic: 10,
        mostLikely: 20,
        pessimistic: 40,
      }
      const task1Updated: TaskUncertainty = {
        taskId: 'task1',
        optimistic: 3,
        mostLikely: 8,
        pessimistic: 15,
      }

      useSimulationStore.getState().setUncertainties([task1, task2])
      useSimulationStore.getState().updateUncertainty(task1Updated)

      const uncertainties = useSimulationStore.getState().uncertainties
      expect(uncertainties).toHaveLength(2)
      expect(uncertainties[0]).toEqual(task1Updated)
      expect(uncertainties[1]).toEqual(task2)
    })
  })

  describe('removeUncertainty', () => {
    it('移除指定任务的不确定性参数', () => {
      const uncertainties: TaskUncertainty[] = [
        { taskId: 'task1', optimistic: 5, mostLikely: 10, pessimistic: 20 },
        { taskId: 'task2', optimistic: 10, mostLikely: 20, pessimistic: 40 },
      ]

      useSimulationStore.getState().setUncertainties(uncertainties)
      useSimulationStore.getState().removeUncertainty('task1')

      const remaining = useSimulationStore.getState().uncertainties
      expect(remaining).toHaveLength(1)
      expect(remaining[0].taskId).toBe('task2')
    })

    it('移除不存在的任务不报错', () => {
      const uncertainties: TaskUncertainty[] = [
        { taskId: 'task1', optimistic: 5, mostLikely: 10, pessimistic: 20 },
      ]

      useSimulationStore.getState().setUncertainties(uncertainties)
      useSimulationStore.getState().removeUncertainty('nonexistent')

      expect(useSimulationStore.getState().uncertainties).toEqual(uncertainties)
    })
  })

  describe('setResult', () => {
    it('设置模拟结果', () => {
      const result = {
        iterations: 1000,
        projectDuration: {
          mean: 100,
          median: 95,
          std: 15,
          min: 70,
          max: 140,
          p10: 80,
          p50: 95,
          p90: 120,
        },
        taskDurations: {},
        histogram: { binEdges: [70, 80, 90, 100], counts: [10, 30, 40] },
        executedAt: '2024-01-01T00:00:00Z',
      }

      useSimulationStore.getState().setResult(result)
      expect(useSimulationStore.getState().result).toEqual(result)
    })
  })

  describe('setRunning', () => {
    it('设置运行状态', () => {
      useSimulationStore.getState().setRunning(true)
      expect(useSimulationStore.getState().isRunning).toBe(true)

      useSimulationStore.getState().setRunning(false)
      expect(useSimulationStore.getState().isRunning).toBe(false)
    })
  })

  describe('setProgress', () => {
    it('设置进度', () => {
      useSimulationStore.getState().setProgress(50)
      expect(useSimulationStore.getState().progress).toBe(50)

      useSimulationStore.getState().setProgress(100)
      expect(useSimulationStore.getState().progress).toBe(100)
    })
  })

  describe('setError', () => {
    it('设置错误信息', () => {
      useSimulationStore.getState().setError('测试错误')
      expect(useSimulationStore.getState().lastError).toBe('测试错误')
    })

    it('清空错误信息', () => {
      useSimulationStore.getState().setError('测试错误')
      useSimulationStore.getState().setError(null)
      expect(useSimulationStore.getState().lastError).toBeNull()
    })
  })

  describe('clear', () => {
    it('清空所有模拟数据', () => {
      // 设置一些状态
      useSimulationStore.getState().setConfig({
        iterations: 1000,
        seed: 'test',
        confidenceLevel: 0.95,
      })
      useSimulationStore.getState().setUncertainties([
        { taskId: 'task1', optimistic: 5, mostLikely: 10, pessimistic: 20 },
      ])
      useSimulationStore.getState().setRunning(true)
      useSimulationStore.getState().setProgress(50)
      useSimulationStore.getState().setError('错误')

      // 清空
      useSimulationStore.getState().clear()

      // 验证所有状态已重置
      const state = useSimulationStore.getState()
      expect(state.config).toBeNull()
      expect(state.uncertainties).toEqual([])
      expect(state.result).toBeNull()
      expect(state.isRunning).toBe(false)
      expect(state.progress).toBe(0)
      expect(state.lastError).toBeNull()
    })
  })
})
