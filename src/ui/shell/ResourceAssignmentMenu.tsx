import { useMemo, useState } from 'react'
import { ActionIcon, Menu, Tooltip } from '@mantine/core'
import { IconUserPlus } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

import type { ResourceId, TaskId } from '../../domain/model/types'
import { useProjectStore } from '../../store/projectStore'
import { useViewStore } from '../../store/viewStore'
import { buildAssignmentTree } from '../shared/assignmentGroups'
import { ResourceAssignmentList } from './ResourceAssignmentList'

/** 批量命令的确定性指纹 = 本次涉及的选中任务集合（排序后） */
function fingerprintOf(taskIds: readonly TaskId[]): string {
  return [...taskIds].sort().join(',')
}

/**
 * 工具栏「快速分配」下拉（spec §3）：对**全部选中任务**批量增删 `units = 1.0` 的分配。
 *
 * 与右栏 `AssignmentSection` 的分工（spec §8 的有意例外）：工具栏 = 快速勾选/取消，
 * units 固定 1.0；右栏 = 完整编辑（含 units 与精确删除）。两条路径各自有组件测试。
 *
 * 批量动作共用一个 `coalesceKey` → `mergeIntoStack` 把它们塌成**一条**撤销记录，
 * 一次 Ctrl+Z 全部恢复（判据 6 / 9）。批量前 `breakCoalescing()`，避免与上一步无关编辑合并。
 */
export function ResourceAssignmentMenu() {
  const { t } = useTranslation()
  const project = useProjectStore((state) => state.project)
  const dispatch = useProjectStore((state) => state.dispatch)
  const breakCoalescing = useProjectStore((state) => state.breakCoalescing)
  const selectedTaskIds = useViewStore((state) => state.selectedTaskIds)
  const [opened, setOpened] = useState(false)

  // 只取叶子：摘要任务不能直接派资源（assignment.create 早退），UI 侧同规则
  const leafTaskIds = useMemo<TaskId[]>(
    () =>
      selectedTaskIds.filter((id) => {
        const task = project?.tasks[id]
        return task !== undefined && task.kind !== 'group'
      }),
    [selectedTaskIds, project],
  )

  const tree = useMemo(
    () => (project ? buildAssignmentTree(project, leafTaskIds) : { groups: [], ungrouped: [] }),
    [project, leafTaskIds],
  )

  if (!project) return null

  const disabled = leafTaskIds.length === 0
  const reason =
    selectedTaskIds.length === 0 ? t('menu.reason.noSelection') : t('menu.reason.allSummary')

  const leafSet = new Set(leafTaskIds)
  const assignmentIdFor = (taskId: TaskId, resourceId: ResourceId): string | undefined => {
    for (const assignment of Object.values(project.assignments)) {
      if (assignment.taskId === taskId && assignment.resourceId === resourceId) return assignment.id
    }
    return undefined
  }

  const handleToggle = (resourceId: ResourceId): void => {
    const fingerprint = fingerprintOf(leafTaskIds)
    const fullyAssigned = leafTaskIds.every((taskId) => assignmentIdFor(taskId, resourceId) !== undefined)

    breakCoalescing()
    if (fullyAssigned) {
      for (const taskId of leafTaskIds) {
        const assignmentId = assignmentIdFor(taskId, resourceId)
        if (assignmentId === undefined) continue
        dispatch({
          type: 'assignment.delete',
          label: 'commands.assignment.delete',
          payload: { assignmentId },
          coalesceKey: `assignment.batchDelete:${resourceId}:${fingerprint}`,
        })
      }
      return
    }
    for (const taskId of leafTaskIds) {
      if (assignmentIdFor(taskId, resourceId) !== undefined) continue
      dispatch({
        type: 'assignment.create',
        label: 'commands.assignment.create',
        payload: { taskId, resourceId, units: 1 },
        coalesceKey: `assignment.batchCreate:${resourceId}:${fingerprint}`,
      })
    }
  }

  const handleClear = (): void => {
    const fingerprint = fingerprintOf(leafTaskIds)
    breakCoalescing()
    for (const assignment of Object.values(project.assignments)) {
      if (!leafSet.has(assignment.taskId)) continue
      dispatch({
        type: 'assignment.delete',
        label: 'commands.assignment.delete',
        payload: { assignmentId: assignment.id },
        coalesceKey: `assignment.clear:${fingerprint}`,
      })
    }
  }

  const hasAnyAssignment = Object.values(project.assignments).some((assignment) =>
    leafSet.has(assignment.taskId),
  )

  return (
    <Tooltip label={disabled ? reason : t('toolbar.assignResources')} disabled={opened}>
      <span
        data-testid="assignment-menu-wrap"
        // 禁用理由也落在 DOM 上：单测可断言，读屏也能读到（Tooltip 只在悬停时挂载）
        data-disabled-reason={disabled ? reason : undefined}
        style={{ display: 'inline-flex' }}
      >
        <Menu opened={opened} onChange={setOpened} position="bottom-end" withinPortal>
          <Menu.Target>
            <ActionIcon
              variant="subtle"
              aria-label={t('toolbar.assignResources')}
              data-testid="assignment-menu-trigger"
              disabled={disabled}
            >
              <IconUserPlus size={16} />
            </ActionIcon>
          </Menu.Target>

          <Menu.Dropdown>
            <ResourceAssignmentList
              groups={tree.groups}
              ungrouped={tree.ungrouped}
              taskCount={leafTaskIds.length}
              onToggle={handleToggle}
              onClear={handleClear}
              hasAnyAssignment={hasAnyAssignment}
            />
          </Menu.Dropdown>
        </Menu>
      </span>
    </Tooltip>
  )
}
