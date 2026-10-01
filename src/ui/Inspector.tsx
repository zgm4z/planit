import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Accordion,
  ActionIcon,
  Alert,
  Box,
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
import { IconTrash } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

import type {
  ComputedSchedule,
  ConstraintType,
  DependencyType,
  SchedulingOrder,
  Task,
  TaskId,
} from '../domain/model/types'
import { useProjectStore } from '../store/projectStore'
import { useScheduleStore } from '../store/scheduleStore'
import { useViewStore } from '../store/viewStore'
import { DEFAULT_OPEN_GROUPS, INSPECTOR_GROUPS, type InspectorGroupKey } from './inspectorGroups'
import { resolveScheduleDates } from './outlineColumns'
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

          <DisabledField label={t('inspector.effort')} reason={t('inspector.disabledReason.effort')} />
          <DisabledField label={t('inspector.remaining')} reason={t('inspector.disabledReason.effort')} />
          <DisabledField label={t('inspector.taskCost')} reason={t('inspector.disabledReason.cost')} />
          <DisabledField label={t('inspector.resourceCost')} reason={t('inspector.disabledReason.cost')} />
          <DisabledField label={t('inspector.totalCost')} reason={t('inspector.disabledReason.cost')} />
        </>
      )}
    </Stack>
  )
}

/** 依赖未实现功能的字段：禁用态 + 注明版本（分批原则，绝不假装能用） */
function DisabledField({ label, reason }: { label: string; reason: string }) {
  return (
    <Stack gap={2}>
      <NumberInput label={label} disabled value={0} />
      <Text fz="xs" c="dimmed">
        {reason}
      </Text>
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
        title={t('inspector.relations.predecessors')}
        emptyLabel={t('inspector.relations.none')}
        addLabel={t('inspector.relations.addPredecessor')}
        taskId={taskId}
        deps={incoming}
        options={isSummary ? [] : predecessorOptions}
        makePayload={(otherId) => ({ fromTaskId: otherId, toTaskId: taskId })}
      />
      <RelationSection
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
  title,
  emptyLabel,
  addLabel,
  taskId,
  deps,
  options,
  makePayload,
}: {
  title: string
  emptyLabel: string
  addLabel: string
  taskId: TaskId
  deps: { id: string; fromTaskId: TaskId; toTaskId: TaskId; type: DependencyType; lag: number }[]
  options: { value: string; label: string }[]
  makePayload: (otherId: TaskId) => { fromTaskId: TaskId; toTaskId: TaskId }
}) {
  const { t } = useTranslation()
  const project = useProjectStore((state) => state.project)!
  const dispatch = useProjectStore((state) => state.dispatch)
  const breakCoalescing = useProjectStore((state) => state.breakCoalescing)

  return (
    <Stack gap={4}>
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
