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
  // v1 的任务不该有 kind。带上它说明这份存档与版本号不符 —— 可能是手工改过，
  // 也可能是跑过「新形状 + 旧版本号」的中间态构建（见 migrateV1ToV2 的说明）。
  // 与其静默把已有的 kind 覆盖掉，不如报错。
  if ('kind' in task) {
    throw new Error(
      `v1 存档的任务 ${task.id} 带有 kind 字段，形状与版本号（v1）不符，已拒绝迁移以免损坏数据`,
    )
  }

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
