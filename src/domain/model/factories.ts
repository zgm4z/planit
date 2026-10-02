import type {
  Assignment,
  Calendar,
  CalendarId,
  Dependency,
  DependencyType,
  EffortMode,
  Project,
  Resource,
  ResourceId,
  ResourceKind,
  Task,
  TaskId,
  TaskKind,
} from './types'
import { formatDate } from '../dateUtils'
import { DEFAULT_START_TIME, ensureDateTime } from '../calendar/dateTime'

export const DEFAULT_CALENDAR_ID: CalendarId = 'default'

/** 与设计文档一致的 schema 版本，持久化时用于校验 */
export const SCHEMA_VERSION = 5

let counter = 0

/** 单调递增的本地 id。不用 crypto.randomUUID 是为了在测试里输出可读、可断言 */
export function nextId(prefix: string): string {
  counter += 1
  return `${prefix}_${counter.toString(36)}`
}

/** 仅供测试使用：重置 id 计数器，让断言可复现 */
export function __resetIdCounterForTests(): void {
  counter = 0
}

/**
 * 从一组已有的 id 中恢复计数器。
 *
 * 页面重载后模块级计数器会归零。**任何会生成新 id 的入口都必须先播种**，
 * 否则新 id 会与既有数据冲突 —— Project.tasks 是 keyed Record，
 * 而 IndexedDB 的 keyPath 是 project.id，重复 key 都会静默覆盖而非报错。
 */
export function seedIdCounterFromIds(ids: readonly string[]): void {
  let max = 0

  const scan = (id: string): void => {
    const suffix = id.split('_').pop()
    if (!suffix) return
    const value = Number.parseInt(suffix, 36)
    if (!Number.isNaN(value) && value > max) max = value
  }

  for (const id of ids) scan(id)

  // 用 Math.max 而非直接赋值 —— 同一会话里计数器只能前进不能回退，
  // 否则会重新发出已经用过的 id
  counter = Math.max(counter, max)
}

/**
 * 从已载入的项目中恢复 id 计数器（含它内部的任务、依赖、资源 id）。
 *
 * 页面重载后模块级计数器会归零。若不重新播种，新建的 id 会与项目中
 * 已存在的 id 重复，而 Project.tasks / dependencies 等都是 keyed Record
 * —— 重复的 key 会静默覆盖原有数据。
 *
 * v1.0 起也扫基线 id：`Project.baselines` 是**数组**（不是 Record），撞 id
 * 不会静默覆盖，但会让 `activeBaselineId` 指向错误的基线 —— 比覆盖更难查。
 */
export function seedIdCounterFromProject(project: Project): void {
  seedIdCounterFromIds([
    project.id,
    ...Object.keys(project.tasks),
    ...Object.keys(project.dependencies),
    ...Object.keys(project.resources),
    ...Object.keys(project.assignments),
    ...project.baselines.map((baseline) => baseline.id),
  ])
}

export function createCalendar(id: CalendarId = DEFAULT_CALENDAR_ID): Calendar {
  return {
    id,
    name: '标准日历',
    workingDays: [true, true, true, true, true, false, false],
    hoursPerDay: 8,
    exceptions: {},
  }
}

/**
 * 新建项目。第二参**可选**：既有的 `createProject('测试', '2026-03-02')` 调用点一行不改 ——
 * 纯日期被 `ensureDateTime` 补成 `'2026-03-02T09:00'`；已带时刻的串被原样保留
 * （用 `ensureDateTime` 而非 `toDateTime` 就是为了「已是带时刻就保留」）。
 * 缺省起点 = 今天 09:00。
 */
export function createProject(
  name: string,
  startDate?: string,
): Project {
  const now = new Date().toISOString()
  return {
    id: nextId('proj'),
    name,
    schemaVersion: SCHEMA_VERSION,
    startDate: ensureDateTime(startDate ?? formatDate(new Date()), DEFAULT_START_TIME),
    schedulingDirection: 'forward',
    calendarId: DEFAULT_CALENDAR_ID,
    calendars: { [DEFAULT_CALENDAR_ID]: createCalendar() },
    tasks: {},
    rootIds: [],
    dependencies: {},
    resources: {},
    assignments: {},
    // statusDate 刻意不写 —— 缺省即「未设基准日」（PV / SV 暂不可算）
    baselines: [],
    activeBaselineId: null,
    createdAt: now,
    updatedAt: now,
  }
}

export interface CreateTaskInput {
  name: string
  parentId?: TaskId | null
  duration?: number
  kind?: TaskKind
  effortMode?: EffortMode
  effort?: number
}

/**
 * 注意：`kind` 为 `'milestone'` 时，会忽略传入的 `duration` 并强制为 0
 * （里程碑是零工期的时间点），`duration` 参数在此情况下不生效。
 *
 * 这里的 `kind` 只决定**初始**类型：调用方若随后往里塞子任务，
 * 必须自行调 `reconcileKind` 把它改成 `group`。工厂不知道结构会怎么变。
 */
export function createTask(input: CreateTaskInput): Task {
  const kind = input.kind ?? 'task'
  return {
    id: nextId('task'),
    name: input.name,
    parentId: input.parentId ?? null,
    childIds: [],
    kind,
    duration: kind === 'milestone' ? 0 : (input.duration ?? 1),
    scheduling: { mode: 'auto' },
    progress: 0,
    schedulingOrder: 'asap',
    note: '',
    allowSplitting: false,
    priority: 0,
    effortMode: input.effortMode ?? 'fixedDuration',
    effort: input.effort,
    delay: 0,
  }
}

export function createDependency(
  fromTaskId: TaskId,
  toTaskId: TaskId,
  type: DependencyType = 'FS',
  lag = 0,
): Dependency {
  return { id: nextId('dep'), fromTaskId, toTaskId, type, lag }
}

export interface CreateResourceInput {
  name: string
  kind?: ResourceKind
  parentId?: ResourceId | null
  availability?: number
}

/** 新资源的默认可用率 = 1（100%），货币默认 CNY —— 都可在资源面板改 */
export function createResource(input: CreateResourceInput): Resource {
  return {
    id: nextId('res'),
    name: input.name,
    kind: input.kind ?? 'staff',
    parentId: input.parentId ?? null,
    availability: input.availability ?? 1,
    cost: { currency: 'CNY' },
  }
}

export interface CreateAssignmentInput {
  taskId: TaskId
  resourceId: ResourceId
  units?: number
}

export function createAssignment(input: CreateAssignmentInput): Assignment {
  return {
    id: nextId('asg'),
    taskId: input.taskId,
    resourceId: input.resourceId,
    units: input.units ?? 1,
  }
}
