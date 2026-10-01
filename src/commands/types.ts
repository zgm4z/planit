import type { Draft } from 'immer'
import type { Project } from '../domain/model/types'

export type CommandType =
  // 任务结构
  | 'task.create'
  | 'task.rename'
  | 'task.delete'
  | 'task.reorder'
  | 'task.indent'
  | 'task.outdent'
  // 任务排期
  | 'task.setDuration'
  | 'task.setProgress'
  | 'task.toggleMilestone'
  | 'task.setScheduling'
  | 'task.moveTo'
  | 'task.resize'
  | 'task.setSchedulingOrder'
  | 'task.setNote'
  | 'task.setPriority'
  | 'task.setDelay'
  | 'task.setAllowSplitting'
  // 依赖
  | 'dependency.create'
  | 'dependency.delete'
  | 'dependency.setType'
  | 'dependency.setLag'
  // 日历
  | 'calendar.setWorkingDays'
  | 'calendar.addException'
  | 'calendar.removeException'
  // 项目
  | 'project.rename'
  | 'project.setDirection'
  | 'project.setStartDate'
  | 'project.setEndDate'

/**
 * 一次数据变更的完整描述。`payload` 必须是可序列化的普通数据
 * —— 不含函数、不含 Date 对象，为将来的命令日志 / 重放留门。
 */
export interface Command<P = unknown> {
  readonly type: CommandType
  /** 面向撤销菜单的文案，如「修改工期」 */
  readonly label: string
  readonly payload: P
  /** 相邻且 key 相同的命令在入栈时合并为一条撤销记录 */
  readonly coalesceKey?: string
}

/** handler 就地修改 Immer draft，由 produce 负责生成新对象与 patch */
export type CommandHandler<P> = (draft: Draft<Project>, payload: P) => void
