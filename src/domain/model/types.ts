export type TaskId = string
export type ResourceId = string
export type CalendarId = string
export type DependencyId = string

/** ISO 日历日，格式 YYYY-MM-DD，按本地时区解释 */
export type DateStr = string

// ── 日历 ────────────────────────────────────────────────

export type CalendarException =
  | { kind: 'holiday' }
  | { kind: 'custom'; start: string; end: string }

export interface Calendar {
  id: CalendarId
  name: string
  /** 索引 0=周一 … 6=周日 */
  workingDays: [boolean, boolean, boolean, boolean, boolean, boolean, boolean]
  hoursPerDay: number
  /** key 为 YYYY-MM-DD */
  exceptions: Record<DateStr, CalendarException>
}

// ── 任务 ────────────────────────────────────────────────

export type ConstraintType =
  | 'startOn'
  | 'finishOn'
  | 'startNoEarlierThan'
  | 'startNoLaterThan'
  | 'finishNoEarlierThan'
  | 'finishNoLaterThan'

export type Scheduling =
  | { mode: 'auto' }
  | { mode: 'constraint'; type: ConstraintType; date: DateStr }

export type EffortMode = 'fixedDuration' | 'fixedEffort'

export interface Task {
  id: TaskId
  name: string
  parentId: TaskId | null
  /** 数组顺序即树序 */
  childIds: TaskId[]
  isMilestone: boolean
  /** 工作日数；里程碑恒为 0 */
  duration: number
  scheduling: Scheduling
  /** 0–100 */
  progress: number
  effortMode: EffortMode
  /** 人·工作日，第二阶段使用 */
  effort?: number
}

// ── 依赖 ────────────────────────────────────────────────

export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF'

export interface Dependency {
  id: DependencyId
  fromTaskId: TaskId
  toTaskId: TaskId
  type: DependencyType
  /** 工作日，可为负 = 提前量 */
  lag: number
}

// ── 资源（终态模型，第一阶段不使用）─────────────────────

export type ResourceKind = 'group' | 'staff' | 'equipment' | 'material' | 'cost'

export interface Resource {
  id: ResourceId
  name: string
  kind: ResourceKind
  parentId: ResourceId | null
  calendarId?: CalendarId
  /** 0–1 可用率 */
  availability: number
  cost: { rate: number; per: 'hour' | 'day' | 'unit'; currency: string }
  efficiency?: number
  note?: string
}

export interface Assignment {
  id: string
  taskId: TaskId
  resourceId: ResourceId
  /** 0–1 投入比例 */
  units: number
  quantity?: number
}

// ── 项目 ────────────────────────────────────────────────

export interface Project {
  id: string
  name: string
  schemaVersion: number
  /** 项目基准开始日期，CPM 正推的起点 */
  startDate: DateStr
  calendarId: CalendarId
  calendars: Record<CalendarId, Calendar>
  tasks: Record<TaskId, Task>
  rootIds: TaskId[]
  dependencies: Record<DependencyId, Dependency>
  resources: Record<ResourceId, Resource>
  assignments: Record<string, Assignment>
  createdAt: string
  updatedAt: string
}

// ── 派生数据（不进 Project，不落盘，不入撤销栈）──────────

export interface ComputedSchedule {
  earlyStart: DateStr
  earlyFinish: DateStr
  lateStart: DateStr
  lateFinish: DateStr
  /** 总浮时（工作日） */
  totalSlack: number
  isCritical: boolean
}

export type ConflictKind =
  | 'constraintViolatedByDependency'
  | 'impossibleConstraint'

export interface ConflictInfo {
  taskId: TaskId
  kind: ConflictKind
  message: string
}

export interface ScheduleResult {
  schedules: Record<TaskId, ComputedSchedule>
  conflicts: ConflictInfo[]
}
