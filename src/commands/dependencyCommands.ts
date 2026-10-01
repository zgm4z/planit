import type { DependencyType, TaskId } from '../domain/model/types'
import { createDependency } from '../domain/model/factories'
import { buildGraph } from '../domain/scheduler/graph'
import type { CommandHandler } from './types'

export interface DependencyCreatePayload {
  fromTaskId: TaskId
  toTaskId: TaskId
  type?: DependencyType
  lag?: number
}
export interface DependencyDeletePayload { dependencyId: string }
export interface DependencySetTypePayload { dependencyId: string; type: DependencyType }
export interface DependencySetLagPayload { dependencyId: string; lag: number }

export const dependencyHandlers: Record<string, CommandHandler<any>> = {
  'dependency.create': (draft, payload: DependencyCreatePayload) => {
    const from = draft.tasks[payload.fromTaskId]
    const to = draft.tasks[payload.toTaskId]

    if (!from || !to) {
      throw new Error('依赖的端点任务不存在')
    }

    // 设计文档 4.4：依赖只能连接叶子任务。
    // 摘要任务不参与 CPM 求解，它的日期是子任务汇总的产物，
    // 给它挂依赖会让「汇总结果」反过来参与「汇总输入」的计算。
    if (from.childIds.length > 0 || to.childIds.length > 0) {
      throw new Error('摘要任务不能建立依赖，请连接到具体的子任务上')
    }

    const type = payload.type ?? 'FS'
    const lag = payload.lag ?? 0

    const probe = {
      id: '__probe__',
      fromTaskId: payload.fromTaskId,
      toTaskId: payload.toTaskId,
      type,
      lag,
    }

    // 注意：这里对「现有依赖 + 探测边」整体试排。如果 project.dependencies
    // 本身已经含环（只可能来自损坏的持久化数据），任何新边都会被拒绝，
    // 哪怕它与那个环无关。正常操作流下命令层不允许制造环，故不可达。
    // 试排一次：若新增这条边会成环，buildGraph 会抛出 CycleError，
    // produce 随之丢弃整个 draft，命令不产生任何效果。
    buildGraph(Object.values(draft.tasks), [...Object.values(draft.dependencies), probe])

    const dep = createDependency(payload.fromTaskId, payload.toTaskId, type, lag)
    draft.dependencies[dep.id] = dep
  },

  'dependency.delete': (draft, payload: DependencyDeletePayload) => {
    delete draft.dependencies[payload.dependencyId]
  },

  'dependency.setType': (draft, payload: DependencySetTypePayload) => {
    const dep = draft.dependencies[payload.dependencyId]
    // 改类型不改变图的拓扑，因此无需重新做环检测
    if (dep) dep.type = payload.type
  },

  'dependency.setLag': (draft, payload: DependencySetLagPayload) => {
    const dep = draft.dependencies[payload.dependencyId]
    if (dep) dep.lag = payload.lag
  },
}
