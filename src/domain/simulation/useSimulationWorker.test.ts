import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useSimulationWorker } from './useSimulationWorker'
import type { Project } from '../model/types'
import type { SimulationConfig } from './simulationTypes'

// Helper function to create a minimal valid Project
function createMockProject(): Project {
  return {
    id: 'test-project',
    schemaVersion: 4,
    name: 'Test',
    schedulingDirection: 'forward',
    startDate: '2024-01-01T09:00:00',
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
        duration: 5,
        progress: 0,
        kind: 'task',
        scheduling: { mode: 'auto' },
        delay: 0,
        priority: 0,
        effortMode: 'fixedDuration',
        schedulingOrder: 'asap',
        note: '',
        allowSplitting: false,
      },
    },
    rootIds: ['task1'],
    dependencies: {},
    resources: {},
    assignments: {},
    baselines: [],
    activeBaselineId: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  }
}

describe('useSimulationWorker', () => {
  let mockWorker: {
    postMessage: ReturnType<typeof vi.fn>
    terminate: ReturnType<typeof vi.fn>
    onmessage: ((e: MessageEvent) => void) | null
    onerror: ((e: ErrorEvent) => void) | null
  }

  beforeEach(() => {
    // Mock Worker constructor
    mockWorker = {
      postMessage: vi.fn(),
      terminate: vi.fn(),
      onmessage: null,
      onerror: null,
    }

    // 必须用 function 而不是箭头函数，这样才能作为构造函数
    global.Worker = vi.fn(function (this: any) {
      return mockWorker
    }) as any

    global.URL.createObjectURL = vi.fn(() => 'blob:mock-url')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('应该创建 worker 并发送模拟请求', () => {
    const { result } = renderHook(() => useSimulationWorker())

    const mockProject = createMockProject()

    const uncertainties = [{ taskId: 'task1', optimistic: 3.5, mostLikely: 5, pessimistic: 7.5 }]
    const config: SimulationConfig = { iterations: 100, confidenceLevel: 0.95 }
    const callbacks = {
      onResult: vi.fn(),
      onError: vi.fn(),
    }

    act(() => {
      result.current.runSimulation(mockProject, uncertainties, config, callbacks)
    })

    expect(Worker).toHaveBeenCalled()
    expect(mockWorker.postMessage).toHaveBeenCalledWith({
      type: 'run',
      project: mockProject,
      uncertainties,
      config,
    })
  })

  it('应该处理成功的模拟结果', async () => {
    const { result } = renderHook(() => useSimulationWorker())

    const mockProject = createMockProject()

    const callbacks = {
      onResult: vi.fn(),
      onError: vi.fn(),
    }

    act(() => {
      result.current.runSimulation(mockProject, [], { iterations: 100 }, callbacks)
    })

    // 模拟 worker 返回结果
    const mockResult = {
      projectStats: {
        mean: 5.2,
        median: 5.1,
        std: 0.8,
        p10: 4.1,
        p50: 5.1,
        p90: 6.3,
      },
      taskStats: {},
    }

    act(() => {
      mockWorker.onmessage!({ data: { type: 'result', result: mockResult } } as MessageEvent)
    })

    await waitFor(() => {
      expect(callbacks.onResult).toHaveBeenCalledWith(mockResult)
      expect(mockWorker.terminate).toHaveBeenCalled()
    })
  })

  it('应该处理错误', async () => {
    const { result } = renderHook(() => useSimulationWorker())

    const mockProject = createMockProject()

    const callbacks = {
      onResult: vi.fn(),
      onError: vi.fn(),
    }

    act(() => {
      result.current.runSimulation(mockProject, [], { iterations: 100 }, callbacks)
    })

    // 模拟 worker 返回错误
    act(() => {
      mockWorker.onmessage!({ data: { type: 'error', error: 'Test error' } } as MessageEvent)
    })

    await waitFor(() => {
      expect(callbacks.onError).toHaveBeenCalledWith('Test error')
      expect(mockWorker.terminate).toHaveBeenCalled()
    })
  })

  it('应该能取消正在运行的模拟', () => {
    const { result } = renderHook(() => useSimulationWorker())

    const mockProject = createMockProject()

    act(() => {
      result.current.runSimulation(mockProject, [], { iterations: 100 }, {
        onResult: vi.fn(),
        onError: vi.fn(),
      })
    })

    expect(mockWorker.terminate).not.toHaveBeenCalled()

    act(() => {
      result.current.cancel()
    })

    expect(mockWorker.terminate).toHaveBeenCalled()
  })
})
