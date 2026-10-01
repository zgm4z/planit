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
import { solve } from '../domain/scheduler'
import { CalendarSettings } from './CalendarSettings'
import i18n from '../i18n'

let aId: string
let bId: string

function renderCalendarSettings() {
  return render(
    <MantineProvider>
      <CalendarSettings />
    </MantineProvider>,
  )
}

function calendar() {
  const project = useProjectStore.getState().project!
  return project.calendars[project.calendarId]
}

function finishOf(taskId: string): string {
  return useScheduleStore.getState().result.schedules[taskId].earlyFinish
}

beforeEach(async () => {
  __resetRegistryForTests()
  initCommands()
  __resetIdCounterForTests()
  await i18n.changeLanguage('zh-CN')

  // 2026-03-02 是周一。A(3 天)：03-02→03-04；B(2 天，FS 依赖 A)：03-05→03-06
  const project = createProject('测试', '2026-03-02')
  const a = createTask({ name: 'A', duration: 3 })
  const b = createTask({ name: 'B', duration: 2 })
  project.tasks[a.id] = a
  project.tasks[b.id] = b
  project.rootIds = [a.id, b.id]
  const dep = createDependency(a.id, b.id)
  project.dependencies[dep.id] = dep
  aId = a.id
  bId = b.id

  useProjectStore.setState({ project, undoStack: [], redoStack: [], lastError: null })
  // 手动算一次，模拟 App 的 initializeSchedules；此后 dispatch 会经由
  // scheduleStore 模块级的 subscribe 自动重算。
  useScheduleStore.setState({ result: solve(project), error: null })
})

describe('CalendarSettings', () => {
  it('渲染 7 个工作日复选框，默认周一至周五勾选', () => {
    renderCalendarSettings()

    for (const label of ['一', '二', '三', '四', '五']) {
      expect(screen.getByLabelText(label)).toBeChecked()
    }
    for (const label of ['六', '日']) {
      expect(screen.getByLabelText(label)).not.toBeChecked()
    }
  })

  it('取消勾选周五会写入日历，并触发全项目排期重算', async () => {
    const user = userEvent.setup()
    renderCalendarSettings()

    const before = finishOf(bId)
    expect(before).toBe('2026-03-06')
    // 前置条件：撤销栈为空，下面的断言才能证明命令真的走了 dispatch
    expect(useProjectStore.getState().undoStack).toHaveLength(0)

    await user.click(screen.getByLabelText('五'))

    // 1) 日历数据真的变了
    expect(calendar().workingDays[4]).toBe(false)
    // 2) 命令入栈（是一条真实、可撤销的命令）
    expect(useProjectStore.getState().undoStack).toHaveLength(1)
    // 3) 排期**真的重算了** —— B 的完成日从 03-06（周五）推到 03-09（下周一）
    expect(finishOf(bId)).toBe('2026-03-09')
    expect(finishOf(bId)).not.toBe(before)
  })

  it('日历命令没有 coalesceKey，连点两个工作日各成一条撤销记录', async () => {
    const user = userEvent.setup()
    renderCalendarSettings()

    await user.click(screen.getByLabelText('五'))
    await user.click(screen.getByLabelText('四'))

    expect(useProjectStore.getState().undoStack).toHaveLength(2)
  })

  it('添加例外日期（假日）会写入日历，且排期跳过该日', async () => {
    const user = userEvent.setup()
    renderCalendarSettings()

    // A 原本 03-02→03-04；把 03-03（周二）设为假日，A 应顺延到 03-05
    expect(finishOf(aId)).toBe('2026-03-04')

    const input = screen.getByLabelText('例外日期')
    fireEvent.change(input, { target: { value: '2026-03-03' } })
    await user.click(screen.getByRole('button', { name: '设为假日' }))

    expect(calendar().exceptions['2026-03-03']).toEqual({ kind: 'holiday' })
    expect(finishOf(aId)).toBe('2026-03-05')
    // 03-03 在列表里以「假日」呈现
    expect(screen.getByText('2026-03-03')).toBeInTheDocument()
    expect(screen.getByText('假日')).toBeInTheDocument()
  })

  it('删除例外日期会从日历与列表中移除，排期随之恢复', async () => {
    const user = userEvent.setup()
    renderCalendarSettings()

    const input = screen.getByLabelText('例外日期')
    fireEvent.change(input, { target: { value: '2026-03-03' } })
    await user.click(screen.getByRole('button', { name: '设为假日' }))
    expect(finishOf(aId)).toBe('2026-03-05')

    await user.click(screen.getByLabelText('2026-03-03'))

    expect(calendar().exceptions['2026-03-03']).toBeUndefined()
    expect(screen.queryByText('2026-03-03')).not.toBeInTheDocument()
    expect(finishOf(aId)).toBe('2026-03-04')
  })

  it('切换到 English 后工作日与日历标签变英文', async () => {
    await i18n.changeLanguage('en-US')
    renderCalendarSettings()

    expect(screen.getByText('Working days')).toBeInTheDocument()
    expect(screen.getByText('Exceptions')).toBeInTheDocument()
    expect(screen.getByLabelText('Fri')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark as holiday' })).toBeInTheDocument()
    expect(screen.queryByLabelText('五')).not.toBeInTheDocument()
  })
})
