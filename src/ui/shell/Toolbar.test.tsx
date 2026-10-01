import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'

import { createProject, __resetIdCounterForTests } from '../../domain/model/factories'
import { initCommands, __resetRegistryForTests } from '../../commands/registry'
import { useProjectStore } from '../../store/projectStore'
import { __resetViewStoreForTests } from '../../store/viewStore'
import { Toolbar } from './Toolbar'
import i18n from '../../i18n'

function renderToolbar() {
  return render(
    <MantineProvider>
      <Toolbar />
    </MantineProvider>,
  )
}

/** 在 document.body 上按下 Ctrl/Cmd+Z（可选 Shift）—— 事件冒泡到 window 的监听器 */
function pressUndoKey({ shift = false } = {}) {
  fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true, shiftKey: shift })
}

beforeEach(async () => {
  __resetRegistryForTests()
  initCommands()
  __resetIdCounterForTests()
  await i18n.changeLanguage('zh-CN')
  __resetViewStoreForTests()
  useProjectStore.setState({
    project: createProject('测试项目', '2026-03-02'),
    undoStack: [],
    redoStack: [],
    lastError: null,
  })
})

describe('TopBar 的形态（§10.1）', () => {
  it('菜单栏与项目名都在，但 ＋ / 缩进 / 撤销 不再是常驻图标按钮', () => {
    renderToolbar()

    expect(screen.getByTestId('menubar')).toBeInTheDocument()
    expect(screen.getByTestId('back-to-list')).toBeInTheDocument()
    expect(screen.getByText('测试项目')).toBeInTheDocument()

    // 操作已进菜单：未展开菜单时，这些 testid 一个都不在 DOM 里（不是被隐藏，是根本没渲染）
    for (const testId of ['new-task', 'indent', 'outdent', 'undo', 'redo']) {
      expect(screen.queryByTestId(testId)).not.toBeInTheDocument()
    }
  })
})

describe('撤销 / 重做的键盘快捷键', () => {
  it('Ctrl+Z 撤销、Ctrl+Shift+Z 重做', () => {
    renderToolbar()
    const dispatch = useProjectStore.getState().dispatch

    dispatch({ type: 'task.create', label: 'commands.task.create', payload: { name: '一' } })
    dispatch({ type: 'task.create', label: 'commands.task.create', payload: { name: '二' } })
    expect(useProjectStore.getState().undoStack).toHaveLength(2)

    pressUndoKey()
    expect(useProjectStore.getState().undoStack).toHaveLength(1)

    pressUndoKey({ shift: true })
    expect(useProjectStore.getState().undoStack).toHaveLength(2)
  })

  it('焦点在输入框里时不抢 Ctrl+Z —— 让输入框自己撤销文本', () => {
    renderToolbar()
    useProjectStore
      .getState()
      .dispatch({ type: 'task.create', label: 'commands.task.create', payload: { name: '一' } })

    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    fireEvent.keyDown(input, { key: 'z', ctrlKey: true })

    // 一条历史都不该被这个按键吃掉
    expect(useProjectStore.getState().undoStack).toHaveLength(1)
    input.remove()
  })
})
