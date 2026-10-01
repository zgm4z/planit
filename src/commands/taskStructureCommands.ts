import type { Draft } from 'immer'
import type { Project, TaskId } from '../domain/model/types'
import type { CommandHandler } from './types'

export interface TaskReorderPayload { taskId: TaskId; toIndex: number }
export interface TaskIndentPayload { taskId: TaskId }
export interface TaskOutdentPayload { taskId: TaskId }

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/** 取任务所处的兄弟列表（顶层任务取 rootIds，子任务取父的 childIds） */
function siblingList(draft: Draft<Project>, taskId: TaskId): TaskId[] | null {
  const task = draft.tasks[taskId]
  if (!task) return null
  if (task.parentId === null) return draft.rootIds
  const parent = draft.tasks[task.parentId]
  return parent ? parent.childIds : null
}

export const taskStructureHandlers: Record<string, CommandHandler<any>> = {
  'task.reorder': (draft, payload: TaskReorderPayload) => {
    const list = siblingList(draft, payload.taskId)
    if (!list) return

    const from = list.indexOf(payload.taskId)
    if (from < 0) return

    const to = clamp(payload.toIndex, 0, list.length - 1)
    if (from === to) return

    list.splice(from, 1)
    list.splice(to, 0, payload.taskId)
  },

  'task.indent': (draft, payload: TaskIndentPayload) => {
    const list = siblingList(draft, payload.taskId)
    if (!list) return

    const index = list.indexOf(payload.taskId)
    if (index <= 0) return // 第一个兄弟没有可依附的前驱

    const task = draft.tasks[payload.taskId]
    const newParentId = list[index - 1]
    const newParent = draft.tasks[newParentId]

    if (!newParent || newParent.isMilestone) return // 里程碑不可作为父任务

    list.splice(index, 1)
    newParent.childIds.push(payload.taskId)
    task.parentId = newParentId
  },

  'task.outdent': (draft, payload: TaskOutdentPayload) => {
    const task = draft.tasks[payload.taskId]
    if (!task || task.parentId === null) return // 已是顶层

    const parent = draft.tasks[task.parentId]
    if (!parent) return

    const parentList = siblingList(draft, parent.id)
    if (!parentList) return

    // 从原父任务下摘除
    const indexInParent = parent.childIds.indexOf(payload.taskId)
    if (indexInParent >= 0) parent.childIds.splice(indexInParent, 1)

    // 插到原父任务之后，成为祖父层的兄弟
    const parentIndex = parentList.indexOf(parent.id)
    parentList.splice(parentIndex + 1, 0, payload.taskId)
    task.parentId = parent.parentId
  },
}
