import { memo, useState } from 'react'
import { Button, Checkbox, NumberInput, Select, Text } from '@mantine/core'
import { Calendar, DatePickerInput } from '@mantine/dates'
import { IconTrash } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

import type { DateStr } from '../../domain/model/types'
import { isWorkday } from '../../domain/calendar/workdays'
import { createCalendar } from '../../domain/model/factories'
import { toDateStr } from '../../domain/calendar/dateTime'
import { useProjectStore } from '../../store/projectStore'
import { shiftMonth } from '../shared/calendarGrid'
import { groupExceptions } from '../shared/groupExceptions'
import { formatDate } from '../shared/format'
import { WEEKDAY_KEYS } from '../shared/normalHours'
import { NormalHoursGrid } from './NormalHoursGrid'
import styles from '../styles/ProjectView.module.scss'
// 区块类（blockTitle / weekdays / exceptionRow / exceptionDate / exceptionKind）原来由
// CalendarSettings 用 Chrome.module.scss 提供，这里原样复用，避免两处各写一份样式。
import chrome from '../styles/Chrome.module.scss'

/**
 * 视图 A：项目日历（spec §5）。
 *
 * 布局（判断点 1 的落点）：**左栏**放「时间」本身 —— 月网格 + 正常时数网格（含它的
 * 编辑控件）；**右栏**（280px 固定）放「例外」—— 自定义日列表与添加表单。左=周期规则、
 * 右=具体日期，是同一种划分。原先「正常时数」的复选框与每日工时输入在右栏，本次随
 * 网格一起搬到左栏网格旁（硬约束：编辑控件必须留在网格旁边）。
 *
 * 「正常时数」区块**保留 `data-testid="calendar-settings"`** 并承载那七个工作日复选框 ——
 * 既有 e2e（regression / acceptance）靠它定位复选组，保留可让它们只改「怎么到达日历」。
 * 按区间增删例外走 v0.7 的两条区间命令（命令层逐日展开，见 spec §4.2）。
 *
 * ── 为什么是 memo ────────────────────────────────────────────────────────
 * 本视图不收任何 props（数据走 zustand），但挂在 ProjectView 的滚动容器里 ——
 * 虚拟化器让 ProjectView 每帧重渲染时，这里没有任何输入变化。memo 让它在滚动帧里
 * 整棵跳过；月锚点等本地 state 与 store 订阅仍照常驱动更新。
 */
function CalendarViewComponent() {
  const { t } = useTranslation()
  const project = useProjectStore((state) => state.project)
  const dispatch = useProjectStore((state) => state.dispatch)

  // 月网格锚点：**项目起始月**（不是硬编码的某一月）。
  // 此前写死 '2026-03-01'，真实项目（起始 2026-09）打开日历显示的是与项目无关的 3 月。
  // 进视图时按项目起始日期定月；左右翻月仍由 calendar-prev/next-month 调整。
  // CalendarView 随 activeView 切换而挂载/卸载，故 anchor 每次进入都回到起始月。
  // 月锚点只取「年月」：先归一掉时刻再切片（带时刻串 `'…T09:00'.slice(0, 7)` 恰好仍得
  // `'YYYY-MM'`，但那是巧合 —— 归一后语义明确，且 Task 3 起 project.startDate 会带时刻）。
  const [anchor, setAnchor] = useState<DateStr>(
    () => `${toDateStr(project?.startDate ?? '2026-01-01').slice(0, 7)}-01`,
  )
  const [rangeStart, setRangeStart] = useState('')
  const [rangeEnd, setRangeEnd] = useState('')
  const [kind, setKind] = useState<'holiday' | 'custom'>('holiday')

  if (!project) return null

  const calendar = project.calendars[project.calendarId] ?? createCalendar()
  const ranges = groupExceptions(calendar.exceptions)

  const addException = () => {
    if (!rangeStart) return
    dispatch({
      type: 'calendar.addExceptionRange',
      label: 'commands.calendar.addExceptionRange',
      payload: {
        calendarId: calendar.id,
        start: rangeStart,
        end: rangeEnd || rangeStart,
        kind,
      },
    })
    setRangeStart('')
    setRangeEnd('')
  }

  return (
    <div className={styles.calendarView} data-testid="calendar-view">
      <section className={styles.calendarLeft}>
        <div className={styles.calendarNav}>
          <Button size="compact-xs" variant="subtle" data-testid="calendar-prev-month"
            onClick={() => setAnchor(shiftMonth(anchor, -1))}>
            {t('calendarView.prevMonth')}
          </Button>
          <Text fz="sm" fw={600}>{anchor.slice(0, 7)}</Text>
          <Button size="compact-xs" variant="subtle" data-testid="calendar-next-month"
            onClick={() => setAnchor(shiftMonth(anchor, 1))}>
            {t('calendarView.nextMonth')}
          </Button>
        </div>

        {/* 月网格改用 Mantine 的 `Calendar`（spec §6.1）：月份状态由 `anchor` 驱动。
            三态仍是 v0.7 的三态（工作日 / 非工作日 / 例外日），但保住它们的方式变了：
            - **配色**走 `getDayProps` 的 `className`（合法字段，落到日格 `<button>` 上）；
            - **`data-*`** 走 `renderDay` 返回的 `<span>`（见下方注释：回调给的是
              `DateStringValue`，不是 Date）。e2e 与单测都在这两个 `data-*` 上断言三态。
            `firstDayOfWeek={1}` 与 `Calendar.workingDays` 的「周一是索引 0」一致；
            `hideOutsideDates` 让相邻月的补白日整格隐藏（旧网格的补白由 `monthMatrix` 给）。 */}
        <div data-testid="calendar-month-grid">
          <Calendar
            date={anchor}
            onDateChange={(date) => {
              // Mantine 9.6.3 的 `onDateChange?: (date: DateStringValue) => void`
              // （`DateStringValue = string`，见 node_modules 源码）——已在读源码时确认，
              // 不是早期文档里的 `Date`。只改「显示哪个月」，不写 store：
              // 日格本身没有选中语义，与 v0.7 的手写网格一致。
              setAnchor(toDateStr(date))
            }}
            firstDayOfWeek={1}
            hideOutsideDates
            // 月网格撑满 `.calendarLeft` 的可用宽度（Mantine `Calendar` 的 `fullWidth`）。
            // 不加时 `Calendar` 按内容宽度（7 × --day-size ≈ 266px）缩在左半边，
            // 右侧留一大片空白 —— 而左栏是 `flex: 1 1 auto`，本就该把这段宽度用起来。
            // 实现走 Mantine 内建：`data-full-width` 让根 `width:100%`、月份表 `width:100%`、
            // 每个日格 `width:100%; aspect-ratio:1`（见 node_modules 的 dates/styles.css），
            // 故日格随容器等比放大、保持正方形 —— 三态的底色与角标跟着整格放大，不会被压坏。
            fullWidth
            getDayProps={(date) => {
              const iso = toDateStr(date)
              const workday = isWorkday(iso, calendar)
              const exception = calendar.exceptions[iso]
              return {
                className: `${workday ? '' : styles.calendarDayOff} ${
                  exception ? styles.calendarDayException : ''
                }`,
              }
            }}
            renderDay={(date) => {
              const iso = toDateStr(date)
              const workday = isWorkday(iso, calendar)
              // 第三态：这一天是不是一条**例外**（日历里有它的条目）。
              // 例外日与「非工作日」是两回事 —— 一个 custom 落在工作日上时 isWorkday 仍为 true，
              // 只按 isWorkday 上色就看不出来（spec §5 要求三态：工作日 / 非工作日 / 例外日）。
              const exception = calendar.exceptions[iso]
              return (
                <span
                  data-testid={`calendar-day-${iso}`}
                  data-workday={workday ? 'true' : 'false'}
                  // 例外日的第三态身份挂在 data 上，供 e2e / 单测断言（视觉上靠角标，不引入新色相）；
                  // 非例外日**不挂**该属性（`toHaveAttribute` 的缺席断言因此有判别力）。
                  {...(exception ? { 'data-exception': exception.kind } : {})}
                >
                  {iso.slice(8)}
                </span>
              )
            }}
          />
        </div>

        {/* 保留 calendar-normal-hours-title 文案 testid（e2e 用它断言「文案跟随语言」）。
            区块内容 = **只读网格** + 它的编辑控件。网格本身一格都不可点（模型没有时刻，
            点了没反应 —— 见 NormalHoursGrid 的注释）；能改的仍是右面那七个复选框与
            每日工时输入 —— 网格是它们的投影。 */}
        <Text
          className={`${chrome.blockTitle} ${styles.normalHoursTitle}`}
          data-testid="calendar-normal-hours-title"
        >
          {t('calendarView.normalHours')}
        </Text>
        <div className={styles.normalHours}>
          <NormalHoursGrid calendar={calendar} />

          <div className={styles.normalHoursControls}>
            {/* 说明性文字（§3.3「未配置给原因」的同类做法）：点明这是只读投影，
                免得用户对着网格找编辑入口。它同时解释了绿块从哪来。 */}
            <Text className={styles.normalHoursHint}>{t('calendarView.normalHoursHint')}</Text>

            {/* 保留 calendar-settings 这个 testid：既有 e2e 靠它定位七个工作日复选框。
                WEEKDAY_KEYS 的顺序即 workingDays 的索引序（周一打头）—— 与网格横轴同源。 */}
            <div className={chrome.weekdays} data-testid="calendar-settings">
              {WEEKDAY_KEYS.map((key, index) => (
                <Checkbox
                  key={key}
                  size="xs"
                  label={t(`calendar.weekdays.${key}`)}
                  checked={calendar.workingDays[index]}
                  onChange={(event) => {
                    const next = [...calendar.workingDays] as typeof calendar.workingDays
                    next[index] = event.currentTarget.checked
                    dispatch({
                      type: 'calendar.setWorkingDays',
                      label: 'commands.calendar.setWorkingDays',
                      payload: { calendarId: calendar.id, workingDays: next },
                    })
                  }}
                />
              ))}
            </div>

            <Text className={chrome.blockTitle}>{t('calendarView.hoursPerDay')}</Text>
            <NumberInput
              size="xs"
              min={1}
              className={styles.hoursPerDayInput}
              data-testid="calendar-hours-per-day"
              value={calendar.hoursPerDay}
              onChange={(value) =>
                dispatch({
                  type: 'calendar.setHoursPerDay',
                  label: 'commands.calendar.setHoursPerDay',
                  payload: { hoursPerDay: Number(value) || 1 },
                })
              }
            />
          </div>
        </div>
      </section>

      {/* 右栏（280px）：具体的「例外日期」—— 列表 + 添加表单。
          与左栏的「周期规则」（哪些天上班 / 每天几小时）分开：一个是模板，一个是特例。 */}
      <section className={styles.calendarRight}>
        <Text className={chrome.blockTitle}>{t('calendarView.customDays')}</Text>
        <div className={styles.calendarExceptionList} data-testid="calendar-exception-list">
          {ranges.length === 0 ? (
            <Text fz="xs" c="dimmed">{t('calendarView.noExceptions')}</Text>
          ) : (
            ranges.map((range) => (
              <div key={range.start} className={chrome.exceptionRow} data-testid={`calendar-exception-row-${range.start}`}>
                <Text className={chrome.exceptionDate}>
                  {range.start === range.end
                    ? formatDate(range.start)
                    : `${formatDate(range.start)} → ${formatDate(range.end)}`}
                </Text>
                <Text className={chrome.exceptionKind}>
                  {range.kind === 'holiday' ? t('calendar.holiday') : t('calendar.custom')}
                </Text>
                <button
                  type="button"
                  className={styles.outlineToggle}
                  aria-label={t('calendarView.removeException')}
                  data-testid={`calendar-exception-remove-${range.start}`}
                  onClick={() =>
                    dispatch({
                      type: 'calendar.removeExceptionRange',
                      label: 'commands.calendar.removeExceptionRange',
                      payload: { calendarId: calendar.id, start: range.start, end: range.end },
                    })
                  }
                >
                  <IconTrash size={12} />
                </button>
              </div>
            ))
          )}
        </div>

        <Text className={chrome.blockTitle}>{t('calendarView.addException')}</Text>
        {/* 右栏只有 280px 宽，四个控件横排会挤成一团（原来在宽左栏里是一行）。
            改为**竖排**：标签到控件仍是组内 6px（§2.1）。 */}
        <div className={styles.exceptionForm}>
          {/* 这两处用 `DatePickerInput` 而**不是** `DateTimePicker`（计划「偏差 2」）：
              区间例外的命令 `calendar.addExceptionRange` **按日展开**（逐日写单日条目，
              payload 的 start / end 是 `DateStr`）。用带时刻的控件会让用户选出的时刻
              被静默丢弃 —— 那是「假装能用」。`DatePickerInput` 的语义就是「选一天」，
              值天然是 `YYYY-MM-DD`，时刻根本不会出现在选项里，故无需 toDateStr 转换，
              命令边界仍是纯日期（DateTimeStr 不会渗进这里）。 */}
          {/* ⚠️ 空值必须传 `null` **而不是 `''`**：`DatePickerInput` 的显示值走
              `getFormattedDate`，只有 `date === null` 才回空串；`''` 会被当成
              「非法日期」直接渲染成字面量 "Invalid Date"（实测踩过）。我们的状态里
              `''` 是「未设」哨兵，故进控件前转 null、出控件后转回 `''`。 */}
          {/* `placeholder` 与外层 `valueFormat` 同形状：`DatePickerInput` 默认没有占位符，
              空值时会缩成一个几乎点不到的窄条（旧 `DateTimePicker` 靠 "YYYY-MM-DD HH:mm"
              的占位文字撑开宽度，换成纯日期后这层宽度没了）。 */}
          <DatePickerInput
            aria-label={t('calendarView.rangeStart')}
            value={rangeStart || null}
            valueFormat="YYYY-MM-DD"
            placeholder="YYYY-MM-DD"
            onChange={(value) => setRangeStart(value ?? '')}
            data-testid="calendar-range-start"
          />
          <DatePickerInput
            aria-label={t('calendarView.rangeEnd')}
            value={rangeEnd || null}
            valueFormat="YYYY-MM-DD"
            placeholder="YYYY-MM-DD"
            onChange={(value) => setRangeEnd(value ?? '')}
            data-testid="calendar-range-end"
          />
          <Select
            size="xs"
            aria-label={t('calendarView.kindLabel')}
            data-testid="calendar-range-kind"
            value={kind}
            data={[
              { value: 'holiday', label: t('calendar.holiday') },
              { value: 'custom', label: t('calendar.custom') },
            ]}
            onChange={(value) => value && setKind(value as 'holiday' | 'custom')}
          />
          <Button size="xs" variant="light" data-testid="calendar-range-submit" onClick={addException}>
            {t('calendarView.addException')}
          </Button>
        </div>
      </section>
    </div>
  )
}

/** memo 化（见上）。calendar 视图没有虚拟化行，但仍是 ProjectView 的每帧子节点。 */
export const CalendarView = memo(CalendarViewComponent)
