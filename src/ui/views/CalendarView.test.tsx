import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'

import zhCN from '../../i18n/locales/zh-CN.json'
import enUS from '../../i18n/locales/en-US.json'
import jaJP from '../../i18n/locales/ja-JP.json'
import { initCommands, __resetRegistryForTests } from '../../commands/registry'
import { createProject, __resetIdCounterForTests } from '../../domain/model/factories'
import { useProjectStore } from '../../store/projectStore'
import { useScheduleStore } from '../../store/scheduleStore'
import { solve } from '../../domain/scheduler'
import { CalendarView } from './CalendarView'
import i18n from '../../i18n'

function renderView() {
  return render(
    <MantineProvider>
      <CalendarView />
    </MantineProvider>,
  )
}

const exceptions = () => useProjectStore.getState().project!.calendars.default.exceptions
const calendar = () => useProjectStore.getState().project!.calendars.default

beforeEach(async () => {
  __resetRegistryForTests()
  initCommands()
  __resetIdCounterForTests()
  await i18n.changeLanguage('zh-CN')
  const project = createProject('日历', '2026-03-02')
  useProjectStore.setState({ project, undoStack: [], redoStack: [], lastError: null })
  useScheduleStore.setState({ result: solve(project), error: null })
})

describe('日历视图（视图 A）', () => {
  it('渲染月网格：本月每一天都有一格，且有 7 个工作日复选框（复用 calendar-settings）', () => {
    renderView()
    expect(screen.getByTestId('calendar-month-grid')).toBeInTheDocument()
    expect(screen.getByTestId('calendar-day-2026-03-02')).toBeInTheDocument()
    expect(screen.getByTestId('calendar-day-2026-03-31')).toBeInTheDocument()
    const block = screen.getByTestId('calendar-settings')
    expect(within(block).getAllByRole('checkbox')).toHaveLength(7)
  })

  it('取消勾选「周五」→ calendar.setWorkingDays 生效', () => {
    renderView()
    // 按索引定位（第 5 个，0-based = 4），不复用语言
    fireEvent.click(within(screen.getByTestId('calendar-settings')).getAllByRole('checkbox')[4])
    expect(calendar().workingDays).toEqual([true, true, true, true, false, false, false])
  })

  it('按区间添加「假日」→ 逐日条目；列表聚合成一条区间；一次 dispatch 一条命令', () => {
    renderView()
    const undoBefore = useProjectStore.getState().undoStack.length

    fireEvent.change(screen.getByTestId('calendar-range-start'), { target: { value: '2026-03-16' } })
    fireEvent.change(screen.getByTestId('calendar-range-end'), { target: { value: '2026-03-20' } })
    fireEvent.click(screen.getByTestId('calendar-range-submit'))

    expect(Object.keys(exceptions()).sort()).toEqual([
      '2026-03-16', '2026-03-17', '2026-03-18', '2026-03-19', '2026-03-20',
    ])
    expect(exceptions()['2026-03-17']).toEqual({ kind: 'holiday' })
    // 一次 dispatch = 一条撤销记录（不是 5 条）
    expect(useProjectStore.getState().undoStack.length).toBe(undoBefore + 1)
    // 列表把连续 5 天显示为**一条**
    expect(screen.getAllByTestId(/^calendar-exception-row-/)).toHaveLength(1)
    expect(screen.getByTestId('calendar-exception-row-2026-03-16')).toHaveTextContent('2026-03-16 → 2026-03-20')
  })

  it('删除一条区间例外 → 区间内每一天都被清掉', () => {
    renderView()
    fireEvent.change(screen.getByTestId('calendar-range-start'), { target: { value: '2026-03-16' } })
    fireEvent.change(screen.getByTestId('calendar-range-end'), { target: { value: '2026-03-17' } })
    fireEvent.click(screen.getByTestId('calendar-range-submit'))

    fireEvent.click(screen.getByTestId('calendar-exception-remove-2026-03-16'))
    expect(exceptions()).toEqual({})
  })

  it('没有例外时给说明性文字（不是空白）', () => {
    renderView()
    expect(screen.getByTestId('calendar-exception-list')).toHaveTextContent('还没有例外日期。')
  })

  it('「正常时数」编辑每日工时 → calendar.hoursPerDay 生效', () => {
    renderView()
    fireEvent.change(screen.getByTestId('calendar-hours-per-day'), { target: { value: '6' } })
    expect(calendar().hoursPerDay).toBe(6)
  })
})

/** 三语叶子键集合相等 —— 与 inspectorGroups.test.ts / outlineColumns.test.ts 同款守卫 */
function leafKeys(node: unknown, prefix = ''): string[] {
  if (node === null || typeof node !== 'object') return [prefix]
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    leafKeys(value, prefix ? `${prefix}.${key}` : key),
  )
}

describe('calendarView 块的三语叶子键集合', () => {
  it('zh / en / ja 完全相等（缺一个翻译就红）', () => {
    const zh = leafKeys(zhCN.calendarView, 'calendarView').sort()
    expect(leafKeys(enUS.calendarView, 'calendarView').sort()).toEqual(zh)
    expect(leafKeys(jaJP.calendarView, 'calendarView').sort()).toEqual(zh)
  })
})
