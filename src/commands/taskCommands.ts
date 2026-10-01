import type { Draft } from 'immer'
import type { DateStr, Project, Scheduling, TaskId } from '../domain/model/types'
import { createTask } from '../domain/model/factories'
import { reconcileKind } from './reconcileKind'
import type { CommandHandler } from './types'

export interface TaskCreatePayload { name: string; parentId?: TaskId | null }
export interface TaskRenamePayload { taskId: TaskId; name: string }
export interface TaskDeletePayload { taskId: TaskId }
export interface TaskSetDurationPayload { taskId: TaskId; duration: number }
export interface TaskSetProgressPayload { taskId: TaskId; progress: number }
export interface TaskToggleMilestonePayload { taskId: TaskId }
export interface TaskSetSchedulingPayload { taskId: TaskId; scheduling: Scheduling }
export interface TaskMoveToPayload { taskId: TaskId; startDate: DateStr }
export interface TaskResizePayload { taskId: TaskId; startDate: DateStr; duration: number }

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/** 把任务从父节点的 childIds（或 rootIds）中摘除。调用方负责清理依赖 */
function detachTask(draft: Draft<Project>, taskId: TaskId): void {
  const task = draft.tasks[taskId]
  if (!task) return

  if (task.parentId) {
    const siblings: TaskId[] = draft.tasks[task.parentId].childIds
    const index = siblings.indexOf(taskId)
    if (index >= 0) siblings.splice(index, 1)
  } else {
    const index = draft.rootIds.indexOf(taskId)
    if (index >= 0) draft.rootIds.splice(index, 1)
  }
}

export const taskHandlers: Record<string, CommandHandler<any>> = {
  'task.create': (draft, payload: TaskCreatePayload) => {
    const task = createTask({ name: payload.name })
    // 里程碑不能当父任务 —— 与 task.indent 的守卫是同一条规则。
    // 两条路径必须一致：indent 拒绝的事，create 也不该换个方式做成。
    // 不可用的 parentId（悬空 id / 里程碑）一律回退到根层，不留下悬空的 parentId。
    // createTask 已把 parentId 默认为 null，因此回退分支无需再赋值。
    const candidate = payload.parentId ? draft.tasks[payload.parentId] : undefined
    const parent = candidate && candidate.kind !== 'milestone' ? candidate : undefined

    draft.tasks[task.id] = task
    if (parent) {
      task.parentId = parent.id
      parent.childIds.push(task.id)
      reconcileKind(draft, parent.id)
    } else {
      draft.rootIds.push(task.id)
    }
  },

  'task.rename': (draft, payload: TaskRenamePayload) => {
    const task = draft.tasks[payload.taskId]
    if (task) task.name = payload.name
  },

  'task.delete': (draft, payload: TaskDeletePayload) => {
    // 后序删除整棵子树
    const collect = (id: TaskId): TaskId[] => {
      const task = draft.tasks[id]
      if (!task) return []
      return [id, ...task.childIds.flatMap(collect)]
    }

    const subtree = collect(payload.taskId)
    if (subtree.length === 0) return // 任务不存在，no-op

    // 先摘掉根节点（更新父节点的 childIds / rootIds），再逐个删
    const parentId = draft.tasks[payload.taskId]?.parentId ?? null
    detachTask(draft, payload.taskId)
    if (parentId) reconcileKind(draft, parentId)

    // 清理整棵子树的依赖 —— 只清理根节点会留下指向已删除任务的孤儿依赖，
    // 这些孤儿会被持久化、污染统计，且因不在 patch 里而无法被撤销恢复
    const removed = new Set(subtree)
    for (const [depId, dep] of Object.entries(draft.dependencies)) {
      if (removed.has(dep.fromTaskId) || removed.has(dep.toTaskId)) {
        delete draft.dependencies[depId]
      }
    }

    for (const id of [...subtree].reverse()) {
      delete draft.tasks[id]
    }
  },

  'task.setDuration': (draft, payload: TaskSetDurationPayload) => {
    const task = draft.tasks[payload.taskId]
    if (!task) return
    if (task.childIds.length > 0) return // 摘要任务由汇总决定
    if (task.kind === 'milestone') return // 里程碑恒为 0
    task.duration = Math.max(0, Math.floor(payload.duration))
  },

  'task.setProgress': (draft, payload: TaskSetProgressPayload) => {
    const task = draft.tasks[payload.taskId]
    if (!task) return
    task.progress = clamp(Math.round(payload.progress), 0, 100)
  },

  // 名称保留 toggleMilestone：它切换的是 `kind` 在 task / milestone 之间，
  // 命令 id 已出现在既有 UI 与测试里，改名是纯粹的噪音。
  'task.toggleMilestone': (draft, payload: TaskToggleMilestonePayload) => {
    const task = draft.tasks[payload.taskId]
    if (!task) return
    if (task.kind === 'group') return // 摘要任务不能是里程碑

    const toMilestone = task.kind !== 'milestone'
    task.kind = toMilestone ? 'milestone' : 'task'
    task.duration = toMilestone ? 0 : 1
  },

  'task.setScheduling': (draft, payload: TaskSetSchedulingPayload) => {
    const task = draft.tasks[payload.taskId]
    if (!task) return
    if (task.childIds.length > 0) return // 摘要任务日期只读
    task.scheduling = payload.scheduling
  },

  'task.moveTo': (draft, payload: TaskMoveToPayload) => {
    const task = draft.tasks[payload.taskId]
    if (!task) return
    if (task.childIds.length > 0) return
    task.scheduling = { mode: 'constraint', type: 'startOn', date: payload.startDate }
  },

  // 拖拽左把手会同时改变「开始日期」与「工期」两个维度。
  // 若拆成 task.setDuration + task.moveTo 两条命令，撤销栈里会留下两条记录 ——
  // 按一次 Ctrl+Z 只退回半步（日期回来了、工期还留着）。
  // 这条命令把两个字段放进**同一次**变更，因此只产生一条撤销记录、一次撤销即可完全复原。
  'task.resize': (draft, payload: TaskResizePayload) => {
    const task = draft.tasks[payload.taskId]
    if (!task) return
    if (task.childIds.length > 0) return // 摘要任务日期只读
    if (task.kind === 'milestone') return // 里程碑恒为 0 工期

    task.duration = Math.max(1, Math.floor(payload.duration))
    task.scheduling = { mode: 'constraint', type: 'startOn', date: payload.startDate }
  },
}
