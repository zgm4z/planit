import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'

import { initCommands, __resetRegistryForTests } from '../../commands/registry'
import { createProject, createTask, createDependency } from '../../domain/model/factories'
import { useProjectStore } from '../../store/projectStore'
import { useScheduleStore } from '../../store/scheduleStore'
import { solve } from '../../domain/scheduler'
import { StatusBar, COMPUTING_INDICATOR_DELAY_MS } from './StatusBar'
import i18n from '../../i18n'

function renderStatusBar() {
  return render(
    <MantineProvider>
      <StatusBar />
    </MantineProvider>,
  )
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
  const dep = createDependency(a.id, b.id)
  project.dependencies[dep.id] = dep

  useProjectStore.setState({ project, undoStack: [], redoStack: [], lastError: null })
  useScheduleStore.setState({ result: solve(project), error: null, computing: false })
  // 上面的 project 变更会触发一次**异步**重算（在微任务里 setState）。先把它冲掉，
  // 免得它在下个用例中途落库 —— 那会让「计算中」指示器的时序断言变得不确定。
  await new Promise((resolve) => setTimeout(resolve, 0))
})

describe('StatusBar', () => {
  it('显示项目的起止日期与总工期', () => {
    renderStatusBar()
    // A: 03-02 → 03-04，B: 03-05 → 03-06
    expect(screen.getByText(/2026-03-02/)).toBeInTheDocument()
    expect(screen.getByText(/2026-03-06/)).toBeInTheDocument()
    expect(screen.getByText(/共 5 个工作日/)).toBeInTheDocument()
  })

  it('统计出位于关键路径上的叶子任务数量', () => {
    renderStatusBar()
    expect(screen.getByText(/关键任务 2 个/)).toBeInTheDocument()
  })

  it('没有任务时显示占位文案', () => {
    useProjectStore.setState({
      project: createProject('空', '2026-03-02'),
      undoStack: [],
      redoStack: [],
      lastError: null,
    })
    useScheduleStore.setState({
      result: {
        schedules: {},
        conflicts: [],
        efforts: {},
        costs: {},
        resourceTotals: {},
        leveling: { delays: {}, unresolved: [] },
        earnedValues: {},
        baselineDiffs: {},
      },
      error: null,
    })

    renderStatusBar()
    expect(screen.getByText(/暂无排期/)).toBeInTheDocument()
  })
})

describe('StatusBar「计算中」指示器', () => {
  it('延迟未到不出现（快求解不闪）；越过延迟才出现；结束立即消失', () => {
    vi.useFakeTimers()
    try {
      renderStatusBar()
      act(() => {
        useScheduleStore.setState({ computing: false })
      })
      expect(screen.queryByTestId('status-computing')).not.toBeInTheDocument()

      act(() => {
        useScheduleStore.setState({ computing: true })
      })
      // 延迟边界前：仍不显示 —— 这正是「2ms 的纯 CPM 不闪提示」的判据
      act(() => {
        vi.advanceTimersByTime(COMPUTING_INDICATOR_DELAY_MS - 1)
      })
      expect(screen.queryByTestId('status-computing')).not.toBeInTheDocument()

      act(() => {
        vi.advanceTimersByTime(1)
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

  it('非阻塞：指示器是 role=status（polite），不是 alert/modal', async () => {
    renderStatusBar()
    act(() => {
      useScheduleStore.setState({ computing: true })
    })
    const indicator = await screen.findByTestId('status-computing')
    expect(indicator).toHaveAttribute('role', 'status')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    act(() => {
      useScheduleStore.setState({ computing: false })
    })
  })

  it('文案三语齐全（zh-CN / en-US / ja-JP）', async () => {
    renderStatusBar()
    const cases: [string, RegExp][] = [
      ['zh-CN', /正在计算排期/],
      ['en-US', /Computing schedule/],
      ['ja-JP', /スケジュールを計算中/],
    ]
    for (const [language, pattern] of cases) {
      await i18n.changeLanguage(language)
      act(() => {
        useScheduleStore.setState({ computing: true })
      })
      const indicator = await screen.findByTestId('status-computing')
      expect(indicator).toHaveTextContent(pattern)
      act(() => {
        useScheduleStore.setState({ computing: false })
      })
    }
  })
})
