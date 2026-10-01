import type { Draft } from 'immer'
import type { Project, TaskId } from '../domain/model/types'

/**
 * 依据结构事实修正 kind。任何改变 childIds 的命令都应在最后调用它。
 *
 * 之所以要有这个函数，是因为 kind 与 childIds 必须永远同步 ——
 * 让每条命令各自维护这个不变式，迟早有一条会漏。
 *
 * 方向是**单向**的：childIds 是事实，kind 是派生。
 * 反过来（`kind === 'milestone'` 时去清空 childIds）不该发生 ——
 * `task.indent` 的守卫已经阻止了往里程碑下面挂子任务。
 */
export function reconcileKind(draft: Draft<Project>, taskId: TaskId): void {
  const task = draft.tasks[taskId]
  if (!task) return

  if (task.childIds.length > 0) {
    if (task.kind !== 'group') task.kind = 'group'
    return
  }

  if (task.kind === 'group') task.kind = 'task'
}
