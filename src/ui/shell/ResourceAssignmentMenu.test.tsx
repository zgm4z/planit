import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'

import { initCommands, __resetRegistryForTests } from '../../commands/registry'
import {
  createAssignment, createProject, createResource, createTask, __resetIdCounterForTests,
} from '../../domain/model/factories'
import type { Command } from '../../commands/types'
import { useProjectStore } from '../../store/projectStore'
import { useViewStore, __resetViewStoreForTests } from '../../store/viewStore'
import { ResourceAssignmentMenu } from './ResourceAssignmentMenu'
import zhCN from '../../i18n/locales/zh-CN.json'
import enUS from '../../i18n/locales/en-US.json'
import jaJP from '../../i18n/locales/ja-JP.json'
import i18n from '../../i18n'

let taskIds: string[]
let groupId: string
let resourceId: string

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
  __resetViewStoreForTests()
  await i18n.changeLanguage('zh-CN')

  const project = createProject('测试', '2026-03-02')
  const t1 = createTask({ name: 'T1' })
  const t2 = createTask({ name: 'T2' })
  const parent = createTask({ name: '父任务' })
  parent.kind = 'group'
  parent.childIds = [t1.id, t2.id]
  project.tasks = { [parent.id]: parent, [t1.id]: t1, [t2.id]: t2 }
  project.rootIds = [parent.id]
  const resource = createResource({ name: '张三' })
  project.resources = { [resource.id]: resource }
  taskIds = [t1.id, t2.id]
  groupId = parent.id
  resourceId = resource.id

  useProjectStore.setState({ project, undoStack: [], redoStack: [], lastError: null })
})

function renderMenu() {
  return render(
    <MantineProvider>
      <ResourceAssignmentMenu />
    </MantineProvider>,
  )
}

describe('ResourceAssignmentMenu 禁用规则', () => {
  it('未选中任何任务 → 触发按钮禁用，且带原因', () => {
    renderMenu()
    expect(screen.getByTestId('assignment-menu-trigger')).toBeDisabled()
    expect(screen.getByTestId('assignment-menu-wrap')).toHaveAttribute('data-disabled-reason', '未选中任务')
  })

  it('选中的全是摘要任务 → 仍禁用，原因换成「均为摘要」', () => {
    useViewStore.getState().setTaskSelection([groupId])
    renderMenu()
    expect(screen.getByTestId('assignment-menu-trigger')).toBeDisabled()
    expect(screen.getByTestId('assignment-menu-wrap')).toHaveAttribute('data-disabled-reason', '选中项均为摘要任务')
  })

  it('选中一个叶子任务 → 启用', () => {
    useViewStore.getState().setTaskSelection([taskIds[0]])
    renderMenu()
    expect(screen.getByTestId('assignment-menu-trigger')).toBeEnabled()
  })

  it('选中任务被删除后 → 悬空 id 被剔除，控件回到「未选中」禁用（原因不误报为「均为摘要」）', () => {
    useViewStore.getState().setTaskSelection([taskIds[0]])
    renderMenu()
    expect(screen.getByTestId('assignment-menu-trigger')).toBeEnabled()

    const project = useProjectStore.getState().project!
    const rest = { ...project.tasks }
    delete rest[taskIds[0]]
    act(() => useProjectStore.setState({ project: { ...project, tasks: rest } }))

    expect(useViewStore.getState().selectedTaskIds).toEqual([])
    expect(screen.getByTestId('assignment-menu-trigger')).toBeDisabled()
    expect(screen.getByTestId('assignment-menu-wrap')).toHaveAttribute('data-disabled-reason', '未选中任务')
  })
})

describe('ResourceAssignmentMenu 下拉标题', () => {
  it('打开后渲染 assignmentMenu.title（该键不是死键）', async () => {
    useViewStore.getState().setTaskSelection([taskIds[0]])
    renderMenu()
    fireEvent.click(screen.getByTestId('assignment-menu-trigger'))
    expect(await screen.findByText('分配资源')).toBeInTheDocument()
  })
})

describe('ResourceAssignmentMenu 批量分配', () => {
  it('勾选 → 每个选中任务各一条 units=1.0 的 create，共用一个 coalesceKey（一条撤销记录）', async () => {
    useViewStore.getState().setTaskSelection(taskIds)
    const captured = spyDispatch()
    renderMenu()

    fireEvent.click(screen.getByTestId('assignment-menu-trigger'))
    const checkbox = await screen.findByTestId(`assignment-resource-${resourceId}`)
    fireEvent.click(checkbox)

    await waitFor(() => {
      expect(Object.keys(useProjectStore.getState().project!.assignments)).toHaveLength(2)
    })
    const creates = captured.filter((command) => command.type === 'assignment.create')
    expect(creates).toHaveLength(2)
    expect(creates.every((command) => (command.payload as { units: number }).units === 1)).toBe(true)
    expect(new Set(creates.map((command) => command.coalesceKey)).size).toBe(1)

    // 一次撤销全部回滚
    useProjectStore.getState().undo()
    expect(Object.keys(useProjectStore.getState().project!.assignments)).toHaveLength(0)
  })

  it('取消勾选 → 从全部选中任务上删除该资源', async () => {
    useViewStore.getState().setTaskSelection(taskIds)
    const project = useProjectStore.getState().project!
    const a1 = createAssignment({ taskId: taskIds[0], resourceId, units: 1 })
    const a2 = createAssignment({ taskId: taskIds[1], resourceId, units: 1 })
    useProjectStore.setState({ project: { ...project, assignments: { [a1.id]: a1, [a2.id]: a2 } } })

    renderMenu()
    fireEvent.click(screen.getByTestId('assignment-menu-trigger'))
    fireEvent.click(await screen.findByTestId(`assignment-resource-${resourceId}`))

    await waitFor(() => {
      expect(Object.keys(useProjectStore.getState().project!.assignments)).toHaveLength(0)
    })
  })

  it('「清除分配」清空全部选中任务的分配，且一次 Ctrl+Z 全恢复', async () => {
    useViewStore.getState().setTaskSelection(taskIds)
    const project = useProjectStore.getState().project!
    const a1 = createAssignment({ taskId: taskIds[0], resourceId, units: 1 })
    useProjectStore.setState({ project: { ...project, assignments: { [a1.id]: a1 } } })

    renderMenu()
    fireEvent.click(screen.getByTestId('assignment-menu-trigger'))
    fireEvent.click(await screen.findByTestId('assignment-clear'))

    await waitFor(() => {
      expect(Object.keys(useProjectStore.getState().project!.assignments)).toHaveLength(0)
    })
    expect(useProjectStore.getState().undoStack).toHaveLength(1)

    useProjectStore.getState().undo()
    expect(Object.keys(useProjectStore.getState().project!.assignments)).toHaveLength(1)
  })
})

/**
 * 三语叶子键集合相等 —— 与 `Toolbar.test.tsx` / `inspectorGroups.test.ts` 同款守卫。
 */
function leafKeys(node: unknown, prefix = ''): string[] {
  if (node === null || typeof node !== 'object') return [prefix]
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    leafKeys(value, prefix ? `${prefix}.${key}` : key),
  )
}

describe('新增文案的三语叶子键集合', () => {
  it('zh / en / ja 在 menu.reason 与 assignmentMenu 上完全相等', () => {
    const zhMenu = leafKeys(zhCN.menu.reason, 'menu.reason').sort()
    expect(leafKeys(enUS.menu.reason, 'menu.reason').sort()).toEqual(zhMenu)
    expect(leafKeys(jaJP.menu.reason, 'menu.reason').sort()).toEqual(zhMenu)

    const zhAssign = leafKeys(zhCN.assignmentMenu, 'assignmentMenu').sort()
    expect(leafKeys(enUS.assignmentMenu, 'assignmentMenu').sort()).toEqual(zhAssign)
    expect(leafKeys(jaJP.assignmentMenu, 'assignmentMenu').sort()).toEqual(zhAssign)
  })
})
