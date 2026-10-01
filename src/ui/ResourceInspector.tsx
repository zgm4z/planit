import { useState } from 'react'
import { ActionIcon, Group, NumberInput, Select, Stack, Text, TextInput } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import type { CommandType } from '../commands/types'
import type { ResourceKind } from '../domain/model/types'
import { useProjectStore } from '../store/projectStore'
import { useScheduleStore } from '../store/scheduleStore'
import { AssignmentSection } from './AssignmentSection'

const KINDS: ResourceKind[] = ['staff', 'equipment', 'material', 'group']

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

  /** 统一 dispatch 辅助：命令类型是联合字面量，这里显式收窄 */
  const send = (type: CommandType, label: string, payload: unknown, coalesceKey?: string) =>
    dispatch({ type, label, payload, coalesceKey } as Parameters<typeof dispatch>[0])

  if (!selected) {
    return (
      <Stack gap="sm">
        <Text fz="xs" c="dimmed">
          {t('resource.empty')}
        </Text>
        <ActionIcon
          variant="light"
          aria-label={t('resource.create')}
          onClick={() =>
            dispatch({
              type: 'resource.create',
              label: 'commands.resource.create',
              payload: { name: `${t('resource.name')} 1` },
            })
          }
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
          onClick={() =>
            dispatch({
              type: 'resource.create',
              label: 'commands.resource.create',
              payload: { name: `${t('resource.name')} ${resources.length + 1}` },
            })
          }
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
