import type {
  Calendar,
  CalendarId,
  DateStr,
  Dependency,
  DependencyType,
  Project,
  Task,
  TaskId,
} from './types'
import { formatDate } from '../dateUtils'

export const DEFAULT_CALENDAR_ID: CalendarId = 'default'

/** 与设计文档一致的 schema 版本，持久化时用于校验 */
export const SCHEMA_VERSION = 1

let counter = 0

/** 单调递增的本地 id。不用 crypto.randomUUID 是为了在测试里输出可读、可断言 */
export function nextId(prefix: string): string {
  counter += 1
  return `${prefix}_${counter.toString(36)}`
}

/** 仅供测试使用：重置 id 计数器，让断言可复现 */
export function resetIdCounter(): void {
  counter = 0
}

/**
 * 从已载入的项目中恢复 id 计数器。
 *
 * 页面重载后模块级计数器会归零。若不重新播种，新建的 id 会与项目中
 * 已存在的 id 重复，而 Project.tasks / dependencies 等都是 keyed Record
 * —— 重复的 key 会静默覆盖原有数据。
 */
export function seedIdCounterFromProject(project: Project): void {
  let max = 0

  const scan = (id: string): void => {
    const suffix = id.split('_').pop()
    if (!suffix) return
    const value = Number.parseInt(suffix, 36)
    if (Number.isFinite(value) && value > max) max = value
  }

  scan(project.id)
  for (const id of Object.keys(project.tasks)) scan(id)
  for (const id of Object.keys(project.dependencies)) scan(id)
  for (const id of Object.keys(project.resources)) scan(id)
  for (const id of Object.keys(project.assignments)) scan(id)

  counter = Math.max(counter, max)
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

export function createProject(
  name: string,
  startDate: DateStr = formatDate(new Date()),
): Project {
  const now = new Date().toISOString()
  return {
    id: nextId('proj'),
    name,
    schemaVersion: SCHEMA_VERSION,
    startDate,
    calendarId: DEFAULT_CALENDAR_ID,
    calendars: { [DEFAULT_CALENDAR_ID]: createCalendar() },
    tasks: {},
    rootIds: [],
    dependencies: {},
    resources: {},
    assignments: {},
    createdAt: now,
    updatedAt: now,
  }
}

export interface CreateTaskInput {
  name: string
  parentId?: TaskId | null
  duration?: number
  isMilestone?: boolean
}

/**
 * 注意：当 `isMilestone` 为真时，会忽略传入的 `duration` 并强制为 0
 * （里程碑是零工期的时间点），`duration` 参数在此情况下不生效。
 */
export function createTask(input: CreateTaskInput): Task {
  const isMilestone = input.isMilestone ?? false
  return {
    id: nextId('task'),
    name: input.name,
    parentId: input.parentId ?? null,
    childIds: [],
    isMilestone,
    duration: isMilestone ? 0 : (input.duration ?? 1),
    scheduling: { mode: 'auto' },
    progress: 0,
    effortMode: 'fixedDuration',
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
