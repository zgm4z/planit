import { useId } from 'react'
import { Alert, Button, Group, Select, Stack, Text, TextInput } from '@mantine/core'
import { IconTrash } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

import type {
  ResourceRenamePayload,
  ResourceSetAvailablePeriodPayload,
  ResourceSetAvailabilityPayload,
  ResourceSetCostPayload,
  ResourceSetEfficiencyPayload,
  ResourceSetEmailPayload,
  ResourceSetKindPayload,
} from '../../commands/resourceCommands'
import type { ResourceKind } from '../../domain/model/types'
import { useProjectStore } from '../../store/projectStore'
import { useScheduleStore } from '../../store/scheduleStore'
import { useViewStore } from '../../store/viewStore'
import { createResourceAndGetId } from '../shared/resourceActions'
import { AssignmentSection } from './AssignmentSection'
import {
  DateField,
  FieldRow,
  GAP_BLOCK,
  GAP_INNER,
  NumberField,
  Section,
  StatList,
  StatRow,
} from './InspectorFields'
import { formatCost, formatDays, formatHours } from '../shared/format'
import styles from '../styles/Inspector.module.scss'

// 四种类型的运行时清单在 `domain/model/`（views 与 persist 也在用）
import { RESOURCE_KINDS as KINDS } from '../../domain/model/resourceKinds'

/**
 * `send` 只服务本面板里**输入框驱动**的资源命令。把「命令类型 → payload」钉在一张
 * 本地小表上，泛型参数就能让每个调用点的 payload 形状被真正检查 —— 否则 payload
 * 只能是 `unknown`，字段名写错（把 resourceId 拼成 id）编译器也不会报。
 *
 * 根因是全局的 `Command<P>` 不是按 type 收窄的可辨识联合；给**整个** CommandType
 * 建映射属于 commands/types.ts 的职责，不在本次改动范围，故此处只收本面板用到的这几条。
 */
interface ResourceCommandMap {
  'resource.rename': ResourceRenamePayload
  'resource.setKind': ResourceSetKindPayload
  'resource.setEmail': ResourceSetEmailPayload
  'resource.setAvailability': ResourceSetAvailabilityPayload
  'resource.setEfficiency': ResourceSetEfficiencyPayload
  'resource.setAvailablePeriod': ResourceSetAvailablePeriodPayload
  'resource.setCost': ResourceSetCostPayload
}

/**
 * 资源面板（spec §4.1）—— Inspector 的第三个 Tab。
 *
 * **选中态已提升到 `viewStore.selectedResourceId`**（原先的偏差 7 是「本面板局部状态」，
 * 现按需搬迁）：菜单栏的「资源 > 新建资源」必须能选中刚建好的资源，否则用户点了菜单
 * 看不到任何反应（违反核心原则「点了没反应比明确禁用更糟」）。提升后菜单栏与面板共用
 * 同一个选中态，两条路径都落在同一处。换资源时仍调 `breakCoalescing()`（挂在 Select 的
 * onChange 现场，不在 store 动作里）—— 与 `viewStore.selectTask` 同一惯例（否则
 * 「改 A 的邮件 → 换到 B → 改 B 的邮件」会并成一条撤销）。
 *
 * 选中态**不持久化**，且悬空 id（指向已删除资源）由下面 `selected` 的那行容错回落到
 * 第一个资源 —— 这条容错是对的（删资源后选中态归零、自动落到剩下资源），刻意保留。
 *
 * 「派生的总计」**只读引擎输出** `result.resourceTotals`（effort.ts 的 collectCosts
 * 算出），不在 UI 里重算 Σunits × 工期（那是同一条规则的第二份实现）。
 */
export function ResourceInspector() {
  const { t } = useTranslation()
  const project = useProjectStore((state) => state.project)!
  const dispatch = useProjectStore((state) => state.dispatch)
  const breakCoalescing = useProjectStore((state) => state.breakCoalescing)
  const resourceTotals = useScheduleStore((state) => state.result.resourceTotals)
  // v0.6：平衡后仍存在的超载（浮时耗尽 / 无可推候选）。数据源唯一：引擎的 leveling.unresolved
  const unresolved = useScheduleStore((state) => state.result.leveling.unresolved)
  // v0.7：平衡是否因**时间预算**提前收工。这与「尽力了但推不动」是两回事 ——
  // 前者是「再算一会儿可能有解」，后者是「再算也推不动」，不区分就是在骗用户。
  const budgetExhausted = useScheduleStore((state) => state.result.leveling.budgetExhausted)

  const resources = Object.values(project.resources)
  // 选中态来自 viewStore（菜单栏也要能改它）。悬空 id（删资源后残留）回落到第一个资源。
  const selectedId = useViewStore((state) => state.selectedResourceId)
  const setSelectedId = useViewStore((state) => state.selectResource)
  const selectId = useId()
  const kindId = useId()
  const selected = (selectedId ? project.resources[selectedId] : undefined) ?? resources[0]

  /** 统一 dispatch 辅助：泛型把 payload 与命令类型对上（见 ResourceCommandMap） */
  const send = <T extends keyof ResourceCommandMap>(
    type: T,
    label: string,
    payload: ResourceCommandMap[T],
    coalesceKey?: string,
  ) => dispatch({ type, label, payload, coalesceKey })

  /**
   * 新建资源并**立刻选中它**——「建完即改」是新建流程最自然的期望；
   * 不选中就会让用户下一眼（与下一次编辑）落在旧资源上。
   *
   * 命名与「拿到新 id」都交给共用的 `createResourceAndGetId`（菜单栏那条路径也走它）——
   * 这条手法不在两处各写一遍。
   */
  const handleCreate = () => {
    const newId = createResourceAndGetId(`${t('resource.name')} ${resources.length + 1}`)
    if (newId) setSelectedId(newId)
  }

  /**
   * 删除当前资源。`resource.delete` 会**级联清掉它的全部分配**（spec §5，Task 4 已实现），
   * 是破坏性操作；但不加二次确认——与「删任务」等既有破坏性操作一致，靠撤销兜底。
   * 删完把选中态归零：派生选择自然落到剩下资源里的第一个（全删光则进空态）。
   */
  const handleDelete = () => {
    if (!selected) return
    dispatch({
      type: 'resource.delete',
      label: 'commands.resource.delete',
      payload: { resourceId: selected.id },
    })
    setSelectedId(null)
  }

  if (!selected) {
    return (
      <Stack gap={GAP_BLOCK}>
        <Text fz="sm" c="dimmed">
          {t('resource.empty')}
        </Text>
        {/* 与主态的「新建」按钮同一形态（light 次级按钮，不是通栏实心方块） */}
        <Group>
          <Button variant="light" size="sm" onClick={handleCreate}>
            {t('resource.create')}
          </Button>
        </Group>
      </Stack>
    )
  }

  const totals = resourceTotals[selected.id] ?? { assignments: 0, hours: 0, cost: 0 }
  // 选中资源的超载单元（引擎已按 resourceId+date 归集）。UI 不重算负载，只过滤展示
  const overloads = unresolved.filter((overload) => overload.resourceId === selected.id)

  return (
    <Stack gap={GAP_BLOCK}>
      {/* 「选择资源」是面板的主体（它定义下面所有字段讲的是谁）；「新建」是它的
          尾部动作 —— 同排、同高、light 次级按钮。曾经那个通栏靛蓝实心方块是面板里
          最抢眼的东西，与内容抢注意力，与「先看清资源」的诉求相悖。 */}
      <Group gap="xs" wrap="nowrap" align="center">
        <div style={{ flex: 1 }}>
          <FieldRow label={t('resource.select')} controlId={selectId}>
            <Select
              id={selectId}
              value={selected.id}
              data={resources.map((resource) => ({ value: resource.id, label: resource.name }))}
              onChange={(value) => {
                // 换资源 = 交互边界：打断合并，否则跨资源的连续编辑会塌缩成一条撤销
                breakCoalescing()
                setSelectedId(value)
              }}
            />
          </FieldRow>
        </div>
        <Button variant="light" size="sm" onClick={handleCreate}>
          {t('resource.create')}
        </Button>
      </Group>

      {/* 超载 = 本面板的头号信号，**分组之外、且在主体之后** —— 与任务面板的冲突
          Alert 同位置同体例（都在「这是哪个主体」之后、「分组」之前）。
          排序理由（IA）：超载讲的是**某个资源**的状态，因此必须先让用户看到
          「这是哪个资源」（选择器），状态再出场；曾把它放在选择器之前，是「状态先于
          主体」，读起来突兀。它也确实必须排在 8 个字段之上 —— 「这个资源超载了」是
          先于一切字段该被看到的事实（§3.1 的「信号」层）。
          无超载时**不喧哗**：同位置只留一行 xs/dimmed 的确认，不动用信号色。
          为什么保留而非删掉它：超载数=0 是**算出来的 0**（§3.3 的第三类），与
          「引擎没跑 / 无此概念」必须可分；留白会让二者混为一谈。 */}
      {overloads.length > 0 ? (
        <Alert color="red" p="xs" data-testid="resource-overload">
          {t('resource.overload', { count: formatDays(overloads.length) ?? '—' })}
        </Alert>
      ) : (
        <Text fz="xs" c="dimmed">
          {t('resource.noOverload')}
        </Text>
      )}

      {/* 提前收工的**独立**告知：上面那行只说「还剩多少超载」，不说「为什么没消除」。
          预算耗尽时结果是「当前最优解」而非「已尽力」，用户据此判断该不该等/该不该降规模。 */}
      {budgetExhausted ? (
        <Alert color="yellow" p="xs" data-testid="leveling-budget-exhausted">
          {t('resource.budgetExhausted')}
        </Alert>
      ) : null}

      {/* ── 基本信息 ── 名称 / 类型 / 电子邮件。
          排序按「使用频率 × 重要性」：名称必填、类型（人员/设备/素材/群组）常改且
          影响语义，靠前；电子邮件**多数为空**，降到本组末位，不再占住第二行。 */}
      <Section title={t('resource.groups.info')}>
        <Stack gap={GAP_INNER}>
          <TextInputField
            label={t('resource.name')}
            value={selected.name}
            onBlur={breakCoalescing}
            onChange={(name) =>
              send(
                'resource.rename',
                'commands.resource.rename',
                { resourceId: selected.id, name },
                `resource.rename:${selected.id}`,
              )
            }
          />

          <FieldRow label={t('resource.kind')} controlId={kindId}>
            <Select
              id={kindId}
              value={selected.kind}
              data={KINDS.map((kind) => ({ value: kind, label: t(`resource.kind_${kind}`) }))}
              onChange={(value) =>
                value &&
                send('resource.setKind', 'commands.resource.setKind', {
                  resourceId: selected.id,
                  kind: value as ResourceKind,
                })
              }
            />
          </FieldRow>

          <TextInputField
            label={t('resource.email')}
            value={selected.email ?? ''}
            onBlur={breakCoalescing}
            onChange={(email) =>
              send(
                'resource.setEmail',
                'commands.resource.setEmail',
                { resourceId: selected.id, email },
                `resource.setEmail:${selected.id}`,
              )
            }
          />
        </Stack>
      </Section>

      {/* ── 可用性 ── 可用率 / 效率 / 可用期。
          这四个是「这台资源什么时候、以多大力气可用」的同一族输入，此前被拆成两个
          无名块（可用率+效率 / 起止日期）中间的层级断裂，现在合成一个语义组。 */}
      <Section title={t('resource.groups.availability')}>
        <Stack gap={GAP_INNER}>
          <NumberField
            label={t('resource.availability')}
            digits={0}
            min={0}
            max={100}
            value={Math.round(selected.availability * 100)}
            onBlur={breakCoalescing}
            onChange={(value) =>
              send(
                'resource.setAvailability',
                'commands.resource.setAvailability',
                { resourceId: selected.id, availability: (value ?? 0) / 100 },
                `resource.setAvailability:${selected.id}`,
              )
            }
          />

          <NumberField
            label={t('resource.efficiency')}
            digits={2}
            min={0}
            allowEmpty
            value={selected.efficiency}
            onBlur={breakCoalescing}
            onChange={(value) =>
              send(
                'resource.setEfficiency',
                'commands.resource.setEfficiency',
                { resourceId: selected.id, efficiency: value },
                `resource.setEfficiency:${selected.id}`,
              )
            }
          />

          <DateField
            label={t('resource.availableFrom')}
            value={selected.availableFrom ?? ''}
            clearable
            onBlur={breakCoalescing}
            onChange={(next) =>
              send(
                'resource.setAvailablePeriod',
                'commands.resource.setAvailablePeriod',
                {
                  resourceId: selected.id,
                  availableFrom: next || undefined,
                  availableUntil: selected.availableUntil,
                },
                `resource.setAvailablePeriod:${selected.id}`,
              )
            }
          />

          <DateField
            label={t('resource.availableUntil')}
            value={selected.availableUntil ?? ''}
            clearable
            onBlur={breakCoalescing}
            onChange={(next) =>
              send(
                'resource.setAvailablePeriod',
                'commands.resource.setAvailablePeriod',
                {
                  resourceId: selected.id,
                  availableFrom: selected.availableFrom,
                  availableUntil: next || undefined,
                },
                `resource.setAvailablePeriod:${selected.id}`,
              )
            }
          />
        </Stack>
      </Section>

      {/* ── 成本 ── 费率（可编辑）＋ 派生的总计（只读事实行）。
          费率与总计分开两块：前者是**控件**（有边框、能改），后者是**数据**（平排、
          等宽、右对齐）—— §3.3 的「方块 = 能改，平排 = 事实」，一眼可分。 */}
      <Section title={t('resource.groups.cost')}>
        <Stack gap={GAP_BLOCK}>
          <Stack gap={GAP_INNER}>
            <NumberField
              label={t('resource.usageCost')}
              digits={0}
              min={0}
              allowEmpty
              value={selected.cost.usage}
              onBlur={breakCoalescing}
              onChange={(value) =>
                send(
                  'resource.setCost',
                  'commands.resource.setCost',
                  { resourceId: selected.id, cost: { ...selected.cost, usage: value } },
                  `resource.setCost:${selected.id}`,
                )
              }
            />

            <NumberField
              label={t('resource.hourlyCost')}
              digits={0}
              min={0}
              allowEmpty
              value={selected.cost.hourly}
              onBlur={breakCoalescing}
              onChange={(value) =>
                send(
                  'resource.setCost',
                  'commands.resource.setCost',
                  { resourceId: selected.id, cost: { ...selected.cost, hourly: value } },
                  `resource.setCost:${selected.id}`,
                )
              }
            />

            <TextInputField
              label={t('resource.currency')}
              value={selected.cost.currency}
              onBlur={breakCoalescing}
              onChange={(currency) =>
                send(
                  'resource.setCost',
                  'commands.resource.setCost',
                  { resourceId: selected.id, cost: { ...selected.cost, currency } },
                  `resource.setCost:${selected.id}`,
                )
              }
            />
          </Stack>

          {/* 派生总计：**只读事实块**（§3.3）—— 数字过 format*，值/单位不再各自四舍五入。
              改 StatRow 后「标签 / 值」分列（此前挤在一句「总使用次数：0」里），
              与任务面板的投入 / 剩余 / 成本同一种读法。 */}
          <StatList>
            <StatRow
              label={t('resource.totalAssignments')}
              value={formatDays(totals.assignments) ?? '—'}
              testId="resource-total-assignments"
            />
            <StatRow
              label={t('resource.totalHours')}
              value={formatHours(totals.hours) ?? '—'}
              testId="resource-total-hours"
            />
            <StatRow
              label={t('resource.totalCost')}
              value={`${formatCost(totals.cost) ?? '—'} ${selected.cost.currency}`}
              testId="resource-total-cost"
            />
          </StatList>
        </Stack>
      </Section>

      {/* ── 分配 ── 复用 AssignmentSection（不重写）。 */}
      <Section title={t('resource.groups.assignments')}>
        <AssignmentSection scope={{ kind: 'resource', id: selected.id }} />
      </Section>

      {/* 删除：留在底部，但降噪 —— 静止中性、悬停才转危险色（§4.2 第 2 条）。
          独占一行且与最后一个字段隔 24px，不会被误读成某个字段的附属动作。 */}
      <Group>
        <Button
          variant="subtle"
          size="sm"
          className={styles.dangerAction}
          leftSection={<IconTrash size={16} />}
          onClick={handleDelete}
        >
          {t('resource.delete')}
        </Button>
      </Group>
    </Stack>
  )
}

/**
 * 一个薄薄的文本输入框：把 onChange 的取值从 event 里剥出来，让调用点只描述
 * 「这个字段写回什么」—— 与 DateField / NumberField 三个形态同构，读起来一致；
 * 并同样落在 FieldRow 栅格上（标签左 / 值右，§3.4）。
 */
function TextInputField({
  label,
  value,
  onChange,
  onBlur,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
}) {
  const id = useId()
  return (
    <FieldRow label={label} controlId={id}>
      <TextInput
        id={id}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        onBlur={onBlur}
      />
    </FieldRow>
  )
}
