import type { Project, ResourceId } from '../../domain/model/types'

export interface ResourceFlatRow {
  resourceId: ResourceId
  depth: number
  hasChildren: boolean
  collapsed: boolean
}

/**
 * 把资源树按前序遍历压成扁平行，跳过被折叠节点的子树。
 *
 * 与任务树的 `flattenVisibleRows`（`shared/flattenRows.ts`）**同构、不同实体** ——
 * 资源树渲染 `Resource`、任务树渲染 `Task`，因此是**两份**而不是「同一规则的两份实现」
 * （见 spec §6.1：v0.3 的「共用行渲染」只适用于**同一实体**的两种呈现）。
 *
 * 前提：`parentId` 构成一棵树（无环，由命令层保证）。
 * 悬空 `parentId`（指向不存在的资源）当**根**处理 —— 不静默丢行。
 * 子节点顺序 = `Object.values(project.resources)` 的声明序。
 */
export function flattenResourceRows(
  project: Project,
  collapsedIds: ReadonlySet<ResourceId>,
): ResourceFlatRow[] {
  const childrenOf = new Map<ResourceId | null, ResourceId[]>()
  for (const resource of Object.values(project.resources)) {
    const parent = resource.parentId ?? null
    // 悬空 parentId 归到根：把它接到不存在的父上会让整棵子树从视图里消失
    const bucket = parent !== null && project.resources[parent] ? parent : null
    const siblings = childrenOf.get(bucket)
    if (siblings) siblings.push(resource.id)
    else childrenOf.set(bucket, [resource.id])
  }

  const rows: ResourceFlatRow[] = []

  const visit = (resourceId: ResourceId, depth: number): void => {
    const resource = project.resources[resourceId]
    if (!resource) return
    const childIds = childrenOf.get(resourceId) ?? []
    const hasChildren = childIds.length > 0
    const collapsed = hasChildren && collapsedIds.has(resourceId)

    rows.push({ resourceId, depth, hasChildren, collapsed })

    if (!collapsed) for (const childId of childIds) visit(childId, depth + 1)
  }

  for (const rootId of childrenOf.get(null) ?? []) visit(rootId, 0)
  return rows
}
