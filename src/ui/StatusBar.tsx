import type { CSSProperties } from 'react'
import { Group, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import { workdaysBetween } from '../domain/calendar/workdays'
import { useProjectStore } from '../store/projectStore'
import { useScheduleStore } from '../store/scheduleStore'

export function StatusBar() {
  const { t } = useTranslation()
  const project = useProjectStore((state) => state.project)
  const result = useScheduleStore((state) => state.result)

  if (!project) return null

  const barStyle: CSSProperties = {
    borderTop: '1px solid var(--planit-border)',
    background: 'var(--planit-bg-surface)',
  }

  // 只用叶子任务统计 —— 摘要任务的关键标记是从子任务继承来的，重复计数会翻倍
  const leafSchedules = Object.values(project.tasks)
    .filter((task) => task.childIds.length === 0)
    .map((task) => result.schedules[task.id])
    .filter((schedule): schedule is NonNullable<typeof schedule> => Boolean(schedule))

  if (leafSchedules.length === 0) {
    return (
      <Group h={28} px="md" style={barStyle} data-testid="status-bar">
        <Text fz="xs" c="dimmed">
          {t('statusBar.empty')}
        </Text>
      </Group>
    )
  }

  const start = leafSchedules.reduce(
    (acc, s) => (s.earlyStart < acc ? s.earlyStart : acc),
    leafSchedules[0].earlyStart,
  )
  const finish = leafSchedules.reduce(
    (acc, s) => (s.earlyFinish > acc ? s.earlyFinish : acc),
    leafSchedules[0].earlyFinish,
  )

  const calendar = project.calendars[project.calendarId]
  // 含首尾两天，与甘特条宽度口径一致
  const totalWorkdays = workdaysBetween(start, finish, calendar) + 1
  const criticalCount = leafSchedules.filter((schedule) => schedule.isCritical).length

  return (
    <Group h={28} px="md" gap="lg" style={barStyle} data-testid="status-bar">
      <Text fz="xs" c="dimmed" data-testid="status-span">
        {t('statusBar.span', { start, finish })}
      </Text>
      <Text fz="xs" c="dimmed" data-testid="status-workdays">
        {t('statusBar.totalWorkdays', { count: totalWorkdays })}
      </Text>
      <Text fz="xs" c="dimmed" data-testid="status-critical">
        {t('statusBar.criticalCount', { count: criticalCount })}
      </Text>
      {result.conflicts.length > 0 && (
        <Text fz="xs" c="red" data-testid="status-conflicts">
          {t('statusBar.conflictCount', { count: result.conflicts.length })}
        </Text>
      )}
    </Group>
  )
}
