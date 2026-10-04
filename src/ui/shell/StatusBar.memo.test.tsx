import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { MantineProvider } from '@mantine/core'

// 用 spy 包住两次全项目扫描，**只统计调用次数**（仍委托真实实现）。
// 这样「StatusBar 的函数体有没有重跑」变成可断言的数字：
//   · memo 生效   → 父组件重渲染时函数体不跑 → 计数不变
//   · store 变更  → 订阅驱动重渲染           → 计数 +1
// 注意：vi.mock 提升到所有 import 之前，且 specifier 与 StatusBar 内部的
// `../shared/projectSummary` 解析到**同一个模块**（本文件也在 src/ui/shell/ 下）。
vi.mock('../shared/projectSummary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/projectSummary')>()
  return {
    ...actual,
    computeProjectSummary: vi.fn(actual.computeProjectSummary),
    countCriticalLeafTasks: vi.fn(actual.countCriticalLeafTasks),
  }
})

import { initCommands, __resetRegistryForTests } from '../../commands/registry'
import { createProject, createTask } from '../../domain/model/factories'
import { useProjectStore } from '../../store/projectStore'
import { useScheduleStore } from '../../store/scheduleStore'
import { solve } from '../../domain/scheduler'
import { computeProjectSummary, countCriticalLeafTasks } from '../shared/projectSummary'
import { StatusBar } from './StatusBar'
import i18n from '../../i18n'

const computeMock = vi.mocked(computeProjectSummary)
const criticalMock = vi.mocked(countCriticalLeafTasks)

/**
 * 一个「每帧都在重渲染」的父组件 —— 模拟 ProjectView（虚拟化器把可见区间存成
 * 内部 state，滚动时每帧重渲染）。`force` 按钮即一次纯父组件重渲染：它自身
 * 的 state 变了，但 StatusBar 的 store 输入一个都没动。
 */
function ScrollingParent() {
  const [, setTick] = useState(0)
  return (
    <>
      <button data-testid="force-parent-render" onClick={() => setTick((n) => n + 1)}>
        force
      </button>
      <StatusBar />
    </>
  )
}

/** 排空 store 变更引发的异步重算，避免它落在断言中途 */
async function flushAsyncRecompute() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeEach(async () => {
  __resetRegistryForTests()
  initCommands()
  await i18n.changeLanguage('zh-CN')

  const project = createProject('测试', '2026-03-02')
  const a = createTask({ name: 'A', duration: 3 })
  const b = createTask({ name: 'B', duration: 2 })
  project.tasks[a.id] = a
  project.tasks[b.id] = b
  project.rootIds = [a.id, b.id]

  useProjectStore.setState({ project, undoStack: [], redoStack: [], lastError: null })
  useScheduleStore.setState({ result: solve(project), error: null, computing: false })
  // project 变更会触发一次异步重算（scheduleStore 的订阅）—— 先冲掉，
  // 免得它在下面的断言之间落库。
  await flushAsyncRecompute()

  computeMock.mockClear()
  criticalMock.mockClear()
})

describe('StatusBar 的 memo 守卫（滚动性能）', () => {
  it('父组件重渲染不重跑两次全项目扫描；store 真正变更才重跑', async () => {
    render(
      <MantineProvider>
        <ScrollingParent />
      </MantineProvider>,
    )

    // 首次挂载：两次扫描各跑一次
    expect(computeMock).toHaveBeenCalledTimes(1)
    expect(criticalMock).toHaveBeenCalledTimes(1)

    // 模拟 5 个「滚动帧」：纯父组件重渲染，store 输入未变。
    // 关键判据 —— 计数必须纹丝不动（去掉 memo 后这里会涨到 6）。
    for (let i = 0; i < 5; i += 1) {
      fireEvent.click(screen.getByTestId('force-parent-render'))
    }
    expect(computeMock).toHaveBeenCalledTimes(1)
    expect(criticalMock).toHaveBeenCalledTimes(1)

    // 状态栏内容仍在（没有因为跳过渲染而丢失）
    expect(screen.getByTestId('status-span')).toHaveTextContent('2026-03-02')
    expect(screen.getByTestId('status-critical')).toHaveTextContent('关键任务')

    // store 真正变更（新的 schedules 引用）→ 订阅驱动重渲染 → 扫描重跑。
    // 只断言「确实跑了」而非精确次数：zustand 的 useSyncExternalStore 在测试环境
    // 对一次 store 变更可能提交两帧 —— 这里关心的是「有没有跑」，不是跑了几遍。
    const before = computeMock.mock.calls.length
    act(() => {
      const prev = useScheduleStore.getState().result
      useScheduleStore.setState({ result: { ...prev, schedules: { ...prev.schedules } } })
    })
    expect(computeMock.mock.calls.length).toBeGreaterThan(before)
    expect(criticalMock.mock.calls.length).toBe(computeMock.mock.calls.length)

    // 数值不变（同一份排期，只是引用换了）
    expect(screen.getByTestId('status-span')).toHaveTextContent('2026-03-02')
  })

  it('「计算中」指示器仍随 store 的 computing 变化 —— memo 不冻结订阅', async () => {
    vi.useFakeTimers()
    try {
      render(
        <MantineProvider>
          <ScrollingParent />
        </MantineProvider>,
      )

      act(() => {
        useScheduleStore.setState({ computing: true })
      })
      act(() => {
        vi.advanceTimersByTime(400)
      })
      expect(screen.getByTestId('status-computing')).toHaveTextContent('正在计算排期')

      act(() => {
        useScheduleStore.setState({ computing: false })
      })
      expect(screen.queryByTestId('status-computing')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})
