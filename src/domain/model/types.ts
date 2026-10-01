export type TaskId = string
export type ResourceId = string
export type CalendarId = string
export type DependencyId = string
export type AssignmentId = string

/** ISO 日历日，格式 YYYY-MM-DD，按本地时区解释 */
export type DateStr = string

// ── 日历 ────────────────────────────────────────────────

export type CalendarException =
  | { kind: 'holiday' }
  | { kind: 'custom'; start: DateStr; end: DateStr }

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

export type TaskKind = 'task' | 'milestone' | 'group'

/** 任务在「依赖允许的时间窗」内取早还是取晚 */
export type SchedulingOrder = 'asap' | 'alap'

/** 整条链从起点正推（forward）还是从终点逆推（backward） */
export type SchedulingDirection = 'forward' | 'backward'

export interface Task {
  id: TaskId
  name: string
  parentId: TaskId | null
  /** 数组顺序即树序 */
  childIds: TaskId[]
  /** 显式类型。`group` 与「有子任务」永远同步，由命令层维护（见 reconcileKind） */
  kind: TaskKind
  /** 工作日数；里程碑恒为 0 */
  duration: number
  scheduling: Scheduling
  /** 0–100 */
  progress: number
  effortMode: EffortMode
  /** 该任务在「依赖允许的时间窗」内尽量早做还是晚做。默认 asap */
  schedulingOrder: SchedulingOrder
  /** 备注。纯展示，引擎不消费。必填而非可选：v0.3 会把它做成常驻可编辑列，'' 省掉渲染处的 ?? '' */
  note: string
  /**
   * 占位：允许拆分。
   * 注意不是 v0.5 —— v0.5 的 spec 明确「拆分排期不在本版」，该版本里
   * 「允许拆分」仍保持禁用。所以它的消费者最早在 v0.6 之后。
   */
  allowSplitting: boolean
  /** 占位：平衡优先级。数值越大越优先，v0.6 消费 */
  priority: number
  /** 占位：平衡允许延迟的工作日数，v0.6 消费 */
  delay: number
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
  id: AssignmentId
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
  /** 整条链从起点正推（forward）还是从终点逆推（backward） */
  schedulingDirection: SchedulingDirection
  /**
   * 项目结束锚点。语义随方向变化：
   *   forward  —— 「最晚必须完成」的期限。未设置即无期限
   *   backward —— 逆推终点。未设置时退回用正推算出的完成日
   */
  endDate?: DateStr
  calendarId: CalendarId
  calendars: Record<CalendarId, Calendar>
  tasks: Record<TaskId, Task>
  rootIds: TaskId[]
  dependencies: Record<DependencyId, Dependency>
  resources: Record<ResourceId, Resource>
  assignments: Record<AssignmentId, Assignment>
  createdAt: string
  updatedAt: string
}

// ── 派生数据（不进 Project，不落盘，不入撤销栈）──────────

export interface ComputedSchedule {
  earlyStart: DateStr
  earlyFinish: DateStr
  lateStart: DateStr
  lateFinish: DateStr
  /**
   * 该任务在当前「方向 × 顺序」下**实际**落在的排期端。
   * 显示层（甘特条、大纲列、状态栏）只读这两个字段 ——
   * 它们才是「用户看到的日期」，early/late 是中间量。
   */
  scheduledStart: DateStr
  scheduledFinish: DateStr
  /** 总浮时（工作日） */
  totalSlack: number
  /**
   * 自由宽延（工作日）：本任务可推迟多久而不影响**任何后继任务**的最早开始。
   * 没有后继时与 totalSlack 相同。
   */
  freeSlack: number
  isCritical: boolean
}

/** 冲突的说明参数。文案本身由 UI 层按当前语言渲染 —— 领域层不产出自然语言。 */
export type ConflictParams =
  | { kind: 'constraintViolatedByDependency'; constraint: ConstraintType; date: DateStr; earliest: DateStr }
  | { kind: 'impossibleConstraint'; slack: number }

export type ConflictInfo = ConflictParams & { taskId: TaskId }

export interface ScheduleResult {
  schedules: Record<TaskId, ComputedSchedule>
  conflicts: ConflictInfo[]
}
