import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Accordion,
  ActionIcon,
  Alert,
  Box,
  Button,
  Checkbox,
  Group,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Tabs,
  Text,
  TextInput,
} from '@mantine/core'
import type { ScrollAreaProps } from '@mantine/core'
import { IconTrash } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

import type {
  ComputedSchedule,
  ConstraintType,
  Dependency,
  DependencyType,
  EffortMode,
  SchedulingOrder,
  Task,
  TaskId,
} from '../domain/model/types'
import { useProjectStore } from '../store/projectStore'
import { useScheduleStore } from '../store/scheduleStore'
import { useViewStore } from '../store/viewStore'
import { DEFAULT_OPEN_GROUPS, INSPECTOR_GROUPS, type InspectorGroupKey } from './inspectorGroups'
import { resolveScheduleDates } from './outlineColumns'
import { AssignmentSection } from './AssignmentSection'
import { ProjectInspector } from './ProjectInspector'
import { ResourceInspector } from './ResourceInspector'

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
  const [tab, setTab] = useState<'task' | 'project' | 'resource'>('task')

  // 换任务时回到「任务」Tab（spec §2：选中任务时默认任务 Tab）
  useEffect(() => {
    setTab('task')
  }, [selectedTaskId])

  if (!project) return null

  const hasTask = Boolean(selectedTaskId && project.tasks[selectedTaskId])
  // 未选任务时默认「项目」Tab（右栏不塌陷），但允许手动切到「资源」Tab
  const value: 'task' | 'project' | 'resource' = hasTask ? tab : tab === 'resource' ? 'resource' : 'project'

  return (
    <Box
      w="100%"
      p="md"
      style={{ overflowY: 'auto', flexShrink: 0 }}
      data-testid="inspector"
    >
      <Text fz="xs" fw={650} c="dimmed" tt="uppercase" mb="sm">
        {value === 'task'
          ? t('inspector.title')
          : value === 'resource'
            ? t('inspector.resourceTitle')
            : t('inspector.projectTitle')}
      </Text>

      {/* keepMounted={false}：Mantine 9 的 Tabs 默认常驻挂载非活动面板（keepMounted: true），
          于是「任务」与「项目」两个面板会同时在 DOM 里 —— 两者都有一个 label 叫「名称」的
          输入框，`getByLabelText('名称')` 会命中两个而抛错，且隐藏面板里的表单控件仍参与
          可访问性树。显式关掉挂载，让「面板不显示 = 不挂载」成立：既消除了重名 label，
          也满足既有单测「切到项目 Tab 后任务面板不在 DOM」的断言。 */}
      <Tabs
        keepMounted={false}
        value={value}
        onChange={(next) => setTab(next as 'task' | 'project' | 'resource')}
      >
        <Tabs.List mb="sm">
          <Tabs.Tab value="task" disabled={!hasTask} data-testid="inspector-tab-task">
            {t('inspector.tabs.task')}
          </Tabs.Tab>
          <Tabs.Tab value="project" data-testid="inspector-tab-project">
            {t('inspector.tabs.project')}
          </Tabs.Tab>
          <Tabs.Tab value="resource" data-testid="inspector-tab-resource">
            {t('inspector.tabs.resource')}
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="task" data-testid="inspector-task-panel">
          {hasTask ? <TaskPanel taskId={selectedTaskId!} /> : null}
        </Tabs.Panel>

        <Tabs.Panel value="project" data-testid="inspector-project-panel">
          <ProjectInspector />
        </Tabs.Panel>

        <Tabs.Panel value="resource" data-testid="inspector-resource-panel">
          <ResourceInspector />
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
        return <BaselineGroup taskId={taskId} isSummary={isSummary} />
      case 'assignments':
        // 任务侧入口：与 Task 7 的资源面板共用同一个 AssignmentSection（spec §4.2）
        return <AssignmentSection scope={{ kind: 'task', id: taskId }} />
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

/**
 * 基线分组（v1.0 解禁）。**注意这是项目级的操作** —— 保存 / 切换 / 删除基线作用于
 * 整个项目，只是按 spec §3 的指定落在任务面板的「基线」组里。
 *
 * 数据源一律是引擎派生的 `result.baselineDiffs`（Task 2）与 `project.baselines` 本身，
 * 绝不在 UI 里重算「当前 − 基线」的工作日数（那是同一条规则的第二份实现）。
 */
function BaselineGroup({ taskId, isSummary }: { taskId: TaskId; isSummary: boolean }) {
  const { t } = useTranslation()
  const project = useProjectStore((state) => state.project)!
  const dispatch = useProjectStore((state) => state.dispatch)
  const diff = useScheduleStore((state) => state.result.baselineDiffs[taskId])

  const baselines = project.baselines
  const active = baselines.find((baseline) => baseline.id === project.activeBaselineId)

  // 基线里有、但项目里已不存在的任务 —— 逐个列出并标注「已删除」（spec §1.2 / 判据 2）。
  // **不级联删除**条目是刻意的：基线是历史记录。靠条目里存的 name 才能辨认（偏差 1 / D9）。
  const deletedEntries = active
    ? Object.entries(active.entries).filter(([id]) => !project.tasks[id])
    : []

  return (
    <Stack gap="sm" data-testid="inspector-baseline">
      <Select
        label={t('inspector.baseline.active')}
        data-testid="baseline-select"
        value={project.activeBaselineId}
        disabled={baselines.length === 0}
        data={[
          { value: '', label: t('inspector.baseline.none') },
          ...baselines.map((baseline) => ({ value: baseline.id, label: baseline.name })),
        ]}
        onChange={(value) => {
          // 换基线是交互边界：打断合并，与 viewStore.selectTask 同惯例
          useProjectStore.getState().breakCoalescing()
          dispatch({
            type: 'project.setActiveBaseline',
            label: 'commands.project.setActiveBaseline',
            payload: { baselineId: value ? value : null },
          })
        }}
      />

      <Group gap="xs" wrap="nowrap">
        <Button
          size="xs"
          variant="light"
          data-testid="baseline-save"
          onClick={() =>
            dispatch({
              type: 'project.setBaseline',
              label: 'commands.project.setBaseline',
              // 名称由 UI 按当前语言给出 —— 领域层不产出自然语言
              payload: { name: t('inspector.baseline.name', { n: baselines.length + 1 }) },
            })
          }
        >
          {t('inspector.baseline.save')}
        </Button>
        {active && (
          <ActionIcon
            size="sm"
            variant="subtle"
            color="red"
            aria-label={t('inspector.baseline.delete')}
            data-testid="baseline-delete"
            onClick={() =>
              dispatch({
                type: 'project.deleteBaseline',
                label: 'commands.project.deleteBaseline',
                payload: { baselineId: active.id },
              })
            }
          >
            <IconTrash size={14} />
          </ActionIcon>
        )}
      </Group>

      {!active ? (
        <Text fz="xs" c="dimmed">
          {t('inspector.baseline.noBaseline')}
        </Text>
      ) : isSummary ? (
        // 快照只含叶子 → 摘要行没有差异（与 duration/progress 对摘要的惯例一致）
        <Text fz="xs" c="dimmed">
          {t('inspector.summaryHint')}
        </Text>
      ) : !diff ? (
        <Text fz="xs" c="dimmed">
          {t('inspector.baseline.noEntry')}
        </Text>
      ) : (
        <>
          <Text fz="xs" c="dimmed">
            {t('inspector.baseline.start')}: {diff.baselineStart}
          </Text>
          <Text fz="xs" c="dimmed">
            {t('inspector.baseline.finish')}: {diff.baselineFinish}
          </Text>
          <Text fz="xs" c="dimmed" data-testid="baseline-start-variance">
            {t('inspector.baseline.startVariance')}:{' '}
            {t('outline.cell.days', { count: diff.startVariance ?? 0 })}
          </Text>
          <Text fz="xs" c="dimmed" data-testid="baseline-finish-variance">
            {t('inspector.baseline.finishVariance')}:{' '}
            {t('outline.cell.days', { count: diff.finishVariance ?? 0 })}
          </Text>
        </>
      )}

      {deletedEntries.length > 0 && (
        <Alert color="yellow" p="xs" data-testid="baseline-deleted">
          <Text fz="xs">{t('inspector.baseline.deletedCount', { count: deletedEntries.length })}</Text>
          {deletedEntries.map(([id, entry]) => (
            <Text key={id} fz="xs" data-testid="baseline-deleted-entry">
              {t('inspector.baseline.deletedEntry', { name: entry.name })} · {entry.start} →{' '}
              {entry.finish}
            </Text>
          ))}
        </Alert>
      )}
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

  // 投入 / 剩余 / 三种成本 = **引擎派生的只读量**（spec §4.3）：直接读 solve() 的输出，
  // 不在 UI 里重算 —— 重算就会与「排期用的那份」漂移成两个真相。
  const result = useScheduleStore((state) => state.result)
  const effort = result.efforts[taskId] ?? 0
  const remaining = effort * (1 - task.progress / 100)
  const costs = result.costs[taskId] ?? { task: 0, resource: 0, total: 0 }

  const isGroup = task.kind === 'group'

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

      {/* 为什么不给「分组」一条可点的路径（计划偏差 1，spec §3.1 散文才是事实）：
          `kind === 'group'` 是**结构事实的派生** —— deriveKind 里 `childIds.length > 0 ⟺ group`
          是一条双向不变式（src/domain/model/kind.ts）。一条能手动把 task 置成 group 的命令会造出
          「kind 是 group 却没有子任务」的畸形任务，破坏该不变式。全仓也只有加子任务（task.indent）
          能间接走到 group。所以：group 选项恒 disabled（仅作「当前值」的展示），
          已经是 group 的任务整个 Select disabled（没有任何命令能改分组的类型）。这不是漏做的功能。 */}
      <Select
        label={t('inspector.kind')}
        value={task.kind}
        disabled={isGroup}
        data={[
          { value: 'task', label: t('inspector.kindTask') },
          { value: 'milestone', label: t('inspector.kindMilestone') },
          { value: 'group', label: t('inspector.kindGroup'), disabled: true },
        ]}
        onChange={(value) => {
          // 只有 task ↔ milestone 可切换，走既有命令（spec §3.1）
          if (value === 'task' || value === 'milestone') {
            dispatch({
              type: 'task.toggleMilestone',
              label: 'commands.task.toggleMilestone',
              payload: { taskId },
            })
          }
        }}
      />
      {isGroup && (
        <Text fz="xs" c="dimmed">
          {t('inspector.kindGroupHint')}
        </Text>
      )}

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

          {/* 工作量模式：固定工期 ↔ 固定工作量。切换走 task.setEffortMode（点击驱动、不合并） */}
          <Box>
            <Text fz="xs" fw={500} mb={4}>
              {t('inspector.effortMode')}
            </Text>
            <SegmentedControl
              size="xs"
              fullWidth
              value={task.effortMode}
              data-testid="effort-mode"
              onChange={(value) =>
                dispatch({
                  type: 'task.setEffortMode',
                  label: 'commands.task.setEffortMode',
                  payload: { taskId, effortMode: value as EffortMode },
                })
              }
              data={[
                {
                  value: 'fixedDuration',
                  label: (
                    <span data-testid="effort-mode-duration">
                      {t('inspector.effortModeDuration')}
                    </span>
                  ),
                },
                {
                  value: 'fixedEffort',
                  label: (
                    <span data-testid="effort-mode-effort">{t('inspector.effortModeEffort')}</span>
                  ),
                },
              ]}
            />
          </Box>

          {/* 固定工作量时才有「投入」输入 —— 它是反解的输入，改它才会改工期。
              此时**不再另渲染派生只读的「投入」**：同一个量出现两个同名控件，
              既是重复真相，也会让「按标签取值」的交互/测试歧义。 */}
          {task.effortMode === 'fixedEffort' && (
            <NumberInput
              label={t('inspector.effortInput')}
              min={0}
              value={task.effort ?? 0}
              onBlur={breakCoalescing}
              onChange={(value) =>
                dispatch({
                  type: 'task.setEffort',
                  label: 'commands.task.setEffort',
                  payload: { taskId, effort: Number(value) || 0 },
                  coalesceKey: `task.setEffort:${taskId}`,
                })
              }
            />
          )}

          {/* 以下五项是**引擎派生的只读量**：读 result.efforts / result.costs，不重算。
              「投入」只在固定工期下显示派生值（固定工作量下它就是上面那个输入框）。 */}
          {task.effortMode === 'fixedDuration' && (
            <NumberInput label={t('inspector.effort')} value={Math.round(effort * 100) / 100} disabled />
          )}
          <NumberInput
            label={t('inspector.remaining')}
            value={Math.round(remaining * 100) / 100}
            disabled
          />
          <NumberInput
            label={t('inspector.taskCost')}
            value={Math.round(costs.task * 100) / 100}
            disabled
          />
          <NumberInput
            label={t('inspector.resourceCost')}
            value={Math.round(costs.resource * 100) / 100}
            disabled
          />
          <NumberInput
            label={t('inspector.totalCost')}
            value={Math.round(costs.total * 100) / 100}
            disabled
          />
        </>
      )}
    </Stack>
  )
}

// 约束按「它钉住的是开始还是结束」分成两族 —— 决定哪个日期字段可编辑（偏差 3）
const START_TYPES: readonly ConstraintType[] = ['startOn', 'startNoEarlierThan', 'startNoLaterThan']
const FINISH_TYPES: readonly ConstraintType[] = [
  'finishOn',
  'finishNoEarlierThan',
  'finishNoLaterThan',
]

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

  const constraint = task.scheduling.mode === 'constraint' ? task.scheduling : null
  // 排期日期一律取引擎输出（v0.2 已把「方向 × 顺序」烤进 scheduledStart/Finish），
  // 不在 UI 里重新推方向 —— 那是引擎的职责。
  const dates = schedule ? resolveScheduleDates(schedule) : null

  // 一个任务只有**一条** Scheduling（{mode, type, date}），所以「对应族」的字段才可编辑：
  // start* 族 → 开始可编辑；finish* 族 → 结束可编辑；另一个显示派生排期值、只读。
  // 这样只有 Select 在设置 type，编辑日期不会偷换类型（偏差 2 + 3）。
  const startType = constraint && START_TYPES.includes(constraint.type) ? constraint.type : null
  const finishType = constraint && FINISH_TYPES.includes(constraint.type) ? constraint.type : null

  const startEditable = !isSummary && startType !== null
  const finishEditable = !isSummary && finishType !== null
  const startValue = startType ? constraint!.date : (dates?.start ?? '')
  const finishValue = finishType ? constraint!.date : (dates?.finish ?? '')

  return (
    <Stack gap="sm">
      {/* 合并的排期方式 Select（偏差 2）：一个控件同时设 mode 与 type。
          auto + 6 种 ConstraintType —— 它就是全 App 唯一在设置约束的控件。 */}
      <Select
        label={t('inspector.scheduling')}
        value={constraint ? constraint.type : 'auto'}
        // 摘要任务的日期由子任务汇总 —— task.setScheduling 对 group 本就是 no-op，
        // 这里禁用是为了不出现「点了没反应」的控件（分批原则）
        disabled={isSummary}
        data={[
          { value: 'auto', label: t('scheduling.auto') },
          ...CONSTRAINT_TYPES.map((type) => ({ value: type, label: t(`scheduling.${type}`) })),
        ]}
        onChange={(value) => {
          if (!value || isSummary) return
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
                // 新约束的日期取「用户看到的开始日」，与下方字段同口径
                date: dates?.start ?? project.startDate,
              },
            },
          })
        }}
      />

      {constraint && (
        <Text fz="xs" c="dimmed">
          {t('inspector.manualHint')}
        </Text>
      )}

      <TextInput
        type="date"
        label={t('inspector.start')}
        value={startValue}
        disabled={!startEditable}
        onBlur={breakCoalescing}
        onChange={(event) => {
          // 只改日期、不改类型：startType 来自当前约束，绝不在编辑时改写它
          if (!startType) return
          dispatch({
            type: 'task.setScheduling',
            label: 'commands.task.setScheduling',
            payload: {
              taskId,
              scheduling: { mode: 'constraint', type: startType, date: event.target.value },
            },
            coalesceKey: `task.setScheduling:${taskId}`,
          })
        }}
      />

      <TextInput
        type="date"
        label={t('inspector.finish')}
        value={finishValue}
        disabled={!finishEditable}
        onBlur={breakCoalescing}
        onChange={(event) => {
          if (!finishType) return
          dispatch({
            type: 'task.setScheduling',
            label: 'commands.task.setScheduling',
            payload: {
              taskId,
              scheduling: { mode: 'constraint', type: finishType, date: event.target.value },
            },
            coalesceKey: `task.setScheduling:${taskId}`,
          })
        }}
      />

      <Box>
        <Text fz="xs" fw={500} mb={4}>
          {t('inspector.order')}
        </Text>
        {/* 点击驱动 → 不传合并键（命令层注释里登记的约定） */}
        <SegmentedControl
          size="xs"
          fullWidth
          value={task.schedulingOrder}
          disabled={isSummary}
          data-testid="task-order"
          onChange={(value) =>
            dispatch({
              type: 'task.setSchedulingOrder',
              label: 'commands.task.setSchedulingOrder',
              payload: { taskId, order: value as SchedulingOrder },
            })
          }
          data={[
            { value: 'asap', label: <span data-testid="order-asap">{t('inspector.orderAsap')}</span> },
            { value: 'alap', label: <span data-testid="order-alap">{t('inspector.orderAlap')}</span> },
          ]}
        />
      </Box>

      {/* 拆分排期尚未实现：渲染成禁用态并注明版本，而不是隐藏（分批原则） */}
      <Stack gap={2}>
        <Checkbox
          label={t('inspector.allowSplitting')}
          disabled
          readOnly
          checked={task.allowSplitting}
        />
        <Text fz="xs" c="dimmed">
          {t('inspector.allowSplittingHint')}
        </Text>
      </Stack>

      {/* 输入框驱动 → 必须带含 taskId 的合并键：否则「改 A 后改 B」会并成一条撤销 */}
      <NumberInput
        label={t('inspector.priority')}
        value={task.priority}
        onBlur={breakCoalescing}
        onChange={(value) =>
          dispatch({
            type: 'task.setPriority',
            label: 'commands.task.setPriority',
            payload: { taskId, priority: Number(value) || 0 },
            coalesceKey: `task.setPriority:${taskId}`,
          })
        }
      />
      <Text fz="xs" c="dimmed">
        {t('inspector.priorityHint')}
      </Text>

      {/* 摘要任务禁用「延迟」：task.setDelay 对 group 是 no-op（摘要不单独挪），
          不禁用就会留下一个「点了没反应」的输入框（违反分批原则）。
          ⚠️ 刻意**不**给上面的「优先级」加 disabled：task.setPriority 对摘要是**生效**的
          （备注与优先级对摘要同样有意义，见 taskCommands 的注释）。别来「统一」这个不对称。 */}
      <NumberInput
        label={t('inspector.delay')}
        min={0}
        disabled={isSummary}
        value={task.delay}
        onBlur={breakCoalescing}
        onChange={(value) =>
          dispatch({
            type: 'task.setDelay',
            label: 'commands.task.setDelay',
            payload: { taskId, delay: Number(value) || 0 },
            coalesceKey: `task.setDelay:${taskId}`,
          })
        }
      />
      <Text fz="xs" c="dimmed">
        {t('inspector.delayHint')}
      </Text>

      {schedule && (
        <Text fz="xs" c="dimmed">
          {t('inspector.slack', { count: schedule.totalSlack })}
          {schedule.isCritical && ` · ${t('inspector.critical')}`}
        </Text>
      )}
    </Stack>
  )
}

/**
 * 相关性（spec §3.4 + 偏差 6）：**一个** Accordion 分组，内含**两段**带标题的小节 ——
 * 必要条件（`toTaskId === taskId`，即指向本任务的前驱）与从属（`fromTaskId === taskId`，后继）。
 *
 * 两段是**同一份 Dependency 数据**的两个过滤方向，所以增删改只写一次（`RelationSection`），
 * 各自只在「往哪一头连线」上不同（`makePayload`）—— 防止两份必然漂移的重复真相。
 *
 * 注意：`task` 只出现在**类型**里、不从参数里解构 —— 本组用 taskId 就够（避免未使用变量）。
 */
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

  const incoming = Object.values(project.dependencies).filter((dep) => dep.toTaskId === taskId)
  const outgoing = Object.values(project.dependencies).filter((dep) => dep.fromTaskId === taskId)

  // 候选 = 全部叶子任务里，尚未与本任务连过**同向**边的。
  // 「同向」是关键：A→本任务 与 本任务→A 是两条合法的边（图上有向），
  // 所以前驱的已连集只看 incoming、后继只看 outgoing —— 两个方向各自过滤，互不牵连。
  const leaves = Object.values(project.tasks).filter(
    (candidate) => candidate.childIds.length === 0 && candidate.id !== taskId,
  )
  const predecessorOptions = leaves
    .filter((candidate) => !incoming.some((dep) => dep.fromTaskId === candidate.id))
    .map((candidate) => ({ value: candidate.id, label: candidate.name }))
  const successorOptions = leaves
    .filter((candidate) => !outgoing.some((dep) => dep.toTaskId === candidate.id))
    .map((candidate) => ({ value: candidate.id, label: candidate.name }))

  return (
    <Stack gap="md">
      <RelationSection
        testId="relation-predecessors"
        addTestId="add-predecessor"
        title={t('inspector.relations.predecessors')}
        emptyLabel={t('inspector.relations.none')}
        addLabel={t('inspector.relations.addPredecessor')}
        taskId={taskId}
        deps={incoming}
        options={isSummary ? [] : predecessorOptions}
        makePayload={(otherId) => ({ fromTaskId: otherId, toTaskId: taskId })}
      />
      <RelationSection
        testId="relation-successors"
        addTestId="add-successor"
        title={t('inspector.relations.successors')}
        emptyLabel={t('inspector.relations.none')}
        addLabel={t('inspector.relations.addSuccessor')}
        taskId={taskId}
        deps={outgoing}
        options={isSummary ? [] : successorOptions}
        makePayload={(otherId) => ({ fromTaskId: taskId, toTaskId: otherId })}
      />
    </Stack>
  )
}

/** 一段相关性（必要条件 或 从属）：逐条依赖 + 一个「添加」下拉。
 *  两段共用这一套增删改（改类型 / 改 lag / 删除都走同一份 dispatch），
 *  段与段的唯一差异是 `title`/`emptyLabel`/`addLabel`/`deps`/`options`/`makePayload`。 */
function RelationSection({
  testId,
  addTestId,
  title,
  emptyLabel,
  addLabel,
  taskId,
  deps,
  options,
  makePayload,
}: {
  testId: string
  addTestId: string
  title: string
  emptyLabel: string
  addLabel: string
  taskId: TaskId
  deps: Dependency[]
  options: { value: string; label: string }[]
  makePayload: (otherId: TaskId) => { fromTaskId: TaskId; toTaskId: TaskId }
}) {
  const { t } = useTranslation()
  const project = useProjectStore((state) => state.project)!
  const dispatch = useProjectStore((state) => state.dispatch)
  const breakCoalescing = useProjectStore((state) => state.breakCoalescing)

  return (
    <Stack gap={4} data-testid={testId}>
      <Text fz="xs" fw={650} c="dimmed">
        {title}
      </Text>

      {deps.length === 0 && (
        <Text fz="xs" c="dimmed" pl="xs">
          {emptyLabel}
        </Text>
      )}

      {deps.map((dep) => {
        const otherId = dep.toTaskId === taskId ? dep.fromTaskId : dep.toTaskId
        const otherName = project.tasks[otherId]?.name ?? t('inspector.deletedTask')
        return (
          <Group key={dep.id} gap={4} wrap="nowrap">
            <Text fz="xs" truncate style={{ flex: 1 }}>
              {otherName}
            </Text>
            <Select
              size="xs"
              w={72}
              aria-label={`${title} ${otherName}`}
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

      {options.length > 0 && (
        <Select
          size="xs"
          label={addLabel}
          placeholder={t('inspector.relations.selectTask')}
          value={null}
          data={options}
          // 两段下拉的候选集相同（同一个叶子任务在两个方向都可连），而 Mantine 把下拉渲染进
          // portal 且 keepMounted（关闭时仍在 DOM），单靠 role=option 会命中两个同名项。
          // 给这段的候选容器挂 testid，测试用 within(getByTestId(addTestId)) 精确定位 ——
          // 不再依赖 Mantine 内部的 aria-controls / id 注入时机（scrollAreaProps 是公开 API）。
          // 类型断言仅因 ScrollAreaProps 未放开任意 data-*（JSX 允许，对象字面量不许）。
          scrollAreaProps={{ 'data-testid': addTestId } as ScrollAreaProps}
          onChange={(otherId) => {
            if (!otherId) return
            dispatch({
              type: 'dependency.create',
              label: 'commands.dependency.create',
              payload: { ...makePayload(otherId), type: 'FS' as DependencyType, lag: 0 },
            })
          }}
        />
      )}
    </Stack>
  )
}
