import type { Draft } from 'immer'
import type { DateStr, Project, Scheduling, TaskId } from '../domain/model/types'
import { createTask } from '../domain/model/factories'
import type { CommandHandler } from './types'

export interface TaskCreatePayload { name: string; parentId?: TaskId | null }
export interface TaskRenamePayload { taskId: TaskId; name: string }
export interface TaskDeletePayload { taskId: TaskId }
export interface TaskSetDurationPayload { taskId: TaskId; duration: number }
export interface TaskSetProgressPayload { taskId: TaskId; progress: number }
export interface TaskToggleMilestonePayload { taskId: TaskId }
export interface TaskSetSchedulingPayload { taskId: TaskId; scheduling: Scheduling }
export interface TaskMoveToPayload { taskId: TaskId; startDate: DateStr }

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/** 删除任务时同时清理它的父指针、以及所有与它相关的依赖 */
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

  for (const [depId, dep] of Object.entries(draft.dependencies)) {
    if (dep.fromTaskId === taskId || dep.toTaskId === taskId) {
      delete draft.dependencies[depId]
    }
  }
}

export const taskHandlers: Record<string, CommandHandler<any>> = {
  'task.create': (draft, payload: TaskCreatePayload) => {
    const task = createTask({ name: payload.name })
    const parentId = payload.parentId ?? null
    task.parentId = parentId

    draft.tasks[task.id] = task
    if (parentId && draft.tasks[parentId]) {
      draft.tasks[parentId].childIds.push(task.id)
    } else {
      task.parentId = null
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
    // 先摘掉根节点（更新父节点的 childIds / rootIds），再逐个删
    detachTask(draft, payload.taskId)

    for (const id of [...subtree].reverse()) {
      delete draft.tasks[id]
    }
  },

  'task.setDuration': (draft, payload: TaskSetDurationPayload) => {
    const task = draft.tasks[payload.taskId]
    if (!task) return
    if (task.childIds.length > 0) return // 摘要任务由汇总决定
    if (task.isMilestone) return // 里程碑恒为 0
    task.duration = Math.max(0, Math.floor(payload.duration))
  },

  'task.setProgress': (draft, payload: TaskSetProgressPayload) => {
    const task = draft.tasks[payload.taskId]
    if (!task) return
    task.progress = clamp(Math.round(payload.progress), 0, 100)
  },

  'task.toggleMilestone': (draft, payload: TaskToggleMilestonePayload) => {
    const task = draft.tasks[payload.taskId]
    if (!task) return
    if (task.childIds.length > 0) return // 摘要任务不能是里程碑

    task.isMilestone = !task.isMilestone
    task.duration = task.isMilestone ? 0 : 1
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
}
