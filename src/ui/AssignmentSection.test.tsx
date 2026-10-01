import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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
import type { Command } from '../commands/types'
import { useProjectStore } from '../store/projectStore'
import { AssignmentSection } from './AssignmentSection'
import i18n from '../i18n'

let taskId: string
let resourceId: string

/** 拦截 dispatch，把发生的命令记下来 —— 判据 6 的「断言命令的 type 与 payload 相同」 */
function spyDispatch(): Command[] {
  const captured: Command[] = []
  const original = useProjectStore.getState().dispatch
  useProjectStore.setState({
    dispatch: (command: Command) => {
      captured.push(command)
      original(command)
    },
  })
  return captured
}

beforeEach(async () => {
  __resetRegistryForTests()
  initCommands()
  __resetIdCounterForTests()
  await i18n.changeLanguage('zh-CN')

  const project = createProject('测试', '2026-03-02')
  const task = createTask({ name: '写文档', duration: 2 })
  const resource = createResource({ name: '张三' })
  const other = createResource({ name: '李四' })
  project.tasks[task.id] = task
  project.rootIds = [task.id]
  project.resources[resource.id] = resource
  project.resources[other.id] = other
  taskId = task.id
  resourceId = resource.id

  useProjectStore.setState({ project, undoStack: [], redoStack: [], lastError: null })
})

function renderSection(scope: { kind: 'task' | 'resource'; id: string }) {
  return render(
    <MantineProvider>
      <AssignmentSection scope={scope} />
    </MantineProvider>,
  )
}

describe('AssignmentSection', () => {
  it('任务视角列出该任务的分配（另一侧是资源名）', () => {
    const assignment = createAssignment({ taskId, resourceId, units: 1 })
    const project = useProjectStore.getState().project!
    useProjectStore.setState({ project: { ...project, assignments: { [assignment.id]: assignment } } })

    renderSection({ kind: 'task', id: taskId })
    expect(screen.getByText('张三')).toBeInTheDocument()
  })

  it('资源视角列出该资源的分配（另一侧是任务名）', () => {
    const assignment = createAssignment({ taskId, resourceId, units: 1 })
    const project = useProjectStore.getState().project!
    useProjectStore.setState({ project: { ...project, assignments: { [assignment.id]: assignment } } })

    renderSection({ kind: 'resource', id: resourceId })
    expect(screen.getByText('写文档')).toBeInTheDocument()
  })

  it('两处「添加」产生**同一条命令**（type 与 payload 逐字段相同）', async () => {
    const user = userEvent.setup()

    const fromTask = spyDispatch()
    renderSection({ kind: 'task', id: taskId })
    await user.click(screen.getByRole('combobox', { name: '添加资源' }))
    await user.click(screen.getByRole('option', { name: '张三', hidden: true }))
    const taskCommand = fromTask.find((command) => command.type === 'assignment.create')

    // 换一个干净项目，从资源视角做同一件事
    const fresh = createProject('测试2', '2026-03-02')
    const t2 = createTask({ name: '写文档', duration: 2 })
    const r2 = createResource({ name: '张三' })
    fresh.tasks[t2.id] = t2
    fresh.rootIds = [t2.id]
    fresh.resources[r2.id] = r2
    useProjectStore.setState({ project: fresh, undoStack: [], redoStack: [] })

    const fromResource = spyDispatch()
    renderSection({ kind: 'resource', id: r2.id })
    await user.click(screen.getByRole('combobox', { name: '添加任务' }))
    await user.click(screen.getByRole('option', { name: '写文档', hidden: true }))
    const resourceCommand = fromResource.find((command) => command.type === 'assignment.create')

    expect(taskCommand).toBeDefined()
    expect(resourceCommand).toBeDefined()
    // 同一条命令：type 相同、payload 键集合相同
    expect(resourceCommand!.type).toBe(taskCommand!.type)
    expect(Object.keys(resourceCommand!.payload as object).sort()).toEqual(
      Object.keys(taskCommand!.payload as object).sort(),
    )
    // 逐字段相同（键集合相同还不够）：两端都必须填齐 taskId + resourceId + units，
    // 且**不能把两个方向拼反** —— makePayload 一旦对调，下面两条就会红。
    expect(taskCommand!.payload).toEqual({ taskId, resourceId, units: 1 })
    expect(resourceCommand!.payload).toEqual({ taskId: t2.id, resourceId: r2.id, units: 1 })
  })

  it('删除一条分配；单元改动带含 assignmentId 的合并键', async () => {
    const user = userEvent.setup()
    const assignment = createAssignment({ taskId, resourceId, units: 0.5 })
    const project = useProjectStore.getState().project!
    useProjectStore.setState({ project: { ...project, assignments: { [assignment.id]: assignment } } })

    const captured = spyDispatch()
    renderSection({ kind: 'task', id: taskId })

    const units = screen.getByLabelText('单元 张三')
    await user.clear(units)
    await user.type(units, '1')
    const setUnits = captured.find((command) => command.type === 'assignment.setUnits')!
    expect(setUnits.coalesceKey).toBe(`assignment.setUnits:${assignment.id}`)

    await user.click(screen.getByLabelText('取消分配 张三'))
    expect(Object.values(useProjectStore.getState().project!.assignments)).toHaveLength(0)
  })

  it('已分配的另一侧从候选里消失（同向去重）', async () => {
    const user = userEvent.setup()
    renderSection({ kind: 'task', id: taskId })

    await user.click(screen.getByRole('combobox', { name: '添加资源' }))
    await user.click(screen.getByRole('option', { name: '张三', hidden: true }))
    // 张三已分配 → 候选里只剩李四
    await user.click(screen.getByRole('combobox', { name: '添加资源' }))
    expect(screen.queryByRole('option', { name: '张三', hidden: true })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: '李四', hidden: true })).toBeInTheDocument()
  })
})
