import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'

import { initCommands, __resetRegistryForTests } from '../commands/registry'
import { createProject, createTask, createDependency } from '../domain/model/factories'
import { useProjectStore } from '../store/projectStore'
import { useScheduleStore } from '../store/scheduleStore'
import { solve } from '../domain/scheduler'
import { StatusBar } from './StatusBar'
import i18n from '../i18n'

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
  useScheduleStore.setState({ result: solve(project), error: null })
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
