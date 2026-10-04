import type { Project, TaskId } from '../../domain/model/types'

/**
 * 全量反查：每个任务的已分配资源名。
 *
 * 顺序 = `Object.values(project.resources)` 的**声明序**（与 `flattenResources.ts:19`
 * 的资源树、右栏同序）。悬空分配（`resourceId` 指向已删资源）不产生名字 ——
 * 第 2 步只走访**存在的**资源，天然丢弃。无任何分配的任务**不出现**在 Map 里
 * （调用方用 `?? []` 取）。
 *
 * 单遍：O(resources + assignments)。
 *
 * 这是全项目**唯一**一处「任务 → 资源名」反查 —— outline 的 assignees 列与甘特条
 * 共用它。别处再写一遍就是「同一规则两份实现」（本项目出过的事故）。
 */
export function resourceNamesByTask(project: Project): Map<TaskId, string[]> {
  // 1) 按 resourceId 归并任务 id
  const tasksByResource = new Map<string, Set<TaskId>>()
  for (const assignment of Object.values(project.assignments)) {
    const bucket = tasksByResource.get(assignment.resourceId)
    if (bucket) bucket.add(assignment.taskId)
    else tasksByResource.set(assignment.resourceId, new Set([assignment.taskId]))
  }

  // 2) 按**资源声明序**走访存在的资源，逐个任务 push 名字 → 顺序即结果顺序
  const namesByTask = new Map<TaskId, string[]>()
  for (const resource of Object.values(project.resources)) {
    const taskIds = tasksByResource.get(resource.id)
    if (!taskIds) continue
    for (const taskId of taskIds) {
      const names = namesByTask.get(taskId)
      if (names) names.push(resource.name)
      else namesByTask.set(taskId, [resource.name])
    }
  }

  return namesByTask
}

/** 单任务便捷入口 —— 反查逻辑只有一份（上面那个函数）。 */
export function taskResourceNames(project: Project, taskId: TaskId): string[] {
  return resourceNamesByTask(project).get(taskId) ?? []
}
