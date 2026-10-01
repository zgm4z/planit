import type { Project, Task, TaskKind } from '../domain/model/types'
import { SCHEMA_VERSION } from '../domain/model/factories'

/** v1 存档里的任务形状：有 isMilestone，没有 kind 与四个占位字段 */
type V1Task = Omit<
  Task,
  'kind' | 'schedulingOrder' | 'note' | 'allowSplitting' | 'priority' | 'delay'
> & { isMilestone: boolean }

type V1Project = Omit<Project, 'schedulingDirection' | 'tasks'> & {
  schemaVersion: number
  tasks: Record<string, V1Task>
}

/**
 * v1 的任务补上 kind。纯函数，不改动入参。
 *
 * 推导规则与命令层的 reconcileKind 一致：里程碑优先，
 * 其次有子任务即 group，否则 task。
 */
export function migrateTaskV1ToV2(task: V1Task): Task {
  const kind: TaskKind = task.isMilestone
    ? 'milestone'
    : task.childIds.length > 0
      ? 'group'
      : 'task'

  const { isMilestone: _drop, ...rest } = task
  return {
    ...rest,
    kind,
    schedulingOrder: 'asap',
    note: '',
    allowSplitting: false,
    priority: 0,
    delay: 0,
  }
}

/**
 * v1 项目整体迁到 v2。纯函数：入参对象不被改动，每次调用返回全新对象。
 *
 * `endDate` 刻意不设 —— 未设置即「forward 无期限 / backward 用正推完成日」，
 * 比塞一个 `startDate + 30` 之类的哨兵值安全得多（哨兵会悄悄截断长项目）。
 *
 * ⚠️ 这次 bump 与 v0.2 的 Task 1–4 是**绑定的**：Task 1 起落盘形状就已经变了
 * （isMilestone → kind），版本号到本任务才动。单独发布中间任何一个任务，
 * v0.1 的老存档都会通过版本校验、以 undefined 的 kind 载入。要发就整批发。
 */
export function migrateV1ToV2(project: V1Project): Project {
  const tasks: Record<string, Task> = {}
  for (const [id, task] of Object.entries(project.tasks)) {
    tasks[id] = migrateTaskV1ToV2(task)
  }

  const { schemaVersion: _drop, ...rest } = project
  return { ...rest, schemaVersion: SCHEMA_VERSION, schedulingDirection: 'forward', tasks }
}
