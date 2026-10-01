import { Divider, NumberInput, Select, Stack, Text, TextInput } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import type { SchedulingDirection } from '../domain/model/types'
import { useProjectStore } from '../store/projectStore'
import { useScheduleStore } from '../store/scheduleStore'
import { computeProjectSummary } from './projectSummary'

/**
 * 项目面板（spec §4）。宽度由 ProjectView 的右侧栏容器统一持有，这里只填满它。
 *
 * 方向语义（偏差 4）：
 *   forward  —— startDate 是正推起点（可编辑）；endDate 是可选期限（也可编辑）
 *   backward —— endDate 是逆推终点（可编辑）；startDate 是引擎推导值 → 只读
 */
export function ProjectInspector() {
  const { t } = useTranslation()
  const project = useProjectStore((state) => state.project)!
  const dispatch = useProjectStore((state) => state.dispatch)
  const breakCoalescing = useProjectStore((state) => state.breakCoalescing)
  const result = useScheduleStore((state) => state.result)

  const backward = project.schedulingDirection === 'backward'
  const calendar = project.calendars[project.calendarId]
  const summary = computeProjectSummary(project, result.schedules)

  // backward 下开始日期是派生值：所有叶子 scheduledStart 的最小值
  const derivedStart = summary?.start ?? project.startDate

  return (
    <Stack gap="sm">
      <TextInput
        label={t('inspector.project.name')}
        value={project.name}
        onBlur={breakCoalescing}
        onChange={(event) =>
          dispatch({
            type: 'project.rename',
            label: 'commands.project.rename',
            payload: { name: event.target.value },
            coalesceKey: 'project.rename',
          })
        }
      />

      <Select
        label={t('inspector.project.direction')}
        value={project.schedulingDirection}
        data={[
          { value: 'forward', label: t('inspector.project.directionForward') },
          { value: 'backward', label: t('inspector.project.directionBackward') },
        ]}
        onChange={(value) =>
          value &&
          dispatch({
            type: 'project.setDirection',
            label: 'commands.project.setDirection',
            payload: { direction: value as SchedulingDirection },
          })
        }
      />

      <TextInput
        type="date"
        label={t('inspector.project.startDate')}
        value={backward ? derivedStart : project.startDate}
        disabled={backward}
        onBlur={breakCoalescing}
        onChange={(event) =>
          dispatch({
            type: 'project.setStartDate',
            label: 'commands.project.setStartDate',
            payload: { startDate: event.target.value },
            coalesceKey: 'project.setStartDate',
          })
        }
      />
      {backward && (
        <Text fz="xs" c="dimmed">
          {t('inspector.project.startDerivedHint')}
        </Text>
      )}

      <TextInput
        type="date"
        label={t('inspector.project.endDate')}
        value={project.endDate ?? ''}
        onBlur={breakCoalescing}
        onChange={(event) =>
          dispatch({
            type: 'project.setEndDate',
            label: 'commands.project.setEndDate',
            // 清空 = 无期限（forward）/ 退回正推完成日（backward）
            payload: { endDate: event.target.value || undefined },
            coalesceKey: 'project.setEndDate',
          })
        }
      />

      <Divider />
      <Text fz="xs" fw={650} c="dimmed" tt="uppercase">
        {t('inspector.project.summary')}
      </Text>
      {summary ? (
        <>
          <Text fz="xs" c="dimmed">
            {t('inspector.project.span', { start: summary.start, finish: summary.finish })}
          </Text>
          <Text fz="xs" c="dimmed">
            {t('inspector.project.totalWorkdays', { count: summary.totalWorkdays })}
          </Text>
          <Text fz="xs" c="dimmed">
            {t('inspector.project.taskCount', { count: summary.taskCount })}
          </Text>
        </>
      ) : (
        <Text fz="xs" c="dimmed">
          {t('statusBar.empty')}
        </Text>
      )}

      <Divider />
      <Text fz="xs" fw={650} c="dimmed" tt="uppercase">
        {t('inspector.project.format')}
      </Text>
      <Select
        label={t('inspector.project.currency')}
        disabled
        value={null}
        data={[]}
        placeholder="—"
      />
      <Text fz="xs" c="dimmed">
        {t('inspector.project.currencyHint')}
      </Text>

      <NumberInput
        label={t('inspector.project.unitConversion')}
        min={1}
        value={calendar.hoursPerDay}
        onBlur={breakCoalescing}
        onChange={(value) =>
          dispatch({
            type: 'calendar.setHoursPerDay',
            label: 'commands.calendar.setHoursPerDay',
            payload: { hoursPerDay: Number(value) || 1 },
            coalesceKey: 'calendar.setHoursPerDay',
          })
        }
      />
    </Stack>
  )
}
