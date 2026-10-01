import type { Draft } from 'immer'
import type { Project, TaskId } from '../domain/model/types'
import { deriveKind } from '../domain/model/kind'

/**
 * 依据结构事实修正 kind。任何改变 childIds 的命令都应在最后调用它。
 *
 * 之所以要有这个函数，是因为 kind 与 childIds 必须永远同步 ——
 * 让每条命令各自维护这个不变式，迟早有一条会漏。
 *
 * 方向是**单向**的：childIds 是事实，kind 是派生。
 * 反过来（`kind === 'milestone'` 时去清空 childIds）不该发生 ——
 * `task.indent` / `task.create` 的守卫已经阻止了往里程碑下面挂子任务。
 *
 * 推导规则本身在 `deriveKind` 里，与持久化层的 v1→v2 迁移共用同一份 ——
 * 这里只负责「把结果写回 draft」。
 */
export function reconcileKind(draft: Draft<Project>, taskId: TaskId): void {
  const task = draft.tasks[taskId]
  if (!task) return

  task.kind = deriveKind({
    childIds: task.childIds,
    // 原本是里程碑就保留里程碑语义（没有子任务时）；原本是 group
    // 而 childIds 空了则落回 task。
    isMilestone: task.kind === 'milestone',
  })
}
