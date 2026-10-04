import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'

// 只统计 resourceNamesByTask 的调用次数（仍委托真实实现）——
// 「ProjectView 的函数体有没有重跑」因此变成可断言的数字（同 StatusBar.memo.test.tsx 手法）。
vi.mock('../shared/resourceNames', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/resourceNames')>()
  return { ...actual, resourceNamesByTask: vi.fn(actual.resourceNamesByTask) }
})

// 本用例只关心 ProjectView 自己的记忆化 —— 把重子组件替换为空壳，
// 隔离掉 Toolbar / Inspector / 甘特层，避免无关依赖影响计数与渲染稳定性。
vi.mock('../shell/Toolbar', () => ({ Toolbar: () => null }))
vi.mock('../shell/StatusBar', () => ({ StatusBar: () => null }))
vi.mock('../outline/OutlineTree', () => ({ OutlineTree: () => null }))
vi.mock('../outline/OutlineTable', () => ({ OutlineTable: () => null }))
vi.mock('../inspector/Inspector', () => ({ Inspector: () => null }))
vi.mock('../gantt/DependencyLayer', () => ({ DependencyLayer: () => null }))
vi.mock('../gantt/GanttRows', () => ({ GanttRows: () => null }))
vi.mock('../gantt/TimeRuler', () => ({ TimeRuler: () => null }))
vi.mock('./CalendarView', () => ({ CalendarView: () => null }))
vi.mock('./ResourceView', () => ({ ResourceView: () => null }))

import { initCommands, __resetRegistryForTests } from '../../commands/registry'
import {
  createAssignment,
  createProject,
  createResource,
  createTask,
} from '../../domain/model/factories'
import { useProjectStore } from '../../store/projectStore'
import { useScheduleStore } from '../../store/scheduleStore'
import { useViewStore, __resetViewStoreForTests } from '../../store/viewStore'
import { solve } from '../../domain/scheduler'
import { resourceNamesByTask } from '../shared/resourceNames'
import { ProjectView } from './ProjectView'
import i18n from '../../i18n'

const resourceNamesMock = vi.mocked(resourceNamesByTask)

async function flushAsyncRecompute() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function renderProjectView() {
  return render(
    <MantineProvider>
      <ProjectView />
    </MantineProvider>,
  )
}

beforeEach(async () => {
  __resetRegistryForTests()
  initCommands()
  __resetViewStoreForTests()
  await i18n.changeLanguage('zh-CN')

  const project = createProject('测试', '2026-03-02')
  const t1 = createTask({ name: 'T1', duration: 3 })
  project.tasks[t1.id] = t1
  project.rootIds = [t1.id]
  const r1 = createResource({ name: '张三' })
  project.resources[r1.id] = r1
  const a1 = createAssignment({ taskId: t1.id, resourceId: r1.id })
  project.assignments[a1.id] = a1

  useProjectStore.setState({ project, undoStack: [], redoStack: [], lastError: null })
  useScheduleStore.setState({ result: solve(project), error: null, computing: false })
  await flushAsyncRecompute()

  resourceNamesMock.mockClear()
})

describe('ProjectView 的 resourceNamesByTask 记忆化（滚动性能）', () => {
  it('非 project 变更触发的重渲染不重算；project 引用变更才重算', async () => {
    renderProjectView()
    expect(resourceNamesMock).toHaveBeenCalledTimes(1)

    // 纯 UI 状态变更（dayWidth）→ ProjectView 重渲染，但 project 引用不变 → memo 不重算
    act(() => {
      useViewStore.setState({ dayWidth: 48 })
    })
    expect(resourceNamesMock).toHaveBeenCalledTimes(1)

    // project 引用变更 → memo 重算
    act(() => {
      const prev = useProjectStore.getState().project!
      useProjectStore.setState({ project: { ...prev } })
    })
    await flushAsyncRecompute()
    expect(resourceNamesMock.mock.calls.length).toBeGreaterThan(1)
  })
})
