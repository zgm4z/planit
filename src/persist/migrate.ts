import type { Project, Resource, ResourceCost, Task } from '../domain/model/types'
import { SCHEMA_VERSION } from '../domain/model/factories'
import { deriveKind } from '../domain/model/kind'

/** v2 存档里的资源形状：5 种 kind（含 'cost'），cost 是 { rate, per, currency } */
type V2Resource = Omit<
  Resource,
  'kind' | 'email' | 'availableFrom' | 'availableUntil' | 'cost'
> & {
  kind: 'group' | 'staff' | 'equipment' | 'material' | 'cost'
  cost: { rate: number; per: 'hour' | 'day' | 'unit'; currency: string }
}

/** v1 存档里的任务形状：有 isMilestone，没有 kind 与四个占位字段 */
type V1Task = Omit<
  Task,
  'kind' | 'schedulingOrder' | 'note' | 'allowSplitting' | 'priority' | 'delay'
> & { isMilestone: boolean }

type V1Project = Omit<
  Project,
  'schedulingDirection' | 'tasks' | 'resources' | 'baselines' | 'activeBaselineId' | 'statusDate'
> & {
  schemaVersion: number
  tasks: Record<string, V1Task>
  resources: Record<string, V2Resource>
}

/**
 * v1 的任务补上 kind。纯函数，不改动入参。
 *
 * 推导规则与命令层的 reconcileKind 共用同一份 `deriveKind`：**子任务优先**，
 * 没有子任务时才看 isMilestone。
 */
export function migrateTaskV1ToV2(task: V1Task): Task {
  // v1 的任务不该有 kind。带上它说明这份存档与版本号不符 —— 可能是手工改过，
  // 也可能是跑过「新形状 + 旧版本号」的中间态构建。
  if ('kind' in task) {
    throw new Error(
      `v1 存档的任务 ${task.id} 带有 kind 字段，形状与版本号（v1）不符，已拒绝迁移以免损坏数据`,
    )
  }

  const kind = deriveKind({ childIds: task.childIds, isMilestone: task.isMilestone })

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

type V2Project = Omit<Project, 'resources' | 'baselines' | 'activeBaselineId' | 'statusDate'> & {
  schemaVersion: number
  resources: Record<string, V2Resource>
}

/**
 * v1 项目整体迁到 **v2**（不是「当前版本」）。纯函数，入参不被改动。
 *
 * ⚠️ 这里刻意写死 `schemaVersion: 2` 而**不是** `SCHEMA_VERSION`：迁移现在是
 * **逐跳链式**，`migrateV1ToV2` 的产出会再喂给 `migrateV2ToV3`。若写成
 * `SCHEMA_VERSION`（=3），v1 存档会被戳成「v2 形状 + v3 版本号」，v2→v3 那步
 * 就会把已经是新形状的资源再迁一次 —— 正是 schema.ts 注释里警告的畸形结果。
 *
 * `endDate` 刻意不设 —— 未设置即「forward 无期限 / backward 用正推完成日」。
 */
export function migrateV1ToV2(project: V1Project): V2Project {
  const tasks: Record<string, Task> = {}
  for (const [id, task] of Object.entries(project.tasks)) {
    tasks[id] = migrateTaskV1ToV2(task)
  }

  const { schemaVersion: _drop, tasks: _tasks, ...rest } = project
  return { ...rest, schemaVersion: 2, schedulingDirection: 'forward', tasks }
}

/**
 * 单资源的 v2 → v3 迁移：去掉 `'cost'` 类型、把 `{ rate, per }` 折算进新成本。
 *
 * spec §2 说「保留其 `cost.hourly`」—— 但 v2 的成本**根本没有** `hourly` 字段，
 * 按 `per` 折算才是可实现的（见计划偏差 2）。`per: 'day'` 用项目日历的
 * `hoursPerDay` 除一下，让「日费率」在小时粒度上等价。
 */
export function migrateResourceV2ToV3(resource: V2Resource, hoursPerDay: number): Resource {
  const { cost, kind, ...rest } = resource
  const nextCost: ResourceCost = { currency: cost.currency }

  if (cost.per === 'unit') nextCost.usage = cost.rate
  else if (cost.per === 'day') nextCost.hourly = cost.rate / hoursPerDay
  else nextCost.hourly = cost.rate

  return { ...rest, kind: kind === 'cost' ? 'material' : kind, cost: nextCost }
}

/**
 * v2 项目整体迁到 **v3**（不是「当前版本」）。纯函数。
 *
 * ⚠️ 这里同样刻意写死 `schemaVersion: 3` 而**不是** `SCHEMA_VERSION`（见
 * `migrateV1ToV2` 的说明）：逐跳链式下，v2 的产出会再喂给 `migrateV3ToV4`。
 * 若写成 `SCHEMA_VERSION`（=4），这一步就会产出「v3 形状 + v4 版本号」——
 * 它谎称自己已是 v4，而形状还差 v4 的两个字段。当前 while 循环按**计数器**
 * 推进（不看产出的 `schemaVersion`），所以碰巧仍会补跑 v3→v4 而不暴露；
 * 但这让契约名不副实：任何按「产出值」判断还要不要再迁的调用方都会跳过
 * v3→v4 —— 正是 schema.ts 注释里警告的畸形结果。（v1→v2 早已改成写死
 * 字面量，这一步是补上的历史欠账。）
 *
 * 返回类型是 `V3Project` 而**不是** `Project` —— 与 `migrateV1ToV2 → V2Project`
 * 对称。逐跳链下它只承诺产出 v3 形状，v4 的两个新字段由下一步负责。
 */
export function migrateV2ToV3(project: V2Project): V3Project {
  const hoursPerDay = project.calendars[project.calendarId]?.hoursPerDay ?? 8

  const resources: Record<string, Resource> = {}
  for (const [id, resource] of Object.entries(project.resources)) {
    resources[id] = migrateResourceV2ToV3(resource, hoursPerDay)
  }

  const { schemaVersion: _drop, resources: _resources, ...rest } = project
  return { ...rest, schemaVersion: 3, resources }
}

/** v3 存档的形状：**没有** baselines / activeBaselineId / statusDate */
type V3Project = Omit<Project, 'baselines' | 'activeBaselineId' | 'statusDate'> & {
  schemaVersion: number
}

/**
 * v3 项目整体迁到 **v4**（= 当前版本）。纯函数，入参不被改动。
 *
 * 只补两个空容器：`baselines: []` + `activeBaselineId: null`。
 * `statusDate` 刻意**不设** —— 未设置即「PV / SV 暂不可算」，UI 会提示用户设基准日。
 */
export function migrateV3ToV4(project: V3Project): Project {
  const { schemaVersion: _drop, ...rest } = project
  return { ...rest, schemaVersion: SCHEMA_VERSION, baselines: [], activeBaselineId: null }
}
