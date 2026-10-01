import { useState } from 'react'
import { ActionIcon, Button, Group, NumberInput, Select, Stack, Text, TextInput } from '@mantine/core'
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
} from '../commands/resourceCommands'
import type { ResourceKind } from '../domain/model/types'
import { useProjectStore } from '../store/projectStore'
import { useScheduleStore } from '../store/scheduleStore'
import { AssignmentSection } from './AssignmentSection'

const KINDS: ResourceKind[] = ['staff', 'equipment', 'material', 'group']

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
 * **选中态是本面板的局部状态**（偏差 7）：本版没有资源视图（spec §7），把选中态
 * 放进 store 只会凭空多一个无处消费的字段。换资源时调 `breakCoalescing()` ——
 * 与 `viewStore.selectTask` 同一惯例（否则「改 A 的邮件 → 换到 B → 改 B 的邮件」
 * 会并成一条撤销）。
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

  const resources = Object.values(project.resources)
  const [selectedId, setSelectedId] = useState<string | null>(null)
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
   * `resource.create` 的 id 由命令层 `nextId('res')` 生成，payload 不接受 id、命令也不
   * 回传新 id（见 resourceCommands.ts），因此在 UI 侧无法预知。这里用 dispatch 前后
   * resources 的 **key 差集**定位刚建的那一个。dispatch 是同步的，`getState()` 读到的
   * 已是新状态，选中态立即生效，无需等下一次渲染。
   */
  const handleCreate = () => {
    const before = new Set(Object.keys(project.resources))
    dispatch({
      type: 'resource.create',
      label: 'commands.resource.create',
      payload: { name: `${t('resource.name')} ${resources.length + 1}` },
    })
    const after = useProjectStore.getState().project?.resources ?? {}
    const newId = Object.keys(after).find((id) => !before.has(id))
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
      <Stack gap="sm">
        <Text fz="xs" c="dimmed">
          {t('resource.empty')}
        </Text>
        <ActionIcon
          variant="light"
          aria-label={t('resource.create')}
          onClick={handleCreate}
        >
          +
        </ActionIcon>
      </Stack>
    )
  }

  const totals = resourceTotals[selected.id] ?? { assignments: 0, hours: 0, cost: 0 }

  return (
    <Stack gap="sm">
      <Group gap="xs" wrap="nowrap" align="flex-end">
        <Select
          label={t('resource.select')}
          value={selected.id}
          style={{ flex: 1 }}
          data={resources.map((resource) => ({ value: resource.id, label: resource.name }))}
          onChange={(value) => {
            // 换资源 = 交互边界：打断合并，否则跨资源的连续编辑会塌缩成一条撤销
            breakCoalescing()
            setSelectedId(value)
          }}
        />
        <ActionIcon
          variant="light"
          aria-label={t('resource.create')}
          onClick={handleCreate}
        >
          +
        </ActionIcon>
      </Group>

      <TextInput
        label={t('resource.name')}
        value={selected.name}
        onBlur={breakCoalescing}
        onChange={(event) =>
          send('resource.rename', 'commands.resource.rename', { resourceId: selected.id, name: event.target.value }, `resource.rename:${selected.id}`)
        }
      />

      <TextInput
        label={t('resource.email')}
        value={selected.email ?? ''}
        onBlur={breakCoalescing}
        onChange={(event) =>
          send('resource.setEmail', 'commands.resource.setEmail', { resourceId: selected.id, email: event.target.value }, `resource.setEmail:${selected.id}`)
        }
      />

      <Select
        label={t('resource.kind')}
        value={selected.kind}
        data={KINDS.map((kind) => ({ value: kind, label: t(`resource.kind_${kind}`) }))}
        onChange={(value) =>
          value && send('resource.setKind', 'commands.resource.setKind', { resourceId: selected.id, kind: value as ResourceKind })
        }
      />

      <NumberInput
        label={t('resource.availability')}
        min={0}
        max={100}
        value={Math.round(selected.availability * 100)}
        onBlur={breakCoalescing}
        onChange={(value) =>
          send('resource.setAvailability', 'commands.resource.setAvailability', { resourceId: selected.id, availability: (Number(value) || 0) / 100 }, `resource.setAvailability:${selected.id}`)
        }
      />

      <NumberInput
        label={t('resource.efficiency')}
        min={0}
        value={selected.efficiency ?? ''}
        onBlur={breakCoalescing}
        onChange={(value) =>
          send('resource.setEfficiency', 'commands.resource.setEfficiency', { resourceId: selected.id, efficiency: value === '' ? undefined : Number(value) }, `resource.setEfficiency:${selected.id}`)
        }
      />

      <TextInput
        type="date"
        label={t('resource.availableFrom')}
        value={selected.availableFrom ?? ''}
        onBlur={breakCoalescing}
        onChange={(event) =>
          send('resource.setAvailablePeriod', 'commands.resource.setAvailablePeriod', { resourceId: selected.id, availableFrom: event.target.value || undefined, availableUntil: selected.availableUntil }, `resource.setAvailablePeriod:${selected.id}`)
        }
      />

      <TextInput
        type="date"
        label={t('resource.availableUntil')}
        value={selected.availableUntil ?? ''}
        onBlur={breakCoalescing}
        onChange={(event) =>
          send('resource.setAvailablePeriod', 'commands.resource.setAvailablePeriod', { resourceId: selected.id, availableFrom: selected.availableFrom, availableUntil: event.target.value || undefined }, `resource.setAvailablePeriod:${selected.id}`)
        }
      />

      <NumberInput
        label={t('resource.usageCost')}
        min={0}
        value={selected.cost.usage ?? ''}
        onBlur={breakCoalescing}
        onChange={(value) =>
          send('resource.setCost', 'commands.resource.setCost', { resourceId: selected.id, cost: { ...selected.cost, usage: value === '' ? undefined : Number(value) } }, `resource.setCost:${selected.id}`)
        }
      />

      <NumberInput
        label={t('resource.hourlyCost')}
        min={0}
        value={selected.cost.hourly ?? ''}
        onBlur={breakCoalescing}
        onChange={(value) =>
          send('resource.setCost', 'commands.resource.setCost', { resourceId: selected.id, cost: { ...selected.cost, hourly: value === '' ? undefined : Number(value) } }, `resource.setCost:${selected.id}`)
        }
      />

      <TextInput
        label={t('resource.currency')}
        value={selected.cost.currency}
        onBlur={breakCoalescing}
        onChange={(event) =>
          send('resource.setCost', 'commands.resource.setCost', { resourceId: selected.id, cost: { ...selected.cost, currency: event.target.value } }, `resource.setCost:${selected.id}`)
        }
      />

      <Button
        color="red"
        variant="light"
        leftSection={<IconTrash size={16} />}
        onClick={handleDelete}
      >
        {t('resource.delete')}
      </Button>

      <Text fz="xs" c="dimmed">
        {t('resource.totalAssignments', { count: totals.assignments })}
      </Text>
      <Text fz="xs" c="dimmed">
        {t('resource.totalHours', { count: Math.round(totals.hours * 100) / 100 })}
      </Text>
      <Text fz="xs" c="dimmed">
        {t('resource.totalCost', { amount: Math.round(totals.cost * 100) / 100, currency: selected.cost.currency })}
      </Text>

      <AssignmentSection scope={{ kind: 'resource', id: selected.id }} />
    </Stack>
  )
}
