import { ActionIcon, Group, Select, Stack, Text } from '@mantine/core'
import { IconTrash } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

import type { ResourceId, TaskId } from '../domain/model/types'
import { useProjectStore } from '../store/projectStore'
import { GAP_INNER, NumberField } from './InspectorFields'

/**
 * 分配区（spec §4.2）—— **两个入口共用这一个组件**。
 *
 * 「同一份 Assignment 数据，两个过滤方向」：
 *   scope.kind === 'task'     → 列出 assignment.taskId === scope.id，添加的是「资源」
 *   scope.kind === 'resource' → 列出 assignment.resourceId === scope.id，添加的是「任务」
 *
 * 增删改**只写一份**：`assignment.create` / `assignment.delete` / `assignment.setUnits`
 * 的 payload 与 scope 无关，因此两个入口产生的命令**逐字段相同**（验收判据 6）。
 * 与 v0.4 的 RelationSection 同构：两端唯一的分歧点是 `makePayload`。
 */
export interface AssignmentScope {
  kind: 'task' | 'resource'
  id: TaskId | ResourceId
}

export function AssignmentSection({ scope }: { scope: AssignmentScope }) {
  const { t } = useTranslation()
  const project = useProjectStore((state) => state.project)!
  const dispatch = useProjectStore((state) => state.dispatch)
  const breakCoalescing = useProjectStore((state) => state.breakCoalescing)

  const relevant = Object.values(project.assignments).filter((assignment) =>
    scope.kind === 'task' ? assignment.taskId === scope.id : assignment.resourceId === scope.id,
  )

  // 候选 = 另一侧里，尚未与该 scope 分配过的
  const options =
    scope.kind === 'task'
      ? Object.values(project.resources)
          .filter((resource) => !relevant.some((assignment) => assignment.resourceId === resource.id))
          .map((resource) => ({ value: resource.id, label: resource.name }))
      : Object.values(project.tasks)
          .filter((task) => task.childIds.length === 0)
          .filter((task) => !relevant.some((assignment) => assignment.taskId === task.id))
          .map((task) => ({ value: task.id, label: task.name }))

  /** 两端唯一的分歧点：把「另一侧的 id」拼成同一条 create payload */
  const makePayload = (otherId: string): { taskId: string; resourceId: string } =>
    scope.kind === 'task'
      ? { taskId: scope.id, resourceId: otherId }
      : { taskId: otherId, resourceId: scope.id }

  const nameOf = (assignment: { taskId: string; resourceId: string }): string => {
    const otherId = scope.kind === 'task' ? assignment.resourceId : assignment.taskId
    const other = scope.kind === 'task' ? project.resources[otherId] : project.tasks[otherId]
    return other?.name ?? t('inspector.deletedTask')
  }

  return (
    <Stack gap={GAP_INNER} data-testid={`assignments-${scope.kind}-${scope.id}`}>
      {relevant.length === 0 && (
        <Text fz="xs" c="dimmed">
          {t('inspector.assignments.none')}
        </Text>
      )}

      {relevant.map((assignment) => {
        const name = nameOf(assignment)
        return (
          <Group key={assignment.id} gap={4} wrap="nowrap">
            <Text fz="xs" truncate style={{ flex: 1 }}>
              {name}
            </Text>
            {/* 单元是百分比量纲（§1.3：0 位）—— 失焦后按 0 位归一显示 */}
            <NumberField
              size="xs"
              w={72}
              digits={0}
              min={0}
              max={100}
              ariaLabel={`${t('inspector.assignments.units')} ${name}`}
              value={Math.round(assignment.units * 100)}
              onBlur={breakCoalescing}
              onChange={(value) =>
                dispatch({
                  type: 'assignment.setUnits',
                  label: 'commands.assignment.setUnits',
                  payload: { assignmentId: assignment.id, units: (value ?? 0) / 100 },
                  coalesceKey: `assignment.setUnits:${assignment.id}`,
                })
              }
            />
            <ActionIcon
              size="sm"
              variant="subtle"
              color="red"
              aria-label={`${t('commands.assignment.delete')} ${name}`}
              onClick={() =>
                dispatch({
                  type: 'assignment.delete',
                  label: 'commands.assignment.delete',
                  payload: { assignmentId: assignment.id },
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
          label={
            scope.kind === 'task'
              ? t('inspector.assignments.addResource')
              : t('inspector.assignments.addTask')
          }
          placeholder={
            scope.kind === 'task'
              ? t('inspector.assignments.selectResource')
              : t('inspector.relations.selectTask')
          }
          value={null}
          data={options}
          onChange={(otherId) => {
            if (!otherId) return
            dispatch({
              type: 'assignment.create',
              label: 'commands.assignment.create',
              payload: { ...makePayload(otherId), units: 1 },
            })
          }}
        />
      )}
    </Stack>
  )
}
