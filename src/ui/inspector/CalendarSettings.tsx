import { useState } from 'react'
import { ActionIcon, Button, Checkbox, Group, Text } from '@mantine/core'
import { IconTrash } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

import { useProjectStore } from '../../store/projectStore'
import { DateField } from './InspectorFields'
import { formatDate } from '../shared/format'
import styles from '../styles/Chrome.module.scss'

const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

/**
 * 日历设置 —— **「项目」Tab 内的一个区块**（与 名称 / 排期方向 / 基准日 / 格式 并列）。
 *
 * IA 归属（为什么从「钉在右栏底部」搬到项目 Tab 内）：
 *   它是**项目级配置** —— 改工作日会重排整个项目，和「排期方向」「开始日期」
 *   是同一类东西，因此应当和它们同处「项目」Tab。此前它被钉在所有 Tab 之下的
 *   公共位置，切到「资源」Tab 时底下仍挂着一块**项目**日历设置 —— 信息架构错位。
 *
 * 关于「全局设置不该随局部选择消失」那条论证（前一位实现者的判断）：
 *   那条论证的前提（「它必须常驻，否则切 Tab 就看不见了」）本身是对的判断，
 *   但推出的结论错了 —— 它把「藏在 Accordion 分组里、会跟着折叠」与
 *   「属于项目 Tab 的顶层区块」混为一谈。本组件在项目面板里**不是**折叠组，
 *   而是顶层区块：只要用户去看项目配置（项目 Tab），它就在那儿，不会折叠、
 *   不会随任务选择消失。真正的取舍是：**用「始终可见」换「出现在它该在的地方」**。
 *   我们选后者 —— 一个「资源」面板底下挂着项目日历，比「要看工作日历先切到
 *   项目 Tab」更让人困惑；后者至少与用户的意图一致（找项目配置就该去项目 Tab）。
 *
 * 排版：区块标题 --fs-lg/600 + 下沿（与 Inspector 的 .accControl 同形），
 * 组内 6 / 组间 16 / 区块 24 —— 读作「项目配置区的又一个区块」。
 * 外层的 border-top / 内边距 / 底色已去掉：那是「钉在右栏底部的一条」才需要的
 * 分隔，现在它与上方区块同处一个 Stack，间距由 GAP_BLOCK 与标题下沿承担。
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
