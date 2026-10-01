import { useMemo } from 'react'
import {
  ActionIcon,
  Alert,
  Box,
  Checkbox,
  Divider,
  Group,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core'
import { IconTrash } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

import type { ConstraintType, DependencyType } from '../domain/model/types'
import { useProjectStore } from '../store/projectStore'
import { useScheduleStore } from '../store/scheduleStore'
import { useViewStore } from '../store/viewStore'

const CONSTRAINT_TYPES: ConstraintType[] = [
  'startOn',
  'finishOn',
  'startNoEarlierThan',
  'startNoLaterThan',
  'finishNoEarlierThan',
  'finishNoLaterThan',
]

const DEPENDENCY_TYPES: DependencyType[] = ['FS', 'SS', 'FF', 'SF']

export function Inspector() {
  const { t } = useTranslation()

  const project = useProjectStore((state) => state.project)
  const dispatch = useProjectStore((state) => state.dispatch)
  const selectedTaskId = useViewStore((state) => state.selectedTaskId)
  const result = useScheduleStore((state) => state.result)

  const task = project && selectedTaskId ? project.tasks[selectedTaskId] : undefined
  const schedule = selectedTaskId ? result.schedules[selectedTaskId] : undefined
  const isSummary = (task?.childIds.length ?? 0) > 0

  const related = useMemo(() => {
    if (!project || !selectedTaskId) return []
    return Object.values(project.dependencies).filter(
      (dep) => dep.toTaskId === selectedTaskId || dep.fromTaskId === selectedTaskId,
    )
  }, [project, selectedTaskId])

  const conflict = selectedTaskId
    ? result.conflicts.find((item) => item.taskId === selectedTaskId)
    : undefined

  // 可以作为前置的候选：全部叶子任务中除自己以外的
  const candidates = useMemo(() => {
    if (!project || !selectedTaskId) return []
    return Object.values(project.tasks)
      .filter((candidate) => candidate.id !== selectedTaskId && candidate.childIds.length === 0)
      .map((candidate) => ({ value: candidate.id, label: candidate.name }))
  }, [project, selectedTaskId])

  if (!project || !task || !selectedTaskId) return null

  const constraintValue = task.scheduling.mode === 'auto' ? 'auto' : task.scheduling.type

  // 提前收窄成局部常量：`task.scheduling` 的收窄不会穿透进 JSX 回调
  // （回调可能在别处调用，TS 不认为判别联合在这里仍然成立）。
  const constraint = task.scheduling.mode === 'constraint' ? task.scheduling : null

  return (
    <Box
      w="var(--planit-inspector-width)"
      p="md"
      style={{
        overflowY: 'auto',
        flexShrink: 0,
        borderLeft: '1px solid var(--planit-border)',
      }}
      data-testid="inspector"
    >
      <Text fz="xs" fw={650} c="dimmed" tt="uppercase" mb="sm">
        {t('inspector.title')}
      </Text>

      <Stack gap="sm">
        <TextInput
          label={t('inspector.name')}
          value={task.name}
          onChange={(event) =>
            dispatch({
              type: 'task.rename',
              label: 'commands.task.rename',
              payload: { taskId: selectedTaskId, name: event.target.value },
              coalesceKey: `task.rename:${selectedTaskId}`,
            })
          }
        />

        {isSummary ? (
          <Text fz="xs" c="dimmed">
            {t('inspector.summaryHint')}
          </Text>
        ) : (
          <>
            <NumberInput
              label={t('inspector.duration')}
              min={0}
              value={task.duration}
              // 注意：NumberInput 的 onChange 给的是值，不是事件
              onChange={(value) =>
                dispatch({
                  type: 'task.setDuration',
                  label: 'commands.task.setDuration',
                  payload: { taskId: selectedTaskId, duration: Number(value) || 0 },
                  coalesceKey: `task.setDuration:${selectedTaskId}`,
                })
              }
            />

            <NumberInput
              label={t('inspector.progress')}
              min={0}
              max={100}
              value={task.progress}
              onChange={(value) =>
                dispatch({
                  type: 'task.setProgress',
                  label: 'commands.task.setProgress',
                  payload: { taskId: selectedTaskId, progress: Number(value) || 0 },
                  coalesceKey: `task.setProgress:${selectedTaskId}`,
                })
              }
            />

            <Checkbox
              label={t('inspector.milestone')}
              checked={task.isMilestone}
              onChange={() =>
                dispatch({
                  type: 'task.toggleMilestone',
                  label: 'commands.task.toggleMilestone',
                  payload: { taskId: selectedTaskId },
                })
              }
            />

            <Select
              label={t('inspector.scheduling')}
              value={constraintValue}
              data={[
                { value: 'auto', label: t('scheduling.auto') },
                ...CONSTRAINT_TYPES.map((type) => ({ value: type, label: t(`scheduling.${type}`) })),
              ]}
              onChange={(value) => {
                if (!value) return
                if (value === 'auto') {
                  dispatch({
                    type: 'task.setScheduling',
                    label: 'commands.task.setScheduling',
                    payload: { taskId: selectedTaskId, scheduling: { mode: 'auto' } },
                  })
                  return
                }
                dispatch({
                  type: 'task.setScheduling',
                  label: 'commands.task.setScheduling',
                  payload: {
                    taskId: selectedTaskId,
                    scheduling: {
                      mode: 'constraint',
                      type: value as ConstraintType,
                      date: schedule?.earlyStart ?? project.startDate,
                    },
                  },
                })
              }}
            />

            {constraint && (
              <TextInput
                type="date"
                label={t('inspector.constraintDate')}
                value={constraint.date}
                onChange={(event) =>
                  dispatch({
                    type: 'task.setScheduling',
                    label: 'commands.task.setScheduling',
                    payload: {
                      taskId: selectedTaskId,
                      scheduling: {
                        mode: 'constraint',
                        type: constraint.type,
                        date: event.target.value,
                      },
                    },
                  })
                }
              />
            )}
          </>
        )}

        {conflict && (
          <Alert color="red" p="xs">
            {/* 冲突参数直接展开在 conflict 对象上（可辨识联合），没有 params 袋子。
                constraint 是 ConstraintType 键，渲染前先换成当前语言的标签，
                否则用户会看到 "startOn" 这样的裸键名。 */}
            {t(`conflicts.${conflict.kind}`, {
              ...conflict,
              ...(conflict.kind === 'constraintViolatedByDependency'
                ? { constraint: t(`scheduling.${conflict.constraint}`) }
                : {}),
            })}
          </Alert>
        )}

        {schedule && (
          <Text fz="xs" c="dimmed">
            {t('inspector.earliest')}：{schedule.earlyStart} → {schedule.earlyFinish}
            <br />
            {t('inspector.slack')}：{schedule.totalSlack} {t('inspector.slackUnit')}
            {schedule.isCritical && ` · ${t('inspector.critical')}`}
          </Text>
        )}

        <Divider />

        <Text fz="xs" fw={650} c="dimmed" tt="uppercase">
          {t('inspector.dependencies')}
        </Text>

        <Stack gap={4}>
          {related.map((dep) => {
            const isIncoming = dep.toTaskId === selectedTaskId
            const otherId = isIncoming ? dep.fromTaskId : dep.toTaskId
            const otherName = project.tasks[otherId]?.name ?? t('inspector.deletedTask')

            return (
              <Group key={dep.id} gap={4} wrap="nowrap">
                <Text fz="xs" truncate style={{ flex: 1 }}>
                  {isIncoming ? '←' : '→'} {otherName}
                </Text>

                <Select
                  size="xs"
                  w={72}
                  aria-label={`${t('inspector.dependencies')} ${otherName}`}
                  value={dep.type}
                  data={DEPENDENCY_TYPES.map((type) => ({ value: type, label: type }))}
                  onChange={(value) =>
                    value &&
                    dispatch({
                      type: 'dependency.setType',
                      label: 'commands.dependency.setType',
                      payload: { dependencyId: dep.id, type: value as DependencyType },
                    })
                  }
                />

                <NumberInput
                  size="xs"
                  w={64}
                  aria-label={`${t('inspector.lag')} ${otherName}`}
                  value={dep.lag}
                  onChange={(value) =>
                    dispatch({
                      type: 'dependency.setLag',
                      label: 'commands.dependency.setLag',
                      payload: { dependencyId: dep.id, lag: Number(value) || 0 },
                      coalesceKey: `dependency.setLag:${dep.id}`,
                    })
                  }
                />

                <ActionIcon
                  size="sm"
                  variant="subtle"
                  color="red"
                  aria-label={`${t('commands.dependency.delete')} ${otherName}`}
                  onClick={() =>
                    dispatch({
                      type: 'dependency.delete',
                      label: 'commands.dependency.delete',
                      payload: { dependencyId: dep.id },
                    })
                  }
                >
                  <IconTrash size={14} />
                </ActionIcon>
              </Group>
            )
          })}
        </Stack>

        {!isSummary && candidates.length > 0 && (
          <Select
            label={t('inspector.addPredecessor')}
            placeholder={t('inspector.selectPredecessor')}
            value={null}
            data={candidates}
            onChange={(fromTaskId) => {
              if (!fromTaskId) return
              dispatch({
                type: 'dependency.create',
                label: 'commands.dependency.create',
                payload: {
                  fromTaskId,
                  toTaskId: selectedTaskId,
                  type: 'FS' as DependencyType,
                  lag: 0,
                },
              })
            }}
          />
        )}
      </Stack>
    </Box>
  )
}
