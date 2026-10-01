import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'

import { initCommands, __resetRegistryForTests } from '../commands/registry'
import {
  createDependency,
  createProject,
  createTask,
  __resetIdCounterForTests,
} from '../domain/model/factories'
import { useProjectStore } from '../store/projectStore'
import { useScheduleStore } from '../store/scheduleStore'
import { useViewStore } from '../store/viewStore'
import { Inspector } from './Inspector'
import i18n from '../i18n'

let parentId: string
let taskId: string
let siblingId: string

function renderInspector() {
  return render(
    <MantineProvider>
      <Inspector />
    </MantineProvider>,
  )
}

function currentTask() {
  return useProjectStore.getState().project!.tasks[taskId]
}

/**
 * 选中一个 Mantine Select 的选项。
 *
 * 为什么不用 `user.click(option)`：Mantine 9 的下拉由 Transition 控制显隐，
 * 在 jsdom 里它的计算样式停在 `display: none`（真实浏览器里是 `block`，
 * 已用 Playwright 验证）。user-event 会做可见性检查因而拒绝点击。
 * fireEvent 不做检查，而这条路径依然走完整的
 * 「option onClick → Select onChange → dispatch」—— 断言落在 store 上，
 * 不是外观。下拉的开合本身由 Playwright 验收覆盖。
 */
async function chooseOption(
  user: ReturnType<typeof userEvent.setup>,
  selectLabel: string,
  optionLabel: string,
) {
  await user.click(screen.getByRole('combobox', { name: selectLabel }))
  fireEvent.click(screen.getByRole('option', { name: optionLabel, hidden: true }))
}

beforeEach(async () => {
  __resetRegistryForTests()
  initCommands()
  __resetIdCounterForTests()
  await i18n.changeLanguage('zh-CN')

  const project = createProject('测试', '2026-03-02')
  const parent = createTask({ name: '阶段一' })
  const child = createTask({ name: '写文档', duration: 3 })
  const sibling = createTask({ name: '写代码', duration: 2 })
  project.tasks[parent.id] = parent
  project.tasks[child.id] = { ...child, parentId: parent.id }
  project.tasks[sibling.id] = { ...sibling, parentId: parent.id }
  project.tasks[parent.id].childIds = [child.id, sibling.id]
  project.rootIds = [parent.id]
  parentId = parent.id
  taskId = child.id
  siblingId = sibling.id

  useProjectStore.setState({ project, undoStack: [], redoStack: [], lastError: null })
  useViewStore.setState({ selectedTaskId: child.id, collapsedIds: new Set() })
})

describe('Inspector', () => {
  it('未选中任务时不渲染内容', () => {
    useViewStore.setState({ selectedTaskId: null })
    renderInspector()
    expect(screen.queryByText('任务详情')).not.toBeInTheDocument()
  })

  it('显示选中任务的名称', () => {
    renderInspector()
    expect(screen.getByDisplayValue('写文档')).toBeInTheDocument()
  })

  it('修改工期会写回 store', async () => {
    const user = userEvent.setup()
    renderInspector()

    const input = screen.getByLabelText('工期')
    await user.clear(input)
    await user.type(input, '5')

    expect(currentTask().duration).toBe(5)
  })

  it('修改进度会写回 store', async () => {
    const user = userEvent.setup()
    renderInspector()

    const input = screen.getByLabelText('进度（%）')
    await user.clear(input)
    await user.type(input, '40')

    expect(currentTask().progress).toBe(40)
  })

  it('切换里程碑会把工期归零', async () => {
    const user = userEvent.setup()
    renderInspector()

    await user.click(screen.getByLabelText('里程碑'))

    const task = currentTask()
    expect(task.isMilestone).toBe(true)
    expect(task.duration).toBe(0)
  })

  it('摘要任务不显示可编辑的工期输入框', () => {
    useViewStore.setState({ selectedTaskId: parentId })
    renderInspector()

    expect(screen.queryByLabelText('工期')).not.toBeInTheDocument()
    expect(screen.getByText(/日期由子任务汇总/)).toBeInTheDocument()
  })

  it('摘要任务不渲染排期方式下拉与约束日期', () => {
    useViewStore.setState({ selectedTaskId: parentId })
    renderInspector()

    expect(screen.queryByRole('combobox', { name: '排期方式' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('约束日期')).not.toBeInTheDocument()
  })

  it('摘要任务不渲染「添加前置任务」', () => {
    useViewStore.setState({ selectedTaskId: parentId })
    renderInspector()

    expect(screen.queryByRole('combobox', { name: '添加前置任务' })).not.toBeInTheDocument()
  })

  it('排期方式切到固定开始日期会写入约束，日期取当前最早开始日', async () => {
    const user = userEvent.setup()
    renderInspector()

    await chooseOption(user, '排期方式', '固定开始日期')

    const scheduling = currentTask().scheduling
    expect(scheduling.mode).toBe('constraint')
    if (scheduling.mode !== 'constraint') throw new Error('unreachable')
    expect(scheduling.type).toBe('startOn')
    expect(scheduling.date).toBe(useScheduleStore.getState().result.schedules[taskId].earlyStart)
  })

  it('排期方式切到固定结束日期会写入 finishOn 约束', async () => {
    const user = userEvent.setup()
    renderInspector()

    await chooseOption(user, '排期方式', '固定结束日期')

    expect(currentTask().scheduling).toEqual({
      mode: 'constraint',
      type: 'finishOn',
      date: '2026-03-02',
    })
  })

  it('排期方式切回自动会清掉约束', async () => {
    const user = userEvent.setup()
    useProjectStore.setState({
      project: {
        ...useProjectStore.getState().project!,
        tasks: {
          ...useProjectStore.getState().project!.tasks,
          [taskId]: {
            ...currentTask(),
            scheduling: { mode: 'constraint', type: 'finishOn', date: '2026-03-05' },
          },
        },
      },
    })

    renderInspector()
    await chooseOption(user, '排期方式', '自动排期')

    expect(currentTask().scheduling).toEqual({ mode: 'auto' })
  })

  it('已存在的约束会被排期下拉正确读出', () => {
    useProjectStore.setState({
      project: {
        ...useProjectStore.getState().project!,
        tasks: {
          ...useProjectStore.getState().project!.tasks,
          [taskId]: {
            ...currentTask(),
            scheduling: { mode: 'constraint', type: 'finishOn', date: '2026-03-05' },
          },
        },
      },
    })

    renderInspector()

    expect(screen.getByRole('combobox', { name: '排期方式' })).toHaveValue('固定结束日期')
    expect(screen.getByLabelText('约束日期')).toHaveValue('2026-03-05')
  })

  it('冲突提示用当前语言的约束名，而不是裸 ConstraintType 键', () => {
    const project = useProjectStore.getState().project!
    const dep = createDependency(siblingId, taskId, 'FS', 0)

    useProjectStore.setState({
      project: {
        ...project,
        dependencies: { ...project.dependencies, [dep.id]: dep },
        tasks: {
          ...project.tasks,
          // 依赖要求它不早于 2026-03-04（写代码 03-03 完成 + FS），
          // 这里把它钉死在 03-02 —— 必然冲突
          [taskId]: {
            ...currentTask(),
            scheduling: { mode: 'constraint', type: 'startOn', date: '2026-03-02' },
          },
        },
      },
    })

    renderInspector()

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('固定开始日期')
    expect(alert).not.toHaveTextContent('startOn')
  })

  it('通过下拉建立前置依赖，并显示在依赖列表里', async () => {
    const user = userEvent.setup()
    renderInspector()

    await chooseOption(user, '添加前置任务', '写代码')

    const deps = Object.values(useProjectStore.getState().project!.dependencies)
    expect(deps).toHaveLength(1)
    expect(deps[0]).toMatchObject({ fromTaskId: siblingId, toTaskId: taskId, type: 'FS', lag: 0 })
    // 前置依赖在列表里以「←」标记
    expect(screen.getByText(/←\s*写代码/)).toBeInTheDocument()
  })

  it('改依赖类型与 lag 会更新 store，删除后消失', async () => {
    const user = userEvent.setup()
    renderInspector()

    await chooseOption(user, '添加前置任务', '写代码')
    expect(screen.getByText(/←\s*写代码/)).toBeInTheDocument()

    await chooseOption(user, '依赖关系 写代码', 'SS')

    const lagInput = screen.getByLabelText('延迟 写代码')
    await user.clear(lagInput)
    await user.type(lagInput, '2')

    const dep = Object.values(useProjectStore.getState().project!.dependencies)[0]
    expect(dep.type).toBe('SS')
    expect(dep.lag).toBe(2)

    await user.click(screen.getByLabelText('删除依赖 写代码'))

    expect(Object.values(useProjectStore.getState().project!.dependencies)).toHaveLength(0)
    expect(screen.queryByText(/←\s*写代码/)).not.toBeInTheDocument()
  })

  it('依赖列表面向后续任务时用「→」标记', () => {
    const project = useProjectStore.getState().project!
    const dep = createDependency(taskId, siblingId, 'FS', 0)
    useProjectStore.setState({
      project: { ...project, dependencies: { ...project.dependencies, [dep.id]: dep } },
    })

    renderInspector()

    expect(screen.getByText(/→\s*写代码/)).toBeInTheDocument()
  })

  it('已经连过的前置不再出现在候选里', () => {
    const project = useProjectStore.getState().project!
    const dep = createDependency(siblingId, taskId, 'FS', 0) // 写代码 → 写文档
    useProjectStore.setState({
      project: { ...project, dependencies: { ...project.dependencies, [dep.id]: dep } },
    })

    renderInspector()

    // 唯一的叶子候选（写代码）已经连过 → 下拉整体消失
    expect(screen.queryByRole('combobox', { name: '添加前置任务' })).not.toBeInTheDocument()
  })

  it('只有反向依赖时候选仍然保留（那是一条合法的新边）', () => {
    const project = useProjectStore.getState().project!
    const dep = createDependency(taskId, siblingId, 'FS', 0) // 写文档 → 写代码
    useProjectStore.setState({
      project: { ...project, dependencies: { ...project.dependencies, [dep.id]: dep } },
    })

    renderInspector()

    expect(screen.getByRole('combobox', { name: '添加前置任务' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '写代码', hidden: true })).toBeInTheDocument()
  })

  it('切换到 English 后标签变英文', async () => {
    await i18n.changeLanguage('en-US')
    renderInspector()

    expect(screen.getByLabelText('Name')).toBeInTheDocument()
    expect(screen.getByLabelText('Duration')).toBeInTheDocument()
    expect(screen.getByLabelText('Milestone')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Scheduling' })).toBeInTheDocument()
    expect(screen.queryByLabelText('工期')).not.toBeInTheDocument()
  })

  it('英文界面用半角冒号，中文界面用全角冒号', async () => {
    await i18n.changeLanguage('en-US')
    const { unmount } = renderInspector()

    const en = screen.getByTestId('inspector').textContent!
    expect(en).toContain('Earliest:')
    expect(en).toContain('Slack:')
    expect(en).not.toContain('：')

    unmount()
    await i18n.changeLanguage('zh-CN')
    renderInspector()

    const zh = screen.getByTestId('inspector').textContent!
    expect(zh).toContain('最早：')
    expect(zh).toContain('浮时：')
  })
})
