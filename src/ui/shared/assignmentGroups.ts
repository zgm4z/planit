import type { Project, Resource, ResourceId, ResourceKind, TaskId } from '../../domain/model/types'
import { isLeafTask } from './outlineActions'

/** 下拉里的一行资源（叶子）。`assignedCount` = 被多少个选中叶子任务分配。 */
export interface AssignmentLeaf {
  id: ResourceId
  name: string
  kind: ResourceKind
  assignedCount: number
}

/** 一个可折叠组（顶层 `kind === 'group'` 的资源）。`assignedCount` = Σ 成员的分配数。 */
export interface AssignmentGroup {
  id: ResourceId
  name: string
  members: AssignmentLeaf[]
  assignedCount: number
}

export interface AssignmentTree {
  groups: AssignmentGroup[]
  ungrouped: AssignmentLeaf[]
}

/**
 * 把项目资源整理成下拉的展示模型（spec §3）：
 *   · 顶层且 `kind === 'group'` 的资源 → 可折叠组，成员是它的**全部后代**（前序）；
 *   · 其余顶层资源 → 未分组（扁平行，不另做组头 —— spec §7 未列「未分组」文案）。
 *
 * `assignedCount` 只统计**选中集合里的叶子任务**（`kind !== 'group'`）——
 * 摘要任务不能直接派资源（`assignment.create` 早退），把它们算进去会让三态失真。
 */
export function buildAssignmentTree(
  project: Project,
  selectedTaskIds: readonly TaskId[],
): AssignmentTree {
  const selected = new Set(selectedTaskIds.filter((id) => isLeafTask(project, id)))

  const countByResource = new Map<ResourceId, number>()
  for (const assignment of Object.values(project.assignments)) {
    if (!selected.has(assignment.taskId)) continue
    countByResource.set(assignment.resourceId, (countByResource.get(assignment.resourceId) ?? 0) + 1)
  }

  const resources = Object.values(project.resources)
  const byId = new Map(resources.map((resource) => [resource.id, resource]))

  const childrenOf = new Map<ResourceId, Resource[]>()
  const roots: Resource[] = []
  for (const resource of resources) {
    const parentId = resource.parentId
    if (parentId !== null && byId.has(parentId)) {
      const bucket = childrenOf.get(parentId)
      if (bucket) bucket.push(resource)
      else childrenOf.set(parentId, [resource])
    } else {
      roots.push(resource)
    }
  }

  const leafOf = (resource: Resource): AssignmentLeaf => ({
    id: resource.id,
    name: resource.name,
    kind: resource.kind,
    assignedCount: countByResource.get(resource.id) ?? 0,
  })

  const descendants = (id: ResourceId): AssignmentLeaf[] => {
    const out: AssignmentLeaf[] = []
    const walk = (current: ResourceId): void => {
      for (const child of childrenOf.get(current) ?? []) {
        out.push(leafOf(child))
        walk(child.id)
      }
    }
    walk(id)
    return out
  }

  const groups: AssignmentGroup[] = []
  const ungrouped: AssignmentLeaf[] = []
  for (const resource of roots) {
    if (resource.kind === 'group') {
      const members = descendants(resource.id)
      groups.push({
        id: resource.id,
        name: resource.name,
        members,
        assignedCount: members.reduce((sum, member) => sum + member.assignedCount, 0),
      })
    } else {
      ungrouped.push(leafOf(resource))
    }
  }

  return { groups, ungrouped }
}
