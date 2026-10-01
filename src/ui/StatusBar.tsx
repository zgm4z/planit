import type { CSSProperties } from 'react'
import { Group, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import { useProjectStore } from '../store/projectStore'
import { useScheduleStore } from '../store/scheduleStore'
import { computeProjectSummary } from './projectSummary'

export function StatusBar() {
  const { t } = useTranslation()
  const project = useProjectStore((state) => state.project)
  const result = useScheduleStore((state) => state.result)

  if (!project) return null

  const barStyle: CSSProperties = {
    borderTop: '1px solid var(--planit-border)',
    background: 'var(--planit-bg-surface)',
  }

  // 跨度 / 工作日换算走唯一的一份实现（projectSummary），与项目面板共用
  const summary = computeProjectSummary(project, result.schedules)

  if (!summary) {
    return (
      <Group h={28} px="md" style={barStyle} data-testid="status-bar">
        <Text fz="xs" c="dimmed">
          {t('statusBar.empty')}
        </Text>
      </Group>
    )
  }

  // 关键任务数仍按叶子任务统计 —— 摘要任务的关键标记是从子任务继承来的，重复计数会翻倍
  const criticalCount = Object.values(project.tasks)
    .filter((task) => task.childIds.length === 0)
    .map((task) => result.schedules[task.id])
    .filter((schedule): schedule is NonNullable<typeof schedule> => Boolean(schedule))
    .filter((schedule) => schedule.isCritical).length

  return (
    <Group h={28} px="md" gap="lg" style={barStyle} data-testid="status-bar">
      <Text fz="xs" c="dimmed" data-testid="status-span">
        {t('statusBar.span', { start: summary.start, finish: summary.finish })}
      </Text>
      <Text fz="xs" c="dimmed" data-testid="status-workdays">
        {t('statusBar.totalWorkdays', { count: summary.totalWorkdays })}
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
