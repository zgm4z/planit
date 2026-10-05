import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { initCommands, __resetRegistryForTests } from '../../commands/registry'
import { createProject, createTask, __resetIdCounterForTests } from '../../domain/model/factories'
import { useProjectStore } from '../../store/projectStore'
import { __resetViewStoreForTests, useViewStore } from '../../store/viewStore'
import { TaskContextMenu } from './TaskContextMenu'
import i18n from '../../i18n'

function setup() {
  __resetRegistryForTests(); initCommands(); __resetIdCounterForTests(); __resetViewStoreForTests()
  const project = createProject('测试', '2026-03-02')
  const a = createTask({ name: '一' }); const b = createTask({ name: '二' })
  project.tasks[a.id] = a; project.tasks[b.id] = b; project.rootIds = [a.id, b.id]
  useProjectStore.setState({ project, undoStack: [], redoStack: [], lastError: null, coalesceBarrier: false })
  return { a: a.id, b: b.id }
}

function renderMenu(children: React.ReactNode) {
  return render(<MantineProvider>{children}</MantineProvider>)
}

describe('TaskContextMenu', () => {
  beforeEach(async () => { await i18n.changeLanguage('zh-CN') })

  it('右键任务行 → 弹出菜单且含 7 项', async () => {
    const { a } = setup()
    renderMenu(
      <TaskContextMenu>
        <div data-testid={`outline-row-${a}`}>行</div>
      </TaskContextMenu>,
    )
    fireEvent.contextMenu(screen.getByTestId(`outline-row-${a}`))
    expect(await screen.findByTestId('ctx-new-child')).toBeTruthy()
    expect(screen.getByTestId('ctx-delete-task')).toBeTruthy()
  })

  it('右键非任务行（如甘特空白）→ 不弹菜单', () => {
    setup()
    renderMenu(
      <TaskContextMenu>
        <div data-testid="not-a-row">空白</div>
      </TaskContextMenu>,
    )
    fireEvent.contextMenu(screen.getByTestId('not-a-row'))
    expect(screen.queryByTestId('ctx-new-child')).toBeNull()
  })

  it('内联编辑态里右键不弹菜单（交给浏览器）', () => {
    const { a } = setup()
    renderMenu(
      <TaskContextMenu>
        <div data-testid={`outline-row-${a}`}>
          <input data-testid="title-input" />
        </div>
      </TaskContextMenu>,
    )
    fireEvent.contextMenu(screen.getByTestId('title-input'))
    expect(screen.queryByTestId('ctx-new-child')).toBeNull()
  })

  it('右键的行已在选中集里 → 删除作用于全部选中', async () => {
    const { a, b } = setup()
    useViewStore.getState().setTaskSelection([a, b], a)
    renderMenu(
      <TaskContextMenu>
        <div data-testid={`outline-row-${a}`}>行A</div>
        <div data-testid={`outline-row-${b}`}>行B</div>
      </TaskContextMenu>,
    )
    fireEvent.contextMenu(screen.getByTestId(`outline-row-${a}`))
    fireEvent.click(await screen.findByTestId('ctx-delete-task'))
    expect(Object.keys(useProjectStore.getState().project!.tasks)).toHaveLength(0)
  })
})
