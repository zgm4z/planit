import type {
  Calendar,
  CalendarException,
  Dependency,
  Lag,
  Project,
  Resource,
  ResourceCost,
  Scheduling,
  Task,
} from '../domain/model/types'
import { createCalendar } from '../domain/model/factories'
import { toDateStr } from '../domain/calendar/dateTime'
import { taskFinish, taskStart } from '../domain/calendar/workdays'
import { deriveKind } from '../domain/model/kind'
import {
  DEFAULT_FINISH_TIME,
  DEFAULT_START_TIME,
  ensureDateTime,
} from '../domain/calendar/dateTime'

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
  // 任务 / 依赖原样透传（本跳只动资源）。产出锚在 V3Project 的 v5 任务形态上 ——
  // v1/v2 的任务只可能是 auto，形状上兼容 V5Task 的 scheduling；这里的断言只是让
  // 「逐跳链中间态是 v5 形态」这一契约显式化，不改变任何运行时行为。
  return { ...rest, schemaVersion: 3, resources } as unknown as V3Project
}

// ── v5 形状（scheduling 仍是旧的 auto | constraint，lag 可为裸数字）────────────
//
// v5 → v6 之前的每一跳都在这套形状上走：任务的 scheduling 还是旧的六型 constraint、
// 依赖的 lag 还可能是裸数字。把旧形态**写在本文件里**（而不是从 domain 引「当前」
// Scheduling）是刻意的 —— persist 层不依赖 domain 的当前类型，否则每次语义重构都会
// 让历史迁移的入参类型跟着漂移，旧存档的形状表述也就失去了独立性。

/** v5 的约束类型（含 v6 已移除的 startOn / finishOn） */
type V5ConstraintType =
  | 'startOn'
  | 'finishOn'
  | 'startNoEarlierThan'
  | 'startNoLaterThan'
  | 'finishNoEarlierThan'
  | 'finishNoLaterThan'

type V5Scheduling =
  | { mode: 'auto' }
  | { mode: 'constraint'; type: V5ConstraintType; date: string }

type V5Task = Omit<Task, 'scheduling'> & { scheduling: V5Scheduling }
type V5Dependency = Omit<Dependency, 'lag'> & { lag: Lag | number }

type V5Project = Omit<Project, 'tasks' | 'dependencies'> & {
  schemaVersion: number
  tasks: Record<string, V5Task>
  dependencies: Record<string, V5Dependency>
}

/** v3 存档的形状：**没有** baselines / activeBaselineId / statusDate */
type V3Project = Omit<V5Project, 'baselines' | 'activeBaselineId' | 'statusDate'>

/** v4 存档形状：**与 v5 在 TS 上同形**（DateStr 与 DateTimeStr 都是 `string`），
 *  差别只在语义 —— v4 的承载字段是纯日期，v5 带时刻。别名让逐跳链的签名对称。 */
type V4Project = V5Project

/**
 * v3 项目整体迁到 **v4**（**不是**当前版本）。纯函数，入参不被改动。
 *
 * 只补两个空容器：`baselines: []` + `activeBaselineId: null`。
 * `statusDate` 刻意**不设** —— 未设置即「PV / SV 暂不可算」，UI 会提示用户设基准日。
 *
 * 返回类型是 `V4Project` 而**不是** `Project`（与上一跳对称）：逐跳链下它只承诺
 * 产出 v4 形状，v5 的「补时刻」由下一步负责。
 */
export function migrateV3ToV4(project: V3Project): V4Project {
  const { schemaVersion: _drop, ...rest } = project
  // ⚠️ 写死字面量 4，**不是** SCHEMA_VERSION（历史欠账，见 migrateV1ToV2 的说明）：
  // v5 起 SCHEMA_VERSION 不再等于 4，用符号会产出「v4 形状 + v5 版本号」的畸形结果。
  return { ...rest, schemaVersion: 4, baselines: [], activeBaselineId: null }
}

/**
 * v4 项目整体迁到 **v5**（**不是**当前版本）。纯函数，入参不被改动。
 *
 * 把承载时刻的字段从纯日期补上默认时刻（spec §4）：项目起止 / 基准日、任务约束
 * 日期、资源可用期、`custom` 例外的时段。**不碰** `Calendar.exceptions` 的键
 * （`isWorkday` 按日查表，带时刻会静默漏查）、也**不碰** `BaselineEntry`
 * （快照冻结在当时的日粒度，见 spec 判断 B）。
 *
 * 返回类型是 `V5Project` 而**不是** `Project`（与前面几跳对称）：逐跳链下它只承诺
 * 产出 v5 形状，v6 的 scheduling / lag 重构由 `migrateV5ToV6` 负责。
 */
export function migrateV4ToV5(project: V4Project): V5Project {
  const { schemaVersion: _drop, ...rest } = project

  const tasks: Record<string, V5Task> = {}
  for (const [id, task] of Object.entries(project.tasks)) {
    tasks[id] =
      task.scheduling.mode === 'constraint'
        ? {
            ...task,
            scheduling: {
              ...task.scheduling,
              date: ensureDateTime(task.scheduling.date, DEFAULT_START_TIME),
            },
          }
        : task
  }

  const resources: Record<string, Resource> = {}
  for (const [id, resource] of Object.entries(project.resources)) {
    resources[id] = {
      ...resource,
      // 可用期是可选字段：缺省（undefined）不补 —— 「未设」与「设了某日」是两种语义
      ...(resource.availableFrom
        ? { availableFrom: ensureDateTime(resource.availableFrom, DEFAULT_START_TIME) }
        : {}),
      ...(resource.availableUntil
        ? { availableUntil: ensureDateTime(resource.availableUntil, DEFAULT_FINISH_TIME) }
        : {}),
    }
  }

  const calendars: Record<string, Calendar> = {}
  for (const [id, calendar] of Object.entries(project.calendars)) {
    const exceptions: Record<string, CalendarException> = {}
    for (const [date, exception] of Object.entries(calendar.exceptions)) {
      exceptions[date] =
        exception.kind === 'custom'
          ? {
              kind: 'custom',
              start: ensureDateTime(exception.start, DEFAULT_START_TIME),
              end: ensureDateTime(exception.end, DEFAULT_FINISH_TIME),
            }
          : exception
    }
    calendars[id] = { ...calendar, exceptions }
  }

  return {
    ...rest,
    // 写死字面量（逐跳契约）—— 每一步的产出只承诺自己的版本号。
    schemaVersion: 5,
    startDate: ensureDateTime(project.startDate, DEFAULT_START_TIME),
    ...(project.endDate
      ? { endDate: ensureDateTime(project.endDate, DEFAULT_FINISH_TIME) }
      : {}),
    ...(project.statusDate
      ? { statusDate: ensureDateTime(project.statusDate, DEFAULT_FINISH_TIME) }
      : {}),
    tasks,
    resources,
    calendars,
  }
}

/**
 * 单任务的 scheduling：v5 形态 → v6 形态（spec §1.3 映射表）。
 *
 * - `startOn(d)`  → `manual { start: d, finish: d + 工期 − 1 工作日 }`
 * - `finishOn(d)` → `manual { start: d − 工期 + 1 工作日, finish: d }`
 * - 四个 `*NoEarlier/NoLaterThan(d)` → `auto` + 对应侧的约束
 *
 * **幂等**：已是 v6 形态（`auto` 带约束 / `manual`）的 scheduling 原样保留 ——
 * 非 `constraint` 的 mode 一律直接透传。
 */
export function migrateSchedulingV5ToV6(
  scheduling: V5Scheduling | Scheduling,
  duration: number,
  calendar: Calendar,
): Scheduling {
  const mode = (scheduling as { mode?: string }).mode
  // 已是 v6 形态（auto 带约束 / manual）原样保留 —— 幂等。
  if (mode !== 'constraint') return scheduling as Scheduling

  const { type, date } = scheduling as { type: V5ConstraintType; date: string }
  switch (type) {
    case 'startOn':
      return {
        mode: 'manual',
        start: date,
        finish: taskFinish(toDateStr(date), duration, calendar),
      }
    case 'finishOn':
      return {
        mode: 'manual',
        start: taskStart(toDateStr(date), duration, calendar),
        finish: date,
      }
    case 'startNoEarlierThan':
      return { mode: 'auto', startConstraint: { type: 'startNoEarlierThan', date } }
    case 'startNoLaterThan':
      return { mode: 'auto', startConstraint: { type: 'startNoLaterThan', date } }
    case 'finishNoEarlierThan':
      return { mode: 'auto', finishConstraint: { type: 'finishNoEarlierThan', date } }
    case 'finishNoLaterThan':
      return { mode: 'auto', finishConstraint: { type: 'finishNoLaterThan', date } }
    default:
      // 损坏 / 手工改过的存档会带非法的 constraint type。若静默返回 `undefined`，
      // 会存下 `scheduling: undefined` 并在随后的 solve() 里炸 —— 与 migrateTaskV1ToV2
      // 同一立场：形状不符就**抛错**，绝不静默丢字段。
      throw new Error(
        `v5 存档的任务 scheduling.type 非法（${String(type)}），已拒绝迁移以免损坏数据`,
      )
  }
}

/**
 * 单条依赖的 lag：裸数字 → `workdays` 包装；已是 `Lag` 对象则原样（幂等）。
 *
 * 刻意**不**复用 scheduler 的 `asLag` —— persist 层不依赖 scheduler 内部实现，
 * 迁移自己写出 `{ kind: 'workdays', days: n }`。
 */
export function migrateLagV5ToV6(lag: Lag | number): Lag {
  return typeof lag === 'number' ? { kind: 'workdays', days: lag } : lag
}

/**
 * v5 项目整体迁到 **v6**（= 当前版本）。纯函数，入参不被改动。
 *
 * v5 → v6 是本计划**唯一**的一次 schema 跳变：把 `Scheduling` 从旧的
 * `auto | constraint` 六型重构为 `auto(成对约束) | manual`，把 `Dependency.lag`
 * 从裸数字统一成带单位的 `Lag` 联合类型。逐行映射见 spec §1.3。
 *
 * manual 换算用项目日历按 `taskFinish` / `taskStart` 口径折算（与引擎同一份工作日
 * 原语）—— 日历取 `project.calendarId` 指向的日历，缺省兜底标准日历。
 *
 * ⚠️ 写死字面量 `6` 而**不是** `SCHEMA_VERSION`（逐跳契约，见 migrateV1ToV2 说明）。
 */
export function migrateV5ToV6(project: V5Project): Project {
  const calendar = project.calendars[project.calendarId] ?? createCalendar()

  const tasks: Record<string, Task> = {}
  for (const [id, task] of Object.entries(project.tasks)) {
    tasks[id] = {
      ...task,
      scheduling: migrateSchedulingV5ToV6(task.scheduling, task.duration, calendar),
    }
  }

  const dependencies: Record<string, Dependency> = {}
  for (const [id, dep] of Object.entries(project.dependencies)) {
    dependencies[id] = { ...dep, lag: migrateLagV5ToV6(dep.lag) }
  }

  const { schemaVersion: _drop, tasks: _tasks, dependencies: _deps, ...rest } = project
  return { ...rest, schemaVersion: 6, tasks, dependencies }
}
