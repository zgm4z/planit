import { useState } from 'react'
import { ActionIcon, Button, Checkbox, Group, Text } from '@mantine/core'
import { IconTrash } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

import { useProjectStore } from '../store/projectStore'
import { DateField } from './InspectorFields'
import { formatDate } from './format'
import styles from './styles/Chrome.module.scss'

const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

/**
 * 日历设置（右栏底部的独立区域）。
 *
 * **与上面面板的关系（判断，不是选项列举）**：它与 Inspector 是**并列的区块**，
 * 不是某个分组的孩子。理由是它是**项目级**设置 —— 改工作日会重排整个项目，
 * 而 Inspector 的内容随「选中的任务 / Tab」变化。若把它塞进某个 Accordion
 * 分组，切 Tab 或换任务时它会跟着折叠、藏起来，一个全局设置就不该随局部选择消失。
 * 因此它钉在右栏底部、常驻可见。
 *
 * 既然并列，就用**同一套排版**表达并列：区块标题 --fs-lg/600 + 下沿（与
 * Inspector 的 .accControl 同形），组内 6 / 组间 16 / 区块 24 —— 读作
 * 「右栏的又一个区块」，而不是一块挤在角落的小控件。
 *
 * 日期输入复用 Inspector 的 DateField（§1.3）：展示值一律 YYYY-MM-DD，
 * 不再用原生 date 输入（其显示格式由浏览器 locale 决定，改不动）。
 */
export function CalendarSettings() {
  const { t } = useTranslation()
  const project = useProjectStore((state) => state.project)
  const dispatch = useProjectStore((state) => state.dispatch)
  const [draftDate, setDraftDate] = useState('')

  if (!project) return null

  const calendar = project.calendars[project.calendarId]
  const exceptions = Object.entries(calendar.exceptions).sort(([a], [b]) => (a < b ? -1 : 1))

  function addHoliday(): void {
    if (!draftDate) return
    dispatch({
      type: 'calendar.addException',
      label: 'commands.calendar.addException',
      payload: { calendarId: calendar.id, date: draftDate, exception: { kind: 'holiday' } },
    })
    setDraftDate('')
  }

  return (
    <div className={styles.calendar} data-testid="calendar-settings">
      {/* 区块一：工作日 */}
      <Text className={styles.blockTitle}>{t('calendar.title')}</Text>

      <div className={`${styles.weekdays} ${styles.blockBody}`}>
        {WEEKDAY_KEYS.map((key, index) => (
          <Checkbox
            key={key}
            size="xs"
            label={t(`calendar.weekdays.${key}`)}
            checked={calendar.workingDays[index]}
            // Checkbox 的 onChange 贴近原生 input：给的是事件，不是值。
            // 用 event.currentTarget.checked（与 NumberInput/Select 不同）。
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

      {/* 区块二：例外日期（区块间 24px） */}
      <Text className={`${styles.blockTitle} ${styles.blockGap}`}>{t('calendar.exceptions')}</Text>

      <Group gap={6} wrap="nowrap" className={styles.blockBody}>
        <div style={{ flex: 1 }}>
          {/* 标签已由区块标题「例外日期」给出，故只给可访问名（ariaLabel），
              不再渲染第二个可见标签 —— 否则同一段文字出现两次。 */}
          <DateField
            ariaLabel={t('calendar.exceptions')}
            value={draftDate}
            onChange={(next) => setDraftDate(next)}
          />
        </div>
        <Button size="xs" variant="light" onClick={addHoliday}>
          {t('calendar.addHoliday')}
        </Button>
      </Group>

      {exceptions.length > 0 && (
        <div className={styles.exceptionList}>
          {exceptions.map(([date, exception]) => (
            <div key={date} className={styles.exceptionRow}>
              <Text className={styles.exceptionDate}>{formatDate(date) ?? date}</Text>
              <Text className={styles.exceptionKind}>
                {exception.kind === 'holiday' ? t('calendar.holiday') : t('calendar.custom')}
              </Text>
              <ActionIcon
                size="sm"
                variant="subtle"
                color="red"
                aria-label={date}
                onClick={() =>
                  dispatch({
                    type: 'calendar.removeException',
                    label: 'commands.calendar.removeException',
                    payload: { calendarId: calendar.id, date },
                  })
                }
              >
                <IconTrash size={12} />
              </ActionIcon>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
