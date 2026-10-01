import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Accordion,
  ActionIcon,
  Alert,
  Box,
  Checkbox,
  Group,
  NumberInput,
  Select,
  Stack,
  Tabs,
  Text,
  TextInput,
} from '@mantine/core'
import { IconTrash } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

import type {
  ComputedSchedule,
  ConstraintType,
  DependencyType,
  Task,
  TaskId,
} from '../domain/model/types'
import { useProjectStore } from '../store/projectStore'
import { useScheduleStore } from '../store/scheduleStore'
import { useViewStore } from '../store/viewStore'
import { DEFAULT_OPEN_GROUPS, INSPECTOR_GROUPS, type InspectorGroupKey } from './inspectorGroups'
import { ProjectInspector } from './ProjectInspector'

const CONSTRAINT_TYPES: ConstraintType[] = [
  'startOn',
  'finishOn',
  'startNoEarlierThan',
  'startNoLaterThan',
  'finishNoEarlierThan',
  'finishNoLaterThan',
]

const DEPENDENCY_TYPES: DependencyType[] = ['FS', 'SS', 'FF', 'SF']

/**
 * Inspector（spec §2–§5）：右栏 = 「任务 / 项目」双 Tab。
 *
 * 选中任务时默认「任务」Tab；**未选中任务时强制「项目」Tab** ——
 * 右栏因此永远有内容，宽度恒定（修掉 v0.1 的右栏塌陷）。
 *
 * 标题的 <Text> **必须在 Tabs 之前**：e2e 用 `[data-testid="inspector"] p` 的
 * 第一个元素断言标题文案（acceptance.spec.ts:371）。分组标题用纯字符串渲染进
 * Accordion.Control（产出 <button>，不产出 <p>），以免打乱「第一个 <p>」。
 */
export function Inspector() {
  const { t } = useTranslation()
  const project = useProjectStore((state) => state.project)
  const selectedTaskId = useViewStore((state) => state.selectedTaskId)
  const [tab, setTab] = useState<'task' | 'project'>('task')

  // 换任务时回到「任务」Tab（spec §2：选中任务时默认任务 Tab）
  useEffect(() => {
    setTab('task')
  }, [selectedTaskId])

  if (!project) return null

  const hasTask = Boolean(selectedTaskId && project.tasks[selectedTaskId])
  const value: 'task' | 'project' = hasTask ? tab : 'project'

  return (
    <Box
      w="100%"
      p="md"
      style={{ overflowY: 'auto', flexShrink: 0 }}
      data-testid="inspector"
    >
      <Text fz="xs" fw={650} c="dimmed" tt="uppercase" mb="sm">
        {value === 'task' ? t('inspector.title') : t('inspector.projectTitle')}
      </Text>

      {/* keepMounted={false}：Mantine 9 的 Tabs 默认常驻挂载非活动面板（keepMounted: true），
          于是「任务」与「项目」两个面板会同时在 DOM 里 —— 两者都有一个 label 叫「名称」的
          输入框，`getByLabelText('名称')` 会命中两个而抛错，且隐藏面板里的表单控件仍参与
          可访问性树。显式关掉挂载，让「面板不显示 = 不挂载」成立：既消除了重名 label，
          也满足既有单测「切到项目 Tab 后任务面板不在 DOM」的断言。 */}
      <Tabs keepMounted={false} value={value} onChange={(next) => setTab(next as 'task' | 'project')}>
        <Tabs.List mb="sm">
          <Tabs.Tab value="task" disabled={!hasTask} data-testid="inspector-tab-task">
            {t('inspector.tabs.task')}
          </Tabs.Tab>
          <Tabs.Tab value="project" data-testid="inspector-tab-project">
            {t('inspector.tabs.project')}
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="task" data-testid="inspector-task-panel">
          {hasTask ? <TaskPanel taskId={selectedTaskId!} /> : null}
        </Tabs.Panel>

        <Tabs.Panel value="project" data-testid="inspector-project-panel">
          <ProjectInspector />
        </Tabs.Panel>
      </Tabs>
    </Box>
  )
}

/** 任务 Tab：冲突告警（Accordion 之外，折叠不了）+ 按注册表渲染的 7 个分组 */
function TaskPanel({ taskId }: { taskId: TaskId }) {
  const { t } = useTranslation()
  const project = useProjectStore((state) => state.project)!
  const result = useScheduleStore((state) => state.result)

  const task = project.tasks[taskId]
  const schedule = result.schedules[taskId]
  const conflict = result.conflicts.find((item) => item.taskId === taskId)
  const isSummary = task.childIds.length > 0

  // 分组内容：闭包在这里，直接引用上面这些值（不必把 t 塞进一个「上下文」类型 ——
  // i18next 的 t 是重载过的泛型函数，硬塞进普通函数类型会招来类型体操）
  const renderContent = (key: InspectorGroupKey): ReactNode => {
    switch (key) {
      case 'info':
        return <InfoGroup task={task} taskId={taskId} isSummary={isSummary} />
      case 'schedule':
        return (
          <ScheduleGroup task={task} schedule={schedule} taskId={taskId} isSummary={isSummary} />
        )
      case 'relations':
        return <RelationsGroup task={task} taskId={taskId} isSummary={isSummary} />
      case 'baseline':
        return (
          <PlaceholderGroup
            testId="placeholder-baseline"
            reasonKey="inspector.placeholder.baselineHint"
          >
            <TextInput label={t('inspector.placeholder.baseline')} disabled value="" />
          </PlaceholderGroup>
        )
      case 'assignments':
        return (
          <PlaceholderGroup
            testId="placeholder-assignments"
            reasonKey="inspector.placeholder.assignmentsHint"
          >
            <Select
              label={t('inspector.placeholder.resource')}
              disabled
              value={null}
              data={[]}
              placeholder="—"
            />
            <NumberInput label={t('inspector.placeholder.units')} disabled value={0} />
          </PlaceholderGroup>
        )
      case 'allocation':
        return (
          <PlaceholderGroup
            testId="placeholder-allocation"
            reasonKey="inspector.placeholder.allocationHint"
          >
            <Select
              label={t('inspector.placeholder.allocationOnChange')}
              disabled
              value={null}
              data={[]}
              placeholder="—"
            />
            <Select
              label={t('inspector.placeholder.allocationNeeds')}
              disabled
              value={null}
              data={[]}
              placeholder="—"
            />
          </PlaceholderGroup>
        )
      case 'expectedEffort':
        return (
          <PlaceholderGroup
            testId="placeholder-expected-effort"
            reasonKey="inspector.placeholder.expectedEffortHint"
          >
            <NumberInput label={t('inspector.placeholder.min')} disabled value={0} />
            <NumberInput label={t('inspector.placeholder.max')} disabled value={0} />
            <NumberInput label={t('inspector.placeholder.expected')} disabled value={0} />
          </PlaceholderGroup>
        )
    }
  }

  return (
    <Stack gap="sm">
      {conflict && (
        <Alert color="red" p="xs">
          {t(`conflicts.${conflict.kind}`, {
            ...conflict,
            ...(conflict.kind === 'constraintViolatedByDependency'
              ? { constraint: t(`scheduling.${conflict.constraint}`) }
              : {}),
          })}
        </Alert>
      )}

      <Accordion multiple variant="separated" defaultValue={DEFAULT_OPEN_GROUPS}>
        {INSPECTOR_GROUPS.map((group) => (
          <Accordion.Item key={group.key} value={group.key}>
            <Accordion.Control>{t(group.labelKey)}</Accordion.Control>
            <Accordion.Panel>{renderContent(group.key)}</Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
    </Stack>
  )
}

/** 占位组：整组禁用 + 一段说明。**渲染出来而不是隐藏**（分批原则） */
function PlaceholderGroup({
  testId,
  reasonKey,
  children,
}: {
  testId: string
  reasonKey: string
  children: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <Stack gap="xs" data-testid={testId}>
      {children}
      <Text fz="xs" c="dimmed">
        {t(reasonKey)}
      </Text>
    </Stack>
  )
}

// ── 三个「活」分组：本任务先**原样搬迁既有控件**，Task 3/4/5 逐组替换 ──────────

function InfoGroup({
  task,
  taskId,
  isSummary,
}: {
  task: Task
  taskId: TaskId
  isSummary: boolean
}) {
  const { t } = useTranslation()
  const dispatch = useProjectStore((state) => state.dispatch)
  const breakCoalescing = useProjectStore((state) => state.breakCoalescing)

  return (
    <Stack gap="sm">
      <TextInput
        label={t('inspector.name')}
        value={task.name}
        onBlur={breakCoalescing}
        onChange={(event) =>
          dispatch({
            type: 'task.rename',
            label: 'commands.task.rename',
            payload: { taskId, name: event.target.value },
            coalesceKey: `task.rename:${taskId}`,
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
            onBlur={breakCoalescing}
            onChange={(value) =>
              dispatch({
                type: 'task.setDuration',
                label: 'commands.task.setDuration',
                payload: { taskId, duration: Number(value) || 0 },
                coalesceKey: `task.setDuration:${taskId}`,
              })
            }
          />

          <NumberInput
            label={t('inspector.progress')}
            min={0}
            max={100}
            value={task.progress}
            onBlur={breakCoalescing}
            onChange={(value) =>
              dispatch({
                type: 'task.setProgress',
                label: 'commands.task.setProgress',
                payload: { taskId, progress: Number(value) || 0 },
                coalesceKey: `task.setProgress:${taskId}`,
              })
            }
          />

          <Checkbox
            label={t('inspector.kindMilestone')}
            checked={task.kind === 'milestone'}
            onChange={() =>
              dispatch({
                type: 'task.toggleMilestone',
                label: 'commands.task.toggleMilestone',
                payload: { taskId },
              })
            }
          />
        </>
      )}
    </Stack>
  )
}

function ScheduleGroup({
  task,
  schedule,
  taskId,
  isSummary,
}: {
  task: Task
  schedule: ComputedSchedule | undefined
  taskId: TaskId
  isSummary: boolean
}) {
  const { t } = useTranslation()
  const project = useProjectStore((state) => state.project)!
  const dispatch = useProjectStore((state) => state.dispatch)
  const breakCoalescing = useProjectStore((state) => state.breakCoalescing)

  const constraintValue = task.scheduling.mode === 'auto' ? 'auto' : task.scheduling.type
  const constraint = task.scheduling.mode === 'constraint' ? task.scheduling : null

  return (
    <Stack gap="sm">
      <Select
        label={t('inspector.scheduling')}
        value={constraintValue}
        // 摘要任务的日期由子任务汇总 —— task.setScheduling 对 group 本就是 no-op，
        // 这里禁用是为了不出现「点了没反应」的控件（分批原则）
        disabled={isSummary}
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
              payload: { taskId, scheduling: { mode: 'auto' } },
            })
            return
          }
          dispatch({
            type: 'task.setScheduling',
            label: 'commands.task.setScheduling',
            payload: {
              taskId,
              scheduling: {
                mode: 'constraint',
                type: value as ConstraintType,
                date: schedule?.scheduledStart ?? project.startDate,
              },
            },
          })
        }}
      />

      {constraint && (
        <TextInput
          type="date"
          label={t('inspector.scheduling') + ' · ' + t(`scheduling.${constraint.type}`)}
          value={constraint.date}
          disabled={isSummary}
          onBlur={breakCoalescing}
          onChange={(event) =>
            dispatch({
              type: 'task.setScheduling',
              label: 'commands.task.setScheduling',
              payload: {
                taskId,
                scheduling: { mode: 'constraint', type: constraint.type, date: event.target.value },
              },
              coalesceKey: `task.setScheduling:${taskId}`,
            })
          }
        />
      )}

      {schedule && (
        <Text fz="xs" c="dimmed">
          {t('inspector.slack', { count: schedule.totalSlack })}
          {schedule.isCritical && ` · ${t('inspector.critical')}`}
        </Text>
      )}
    </Stack>
  )
}

// 注意：`task` 只出现在**类型**里、不从参数里解构 —— 本组用 taskId 就够（避免未使用变量）。
function RelationsGroup({
  taskId,
  isSummary,
}: {
  task: Task
  taskId: TaskId
  isSummary: boolean
}) {
  const { t } = useTranslation()
  const project = useProjectStore((state) => state.project)!
  const dispatch = useProjectStore((state) => state.dispatch)
  const breakCoalescing = useProjectStore((state) => state.breakCoalescing)

  const related = Object.values(project.dependencies).filter(
    (dep) => dep.toTaskId === taskId || dep.fromTaskId === taskId,
  )

  const candidates = useMemo(() => {
    const alreadyLinked = new Set(
      Object.values(project.dependencies)
        .filter((dep) => dep.toTaskId === taskId)
        .map((dep) => dep.fromTaskId),
    )
    return Object.values(project.tasks)
      .filter(
        (candidate) =>
          candidate.id !== taskId &&
          candidate.childIds.length === 0 &&
          !alreadyLinked.has(candidate.id),
      )
      .map((candidate) => ({ value: candidate.id, label: candidate.name }))
  }, [project, taskId])

  return (
    <Stack gap="sm">
      {related.map((dep) => {
        const isIncoming = dep.toTaskId === taskId
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
              aria-label={`${t('inspector.groups.relations')} ${otherName}`}
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
              onBlur={breakCoalescing}
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

      {!isSummary && candidates.length > 0 && (
        <Select
          label={t('inspector.relations.addPredecessor')}
          placeholder={t('inspector.relations.selectTask')}
          value={null}
          data={candidates}
          onChange={(fromTaskId) => {
            if (!fromTaskId) return
            dispatch({
              type: 'dependency.create',
              label: 'commands.dependency.create',
              payload: { fromTaskId, toTaskId: taskId, type: 'FS' as DependencyType, lag: 0 },
            })
          }}
        />
      )}
    </Stack>
  )
}
