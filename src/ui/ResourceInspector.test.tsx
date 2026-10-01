import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'

import { initCommands, __resetRegistryForTests } from '../commands/registry'
import {
  createAssignment,
  createProject,
  createResource,
  createTask,
  __resetIdCounterForTests,
} from '../domain/model/factories'
import { useProjectStore } from '../store/projectStore'
import { useScheduleStore } from '../store/scheduleStore'
import { solve } from '../domain/scheduler'
import { ResourceInspector } from './ResourceInspector'
import i18n from '../i18n'

let resourceId: string

function renderPanel() {
  return render(
    <MantineProvider>
      <ResourceInspector />
    </MantineProvider>,
  )
}

beforeEach(async () => {
  __resetRegistryForTests()
  initCommands()
  __resetIdCounterForTests()
  await i18n.changeLanguage('zh-CN')

  const project = createProject('测试', '2026-03-02')
  const resource = createResource({ name: '张三' })
  project.resources[resource.id] = resource
  resourceId = resource.id

  useProjectStore.setState({ project, undoStack: [], redoStack: [], lastError: null })
  useScheduleStore.setState({ result: solve(project), error: null })
})

describe('资源面板', () => {
  it('渲染字段：名称 / 电子邮件 / 类型 / 可用率 / 可用期间 / 两种成本 / 货币', () => {
    renderPanel()
    for (const label of [
      '名称', '电子邮件', '可用率（%）', '可用起始', '可用结束', '使用成本', '小时成本', '货币',
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument()
    }
    // 「类型」是 Select：Mantine 9 会把 label 同时关联到 combobox 与（keepMounted 的）
    // listbox 容器，getByLabelText 会命中两个而抛错 —— 用 role 收窄到输入框本身，
    // 与全库对其他 Select 的查法一致（见 ProjectInspector.test.tsx 的同款注释）。
    expect(screen.getByRole('combobox', { name: '类型' })).toBeInTheDocument()
  })

  it('改名写回 store', async () => {
    const user = userEvent.setup()
    renderPanel()
    const input = screen.getByLabelText('名称')
    await user.clear(input)
    await user.type(input, '李四')
    expect(useProjectStore.getState().project!.resources[resourceId].name).toBe('李四')
  })

  it('可用率按百分数输入、按 0–1 存回', () => {
    renderPanel()
    fireEvent.change(screen.getByLabelText('可用率（%）'), { target: { value: '50' } })
    expect(useProjectStore.getState().project!.resources[resourceId].availability).toBeCloseTo(0.5)
  })

  it('可用期间写回 availableFrom / availableUntil', () => {
    renderPanel()
    fireEvent.change(screen.getByLabelText('可用起始'), { target: { value: '2026-03-10' } })
    fireEvent.change(screen.getByLabelText('可用结束'), { target: { value: '2026-04-01' } })
    expect(useProjectStore.getState().project!.resources[resourceId]).toMatchObject({
      availableFrom: '2026-03-10',
      availableUntil: '2026-04-01',
    })
  })

  it('无分配时派生的总计为 0', () => {
    renderPanel()
    expect(screen.getByText(/总使用次数：0/)).toBeInTheDocument()
    expect(screen.getByText(/总成本：0/)).toBeInTheDocument()
  })

  it('「新建资源」按钮 dispatch resource.create', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('button', { name: '新建资源' }))
    expect(Object.keys(useProjectStore.getState().project!.resources)).toHaveLength(2)
  })
})

describe('资源面板 —— 一个真实分配下的总计', () => {
  it('挂一条 units=1 的分配后，总使用次数为 1、总时数 = 工期 × hoursPerDay', () => {
    const base = useProjectStore.getState().project!
    const task = createTask({ name: 'A', duration: 2 })
    const assignment = createAssignment({ taskId: task.id, resourceId, units: 1 })
    const project = {
      ...base,
      tasks: { [task.id]: task },
      rootIds: [task.id],
      assignments: { [assignment.id]: assignment },
    }
    useProjectStore.setState({ project })
    useScheduleStore.setState({ result: solve(project), error: null })

    renderPanel()
    // 工期 2 个工作日 × 8 小时 = 16 小时；1 条分配；成本 0（未设费率）
    expect(screen.getByText(/总使用次数：1/)).toBeInTheDocument()
    expect(screen.getByText(/总时数：16/)).toBeInTheDocument()
  })
})
