import { useState } from 'react'
import { Button, Checkbox, NumberInput, Select, Text } from '@mantine/core'
import { IconTrash } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

import type { DateStr } from '../../domain/model/types'
import { isWorkday } from '../../domain/calendar/workdays'
import { createCalendar } from '../../domain/model/factories'
import { toDateStr } from '../../domain/calendar/dateTime'
import { useProjectStore } from '../../store/projectStore'
import { monthMatrix, shiftMonth } from '../shared/calendarGrid'
import { groupExceptions } from '../shared/groupExceptions'
import { formatDate } from '../shared/format'
import { DateField } from '../inspector/InspectorFields'
import styles from '../styles/ProjectView.module.scss'
// 区块类（blockTitle / weekdays / exceptionRow / exceptionDate / exceptionKind）原来由
// CalendarSettings 用 Chrome.module.scss 提供，这里原样复用，避免两处各写一份样式。
import chrome from '../styles/Chrome.module.scss'

const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
const WEEKDAY_HEADERS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

/**
 * 视图 A：项目日历（spec §5）。
 *
 * 「正常时数」区块**保留 `data-testid="calendar-settings"`** 并承载那七个工作日复选框 ——
 * 既有 e2e（regression / acceptance）靠它定位复选组，保留可让它们只改「怎么到达日历」。
 * 按区间增删例外走 v0.7 的两条区间命令（命令层逐日展开，见 spec §4.2）。
 */
export function CalendarView() {
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
  const cells = monthMatrix(anchor)
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

        <div className={styles.calendarGrid} data-testid="calendar-month-grid">
          {WEEKDAY_HEADERS.map((key) => (
            <div key={key} className={styles.calendarHead}>{t(`calendar.weekdays.${key}`)}</div>
          ))}
          {cells.map((date, index) => {
            if (date === null) {
              return (
                <div key={`pad-${index}`} className={`${styles.calendarDay} ${styles.calendarDayPad}`} />
              )
            }
            const workday = isWorkday(date, calendar)
            // 第三态：这一天是不是一条**例外**（日历里有它的条目）。
            // 例外日与「非工作日」是两回事 —— 一个 custom 落在工作日上时 isWorkday 仍为 true，
            // 只按 isWorkday 上色就看不出来（spec §5 要求三态：工作日 / 非工作日 / 例外日）。
            const exception = calendar.exceptions[date]
            return (
              <div
                key={date}
                className={`${styles.calendarDay} ${workday ? '' : styles.calendarDayOff} ${
                  exception ? styles.calendarDayException : ''
                }`}
                data-testid={`calendar-day-${date}`}
                data-workday={workday ? 'true' : 'false'}
                // 例外日的第三态身份也挂在 data 上，供 e2e 断言（视觉上靠角标，不引入新色相）
                data-exception={exception?.kind}
              >
                {date.slice(8)}
              </div>
            )
          })}
        </div>

        <Text className={chrome.blockTitle}>{t('calendarView.customDays')}</Text>
        <div data-testid="calendar-exception-list">
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
      </section>

      <section className={styles.calendarRight}>
        {/* 保留 calendar-settings 这个 testid：既有 e2e 靠它定位七个工作日复选框。
            区块标题另给一个 testid：e2e 用它断言「文案跟随语言」。它取代了已删的
            CalendarSettings 里那个 t('calendar.title') 标题（那个键已随之删除）。 */}
        <Text className={chrome.blockTitle} data-testid="calendar-normal-hours-title">
          {t('calendarView.normalHours')}
        </Text>
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

        <Text className={chrome.blockTitle}>{t('calendarView.addException')}</Text>
        <div className={chrome.exceptionRow}>
          {/* 区间例外的命令（addExceptionRange）按**日**展开，payload 是日期语义。
              故这两个 DateTimePicker 只用来「取日期」：回传值经 toDateStr 归一回
              纯日期再交给命令 —— DateTimeStr 只活在输入控件里，不进命令边界。 */}
          <DateField ariaLabel={t('calendarView.rangeStart')} value={rangeStart}
            onChange={(next) => setRangeStart(toDateStr(next))} testId="calendar-range-start" />
          <DateField ariaLabel={t('calendarView.rangeEnd')} value={rangeEnd}
            onChange={(next) => setRangeEnd(toDateStr(next))} testId="calendar-range-end" />
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
