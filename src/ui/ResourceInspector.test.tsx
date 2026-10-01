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

  it('按信息架构渲染四个区块标题（基本信息 / 可用性 / 成本 / 分配）', () => {
    renderPanel()
    // 此前资源面板是「一根没有分组的柱子」—— 这条断言把信息架构钉住：
    // 少了任何一个区块标题都会失败，防止退回平铺。
    for (const heading of ['基本信息', '可用性', '成本', '分配']) {
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
    }
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
    // 派生的总计改走 StatRow（标签 / 值分列）—— 断言按 testid 定位那一行的事实值，
    // 比「匹配一整句『总使用次数：0』」更精确（不依赖标签与值的拼接方式）。
    expect(screen.getByTestId('resource-total-assignments')).toHaveTextContent('0')
    expect(screen.getByTestId('resource-total-cost')).toHaveTextContent('0')
  })

  it('「新建资源」按钮 dispatch resource.create', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('button', { name: '新建资源' }))
    expect(Object.keys(useProjectStore.getState().project!.resources)).toHaveLength(2)
  })

  it('新建资源后自动选中新资源（面板显示的当前资源名指向新资源）', async () => {
    const user = userEvent.setup()
    renderPanel()
    // 新建前展示的是既有资源「张三」
    expect(screen.getByLabelText('名称')).toHaveValue('张三')
    await user.click(screen.getByRole('button', { name: '新建资源' }))
    // 建完即改：名称输入框应指向新资源（资源数 1 → 新资源名「名称 2」），而非旧资源
    expect(screen.getByLabelText('名称')).toHaveValue('名称 2')
  })

  it('点删除按钮后，该资源从 project.resources 消失（级联清分配由命令层负责）', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('button', { name: '删除资源' }))
    const resources = useProjectStore.getState().project!.resources
    expect(resources[resourceId]).toBeUndefined()
    expect(Object.keys(resources)).toHaveLength(0)
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
    expect(screen.getByTestId('resource-total-assignments')).toHaveTextContent('1')
    expect(screen.getByTestId('resource-total-hours')).toHaveTextContent('16')
  })
})

describe('资源面板 —— v0.6 超载可视化', () => {
  it('该资源无超载时显示「无超载」，且不出现超载提示', () => {
    renderPanel()
    expect(screen.getByText('无超载')).toBeInTheDocument()
    // 区分性断言：无超载时红色提示必须缺席 —— 只断言「无超载」存在是恒真的
    expect(screen.queryByTestId('resource-overload')).not.toBeInTheDocument()
  })

  it('无法平衡的超载（浮时耗尽）→ 显示红色超载提示与具体天数', () => {
    // 造一个无浮时的相撞场景：A、B 共用当前资源、各 2 个工作日、无依赖
    // → 两天各负载 2；两任务都无浮时可推，平衡不了 → unresolved 含 2 个单元
    const base = useProjectStore.getState().project!
    const a = createTask({ name: 'A', duration: 2 })
    const b = createTask({ name: 'B', duration: 2 })
    const project = {
      ...base,
      tasks: { [a.id]: a, [b.id]: b },
      rootIds: [a.id, b.id],
      assignments: {
        x1: createAssignment({ taskId: a.id, resourceId, units: 1 }),
        x2: createAssignment({ taskId: b.id, resourceId, units: 1 }),
      },
    }
    useProjectStore.setState({ project })
    useScheduleStore.setState({ result: solve(project), error: null })

    renderPanel()
    expect(screen.getByTestId('resource-overload')).toBeInTheDocument()
    // 断言具体信息（天数），而非仅仅「元素存在」
    expect(screen.getByText(/超载：2 天/)).toBeInTheDocument()
    // 与「无超载」分支互斥
    expect(screen.queryByText('无超载')).not.toBeInTheDocument()
  })
})
