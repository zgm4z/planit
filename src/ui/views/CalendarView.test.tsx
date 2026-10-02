import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { DatesProvider } from '@mantine/dates'

import zhCN from '../../i18n/locales/zh-CN.json'
import enUS from '../../i18n/locales/en-US.json'
import jaJP from '../../i18n/locales/ja-JP.json'
import { initCommands, __resetRegistryForTests } from '../../commands/registry'
import {
  createDependency,
  createProject,
  createTask,
  __resetIdCounterForTests,
} from '../../domain/model/factories'
import { useProjectStore } from '../../store/projectStore'
import { useScheduleStore } from '../../store/scheduleStore'
import { solve } from '../../domain/scheduler'
import { CalendarView } from './CalendarView'
import i18n from '../../i18n'

function renderView() {
  // 日历网格换成 Mantine `Calendar` 后，月份名 / 星期名与日历计算由 dayjs 提供，
  // 必须套 `DatesProvider`（与 `App.tsx` 的接线一致：周一起始、中文 locale）。
  return render(
    <MantineProvider>
      <DatesProvider settings={{ locale: 'zh-cn', firstDayOfWeek: 1 }}>
        <CalendarView />
      </DatesProvider>
    </MantineProvider>,
  )
}

const exceptions = () => useProjectStore.getState().project!.calendars.default.exceptions
const calendar = () => useProjectStore.getState().project!.calendars.default

/**
 * 从「今天所在月」回到夹具的 2026-03 需要翻多少个月。
 * 区间例外的两个控件是**局部状态**（初始为空），空值 DateTimePicker 打开的是今天
 * 所在月 —— 故这里按真实时钟算差值再翻月，断言值（2026-03-*）与时钟无关。
 */
const MONTHS_BACK_TO_FIXTURE_MONTH = (() => {
  const now = new Date()
  return now.getFullYear() * 12 + now.getMonth() - (2026 * 12 + 2)
})()

/**
 * 打开 `DateTimePicker` 浮层，翻到 2026-03，点选该月的某一天。
 * Mantine 9 的 `DateTimePicker` 是打开浮层的 `<button>`（`valueFormat` 只管显示），
 * 对按钮派发 change 无效 —— 必须点开日历再点日格。
 */
async function pickDayInMarch2026(handle: HTMLElement, day: number): Promise<void> {
  fireEvent.click(handle)
  // 按 aria-controls 精确定位**本控件**的浮层（两个控件可能同时开着）
  const dropdown = await waitFor(() => {
    const id = handle.getAttribute('aria-controls')
    const el = id ? document.getElementById(id) : null
    if (!el) throw new Error('date picker dropdown did not open')
    return el
  })
  for (let i = 0; i < MONTHS_BACK_TO_FIXTURE_MONTH; i += 1) {
    const prev = dropdown.querySelector('button[data-direction="previous"]')
    if (!prev) throw new Error('prev-month control not found')
    fireEvent.click(prev)
  }
  // 排除相邻月的「补白日」（data-outside），否则点 25 可能命中 2 月 25 日
  const cell = Array.from(dropdown.querySelectorAll('table button')).find(
    (button) => button.textContent === String(day) && !button.hasAttribute('data-outside'),
  )
  if (!cell) throw new Error(`day cell ${day} not found in 2026-03`)
  fireEvent.click(cell)
}

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

  it('按区间添加「假日」→ 逐日条目；列表聚合成一条区间；一次 dispatch 一条命令', async () => {
    renderView()
    const undoBefore = useProjectStore.getState().undoStack.length

    await pickDayInMarch2026(screen.getByTestId('calendar-range-start'), 16)
    await pickDayInMarch2026(screen.getByTestId('calendar-range-end'), 20)
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

  it('删除一条区间例外 → 区间内每一天都被清掉', async () => {
    renderView()
    await pickDayInMarch2026(screen.getByTestId('calendar-range-start'), 16)
    await pickDayInMarch2026(screen.getByTestId('calendar-range-end'), 17)
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

/**
 * 判据 7：日历月网格的三态（工作日 / 非工作日 / 例外日）。
 *
 * 断言的是**日格上的 `data-*`**（e2e 与后续用例靠它识别三态），不是 CSS 类 ——
 * 类名经 CSS Modules 哈希后不可断言，且「有类」不等于「看得见」。
 * 三态两两可分辨：`custom` 落在工作日上时 `data-workday` 仍为 true，只靠 isWorkday
 * 判色就看不出它是例外（第三态），故必须另有 `data-exception`。
 */
describe('月网格三态（工作日 / 非工作日 / 例外日）', () => {
  it('每个日格的 data-workday / data-exception 与手算一致', () => {
    renderView()
    // 2026-03-02 是周一（工作日）
    expect(screen.getByTestId('calendar-day-2026-03-02')).toHaveAttribute('data-workday', 'true')
    expect(screen.getByTestId('calendar-day-2026-03-02')).not.toHaveAttribute('data-exception')
    // 2026-03-07 是周六（非工作日）
    expect(screen.getByTestId('calendar-day-2026-03-07')).toHaveAttribute('data-workday', 'false')
  })

  it('custom 落在工作日上：data-workday 仍为 true，但 data-exception 为 custom（第三态）', () => {
    const project = useProjectStore.getState().project!
    project.calendars.default.exceptions['2026-03-04'] = {
      kind: 'custom', start: '2026-03-04T09:00', end: '2026-03-04T18:00',
    }
    useProjectStore.setState({ project: { ...project } })
    renderView()
    const cell = screen.getByTestId('calendar-day-2026-03-04')
    expect(cell).toHaveAttribute('data-workday', 'true')
    expect(cell).toHaveAttribute('data-exception', 'custom')
  })

  it('holiday 落在工作日上：data-workday 变 false 且 data-exception 为 holiday', () => {
    const project = useProjectStore.getState().project!
    project.calendars.default.exceptions['2026-03-05'] = { kind: 'holiday' }
    useProjectStore.setState({ project: { ...project } })
    renderView()
    const cell = screen.getByTestId('calendar-day-2026-03-05')
    expect(cell).toHaveAttribute('data-workday', 'false')
    expect(cell).toHaveAttribute('data-exception', 'holiday')
  })
})

/**
 * 承接已删的 `CalendarSettings.test.tsx`：那两条用例断言的不只是「日历写回」，
 * 还有**全项目排期真的因此重算**与**命令真的入撤销栈** —— 这是最容易在搬家中丢掉的
 * 判别力（只断言 workingDays 变了，写成不 dispatch 的本地 state 也会通过）。
 * 2026-03-02 是周一；A(3 天) 03-02→03-04，B(2 天，FS 依赖 A) 03-05→03-06。
 */
describe('日历编辑驱动排期（承接已删的 CalendarSettings 用例）', () => {
  function fixtureWithDependency() {
    const project = createProject('日历重排', '2026-03-02')
    const a = createTask({ name: 'A', duration: 3 })
    const b = createTask({ name: 'B', duration: 2 })
    project.tasks[a.id] = a
    project.tasks[b.id] = b
    project.rootIds = [a.id, b.id]
    const dep = createDependency(a.id, b.id)
    project.dependencies[dep.id] = dep
    useProjectStore.setState({ project, undoStack: [], redoStack: [], lastError: null })
    useScheduleStore.setState({ result: solve(project), error: null })
    return { aId: a.id, bId: b.id }
  }

  const finishOf = (taskId: string) =>
    useScheduleStore.getState().result.schedules[taskId].earlyFinish

  it('取消勾选「周五」→ 命令入栈一条，且 B 的完成日推到下周一', () => {
    const { bId } = fixtureWithDependency()
    renderView()

    expect(finishOf(bId)).toBe('2026-03-06')
    expect(useProjectStore.getState().undoStack).toHaveLength(0)

    fireEvent.click(within(screen.getByTestId('calendar-settings')).getAllByRole('checkbox')[4])

    expect(calendar().workingDays[4]).toBe(false)
    expect(useProjectStore.getState().undoStack).toHaveLength(1) // 一条真实可撤销的命令
    expect(finishOf(bId)).toBe('2026-03-09') // 排期**真的**重算了
  })

  it('把 03-03 设为假日 → 排期跳过该日，A 顺延到 03-05', async () => {
    const { aId } = fixtureWithDependency()
    renderView()

    expect(finishOf(aId)).toBe('2026-03-04')

    await pickDayInMarch2026(screen.getByTestId('calendar-range-start'), 3)
    fireEvent.click(screen.getByTestId('calendar-range-submit'))

    expect(exceptions()['2026-03-03']).toEqual({ kind: 'holiday' })
    expect(finishOf(aId)).toBe('2026-03-05')
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
