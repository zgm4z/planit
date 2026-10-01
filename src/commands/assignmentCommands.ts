import type { AssignmentId, ResourceId, TaskId } from '../domain/model/types'
import { createAssignment } from '../domain/model/factories'
import type { CommandHandler } from './types'

export interface AssignmentCreatePayload { taskId: TaskId; resourceId: ResourceId; units?: number }
export interface AssignmentDeletePayload { assignmentId: AssignmentId }
export interface AssignmentSetUnitsPayload { assignmentId: AssignmentId; units: number }

/** 单元是「投入比例」，落在 (0, 1] */
const clampUnits = (value: number): number => Math.min(1, Math.max(0.01, value))

/**
 * **两个入口共用这一套 handler**（spec §4.2）：任务面板的「分配的资源」与资源面板的
 * 「分配」是**同一份 Assignment 数据的两个过滤方向**，增删改都走这里的命令 ——
 * payload 与「从哪个面板发起」无关，因此两处产生的命令逐字段相同。
 *
 * 合并键：`assignment.setUnits` 是输入框驱动 → 传 `assignment.setUnits:<assignmentId>`；
 * create / delete 是点击驱动 → 不传。
 */
export const assignmentHandlers: Record<string, CommandHandler<any>> = {
  'assignment.create': (draft, payload: AssignmentCreatePayload) => {
    const task = draft.tasks[payload.taskId]
    const resource = draft.resources[payload.resourceId]
    // 摘要任务不能直接派资源（与 dependency.create 同理：它的日期由子任务汇总）
    if (!task || task.kind === 'group') return
    if (!resource) return

    // 同一 (任务, 资源) 只允许一条分配 —— 重复创建是 no-op
    for (const assignment of Object.values(draft.assignments)) {
      if (assignment.taskId === payload.taskId && assignment.resourceId === payload.resourceId) return
    }

    const assignment = createAssignment({
      taskId: payload.taskId,
      resourceId: payload.resourceId,
      units: payload.units,
    })
    draft.assignments[assignment.id] = assignment
  },

  'assignment.delete': (draft, payload: AssignmentDeletePayload) => {
    delete draft.assignments[payload.assignmentId]
  },

  'assignment.setUnits': (draft, payload: AssignmentSetUnitsPayload) => {
    const assignment = draft.assignments[payload.assignmentId]
    if (assignment) assignment.units = clampUnits(payload.units)
  },
}
