import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'

import { initCommands, __resetRegistryForTests } from '../../commands/registry'
import { createProject, createTask, __resetIdCounterForTests } from '../../domain/model/factories'
import type { ComputedSchedule, Project } from '../../domain/model/types'
import { useProjectStore } from '../../store/projectStore'
import { OUTLINE_CELL_EDITORS } from './outlineCellEditors'
import type { OutlineColumnKey } from '../../store/columnKeys'
import { EditableCell } from './EditableCell'
import i18n from '../../i18n'

let project: Project
let taskId: string

function schedule(start: string, finish: string): ComputedSchedule {
  return {
    earlyStart: start, earlyFinish: finish, lateStart: start, lateFinish: finish,
    scheduledStart: start, scheduledFinish: finish, totalSlack: 0, freeSlack: 0, isCritical: true,
  }
}

function renderCell(columnKey: OutlineColumnKey, sched: ComputedSchedule | undefined) {
  const task = useProjectStore.getState().project!.tasks[taskId]
  return render(
    <MantineProvider>
      <EditableCell
        columnKey={columnKey}
        spec={OUTLINE_CELL_EDITORS[columnKey]!}
        task={task}
        schedule={sched}
        displayTestId={`cell-${columnKey}`}
        inputTestId={`cell-${columnKey}-input`}
      >
        <span>display</span>
      </EditableCell>
    </MantineProvider>,
  )
}

beforeEach(async () => {
  __resetRegistryForTests()
  initCommands()
  __resetIdCounterForTests()
  await i18n.changeLanguage('zh-CN')

  project = createProject('测试', '2026-03-02')
  const task = createTask({ name: '写文档', duration: 3 })
  project.tasks[task.id] = task
  project.rootIds = [task.id]
  taskId = task.id

  useProjectStore.setState({
    project, undoStack: [], redoStack: [], lastError: null, coalesceBarrier: false,
  })
})

describe('EditableCell', () => {
  it('文本：双击进编辑，回车提交 task.setNote', async () => {
    const user = userEvent.setup()
    renderCell('note', undefined)

    await user.dblClick(screen.getByTestId('cell-note'))
    await user.type(screen.getByTestId('cell-note-input'), '备注{Enter}')

    expect(useProjectStore.getState().project!.tasks[taskId].note).toBe('备注')
    expect(screen.getByTestId('cell-note')).toBeInTheDocument()
  })

  it('数字：越界交命令层归一（progress 输 150 → 100）', async () => {
    const user = userEvent.setup()
    renderCell('progress', schedule('2026-03-04', '2026-03-06'))

    await user.dblClick(screen.getByTestId('cell-progress'))
    const input = screen.getByTestId('cell-progress-input')
    await user.clear(input)
    await user.type(input, '150{Enter}')

    expect(useProjectStore.getState().project!.tasks[taskId].progress).toBe(100)
  })

  it('数字：非法输入不提交、保留编辑态、aria-invalid、store 与撤销栈不变', async () => {
    const user = userEvent.setup()
    renderCell('progress', schedule('2026-03-04', '2026-03-06'))

    await user.dblClick(screen.getByTestId('cell-progress'))
    const input = screen.getByTestId('cell-progress-input')
    await user.clear(input)
    await user.type(input, 'abc')
    fireEvent.keyDown(input, { key: 'Enter' })

    // 仍在编辑态
    expect(screen.getByTestId('cell-progress-input')).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    // 未派发
    expect(useProjectStore.getState().project!.tasks[taskId].progress).toBe(0)
    expect(useProjectStore.getState().undoStack).toHaveLength(0)
  })

  it('日期：选日期提交 task.moveTo，任务落 manual 且起点 = 所选日', async () => {
    const user = userEvent.setup()
    renderCell('start', schedule('2026-03-04', '2026-03-06'))

    await user.dblClick(screen.getByTestId('cell-start'))
    const input = screen.getByTestId('cell-start-input')
    await user.clear(input)
    await user.type(input, '2026-03-05')
    fireEvent.keyDown(input, { key: 'Enter' })

    const task = useProjectStore.getState().project!.tasks[taskId]
    expect(task.scheduling.mode).toBe('manual')
    expect(task.scheduling.mode === 'manual' && task.scheduling.start).toBe('2026-03-05')
  })

  it('Escape 取消：不派发、store 不变', async () => {
    const user = userEvent.setup()
    renderCell('note', undefined)

    await user.dblClick(screen.getByTestId('cell-note'))
    await user.type(screen.getByTestId('cell-note-input'), '不要的{Escape}')

    expect(screen.getByTestId('cell-note')).toBeInTheDocument()
    expect(useProjectStore.getState().project!.tasks[taskId].note).toBe('')
  })
})
