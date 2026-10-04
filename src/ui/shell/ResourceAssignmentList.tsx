import { useState } from 'react'
import { ActionIcon, Box, Button, Checkbox, Divider, Group, Stack, Text, TextInput } from '@mantine/core'
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

import type { ResourceId } from '../../domain/model/types'
import type { AssignmentGroup, AssignmentLeaf } from '../shared/assignmentGroups'

export interface ResourceAssignmentListProps {
  groups: AssignmentGroup[]
  ungrouped: AssignmentLeaf[]
  /** 参与操作的叶子任务数 —— 「全选」的阈值 */
  taskCount: number
  onToggle: (resourceId: ResourceId) => void
  onClear: () => void
  /** 选中任务集合里是否已有任意分配 —— 决定「清除分配」可用性 */
  hasAnyAssignment: boolean
}

/**
 * 三态判定（spec §4）：`assignedCount` 是「该资源被多少个选中任务分配」。
 *   taskCount > 0 且全体都有 → 全选；部分有 → 半选；都没有 → 未选。
 */
export function checkboxState(
  leaf: AssignmentLeaf,
  taskCount: number,
): { checked: boolean; indeterminate: boolean } {
  if (taskCount > 0 && leaf.assignedCount >= taskCount) return { checked: true, indeterminate: false }
  if (leaf.assignedCount > 0) return { checked: false, indeterminate: true }
  return { checked: false, indeterminate: false }
}

/**
 * 快速分配下拉的**纯展示**部分（spec §3）：只吃数据 + 回调，不读 store —— 便于单测。
 * 搜索与折叠是**本组件内的展示态**（不写 store、不产生命令）。
 * 过滤态下**强制展开**命中的组（否则搜到了却看不见成员）。
 */
export function ResourceAssignmentList({
  groups,
  ungrouped,
  taskCount,
  onToggle,
  onClear,
  hasAnyAssignment,
}: ResourceAssignmentListProps) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())

  const query = search.trim().toLowerCase()
  const matches = (name: string): boolean => name.toLowerCase().includes(query)
  const filtering = query !== ''

  const visibleGroups = groups
    .map((group) =>
      matches(group.name)
        ? group
        : { ...group, members: group.members.filter((member) => matches(member.name)) },
    )
    .filter((group) => matches(group.name) || group.members.length > 0)
  const visibleUngrouped = ungrouped.filter((leaf) => matches(leaf.name))

  const hasResources = groups.length > 0 || ungrouped.length > 0
  const isEmpty = visibleGroups.length === 0 && visibleUngrouped.length === 0

  const toggleGroup = (id: string): void => {
    const next = new Set(collapsed)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setCollapsed(next)
  }

  const renderLeaf = (leaf: AssignmentLeaf) => {
    const state = checkboxState(leaf, taskCount)
    return (
      <Checkbox
        key={leaf.id}
        size="xs"
        ml="lg"
        data-testid={`assignment-resource-${leaf.id}`}
        label={leaf.name}
        checked={state.checked}
        indeterminate={state.indeterminate}
        onChange={() => onToggle(leaf.id)}
      />
    )
  }

  return (
    <Stack gap="xs" w={260} data-testid="assignment-list">
      <TextInput
        size="xs"
        data-testid="assignment-search"
        placeholder={t('assignmentMenu.searchPlaceholder')}
        value={search}
        onChange={(event) => setSearch(event.currentTarget.value)}
      />

      {!hasResources ? (
        <Text fz="xs" c="dimmed">
          {t('assignmentMenu.empty')}
        </Text>
      ) : isEmpty ? (
        <Text fz="xs" c="dimmed" data-testid="assignment-no-results">
          {t('assignmentMenu.noResults')}
        </Text>
      ) : (
        <Stack gap={4}>
          {visibleGroups.map((group) => {
            const isCollapsed = !filtering && collapsed.has(group.id)
            return (
              <Box key={group.id}>
                <Group gap={4} wrap="nowrap">
                  <ActionIcon
                    size="xs"
                    variant="subtle"
                    aria-label={group.name}
                    data-testid={`assignment-group-toggle-${group.id}`}
                    onClick={() => toggleGroup(group.id)}
                  >
                    {isCollapsed ? <IconChevronRight size={12} /> : <IconChevronDown size={12} />}
                  </ActionIcon>
                  <Text fz="xs" fw={500} data-testid={`assignment-group-${group.id}`}>
                    {group.name} ·{' '}
                    {t('assignmentMenu.groupSummary', {
                      total: group.members.length,
                      assigned: group.assignedCount,
                    })}
                  </Text>
                </Group>
                {!isCollapsed && <Stack gap={4}>{group.members.map(renderLeaf)}</Stack>}
              </Box>
            )
          })}

          {visibleUngrouped.length > 0 && <Stack gap={4}>{visibleUngrouped.map(renderLeaf)}</Stack>}
        </Stack>
      )}

      <Divider />
      <Button
        size="xs"
        variant="subtle"
        color="red"
        data-testid="assignment-clear"
        disabled={!hasAnyAssignment}
        onClick={onClear}
      >
        {t('assignmentMenu.clear')}
      </Button>
    </Stack>
  )
}
