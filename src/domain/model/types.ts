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
  /**
   * 资源平衡优先级。**数值越大越优先**（越晚被平衡算法推迟）。
   * v0.2 埋的占位字段，v0.6 由 `scheduler/leveling.ts` 消费。
   */
  priority: number
  /**
   * 资源平衡时**至少**应推迟的工作日数（下界）。引擎必须遵守 ——
   * 但它会被夹到该任务的剩余浮时上限：超过浮时就不可能既遵守它又不违反依赖。
   * v0.2 埋的占位字段（当时注释写作「允许延迟」，与本版算法方向相反，已订正）。
   */
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

// ── 资源 ────────────────────────────────────────────────

/**
 * 资源类型收敛为 4 种。**没有 `'cost'`** —— v0.1 曾把它当一种类型，v0.5 反转：
 * OmniPlan 用**两个成本字段**（usage / hourly）区分，而不是靠类型。`'cost'` 类型
 * 会让引擎到处需要「如果是 cost 就跳过」的特判，两个字段能更准确地表达
 * 「同一个人既有差旅费又有小时费率」。
 */
export type ResourceKind = 'staff' | 'equipment' | 'material' | 'group'

export interface ResourceCost {
  /** 一次性使用成本 */
  usage?: number
  /** 小时费率 */
  hourly?: number
  currency: string
}

export interface Resource {
  id: ResourceId
  name: string
  kind: ResourceKind
  parentId: ResourceId | null
  email?: string
  calendarId?: CalendarId
  /** 0–1 可用率 */
  availability: number
  /** 资源可用的起始日（临时工 / 租期）。缺省表示不早于任何日期即可用 */
  availableFrom?: DateStr
  /** 资源可用的结束日。缺省表示不晚于任何日期 */
  availableUntil?: DateStr
  cost: ResourceCost
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
  /**
   * v1.0：基线快照列表（可多个，用于对比不同时间点）。
   * **落盘** —— 这是 schemaVersion 3→4 的原因。
   */
  baselines: Baseline[]
  /** 用于对比的当前基线；null 表示不对比 */
  activeBaselineId: string | null
  /**
   * v1.0：挣值的**基准日**（「到某日为止」的那个日）。
   * 缺省表示未设 —— 此时 PV / SV 算不出来（派生为 null），UI 提示用户设置。
   * 刻意**不**默认成 `new Date()`：墙上时钟会让黄金测试与 e2e 不可复现（计划偏差 3）。
   */
  statusDate?: DateStr
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

/** 一个任务的成本拆解（货币在资源级，见 Resource.cost.currency） */
export interface TaskCosts {
  /** 一次性使用成本之和 */
  task: number
  /** 小时费率 × 工时之和 */
  resource: number
  /** task + resource */
  total: number
}

/** 一个资源的派生的总计（资源面板的「总使用次数 / 总时数 / 总成本」） */
export interface ResourceSummary {
  assignments: number
  hours: number
  cost: number
}

/** 一处资源超载：某资源在某日负载 > 100%（spec §2 的「超载最严重的资源与日期」） */
export interface ResourceOverload {
  resourceId: ResourceId
  date: DateStr
  /** 该日负载（Σ assignmentUnits）。> 1 即超载 */
  load: number
}

/** v0.6：资源平衡的派生结果。**不进 Project、不落盘**（与 ComputedSchedule 同类） */
export interface LevelingResult {
  /**
   * 每个叶子被推迟的工作日数（含用户设的 `Task.delay`）。0 = 未被推。
   * 摘要任务不在此表 —— 平衡只作用于叶子。
   */
  delays: Record<TaskId, number>
  /** 平衡后**仍无法消除**的超载（浮时耗尽 / 无可推候选）。空数组 = 完全平衡 */
  unresolved: ResourceOverload[]
}

// ── 基线（v1.0）─────────────────────────────────────────

/** 一条任务的排期快照。**只快照排期**，不快照任务本身（spec §1.2） */
export interface BaselineEntry {
  /** 快照时的任务名 —— 任务被删除后仍能辨认这一条（见计划偏差 1 / spec 缺陷 D9） */
  name: string
  /** 基线排期，与 ComputedSchedule 同口径（工作日） */
  start: DateStr
  finish: DateStr
}

export interface Baseline {
  id: string
  name: string
  createdAt: string
  /** key 为**叶子任务** id。删任务**不**级联删条目 —— 基线是历史记录（spec §1.2） */
  entries: Record<TaskId, BaselineEntry>
}

/**
 * v1.0：一个任务的挣值派生量。**由引擎算出**，UI 只读、不重算。
 *
 * 单位：bac / ev / pv / sv 一律是**货币**（与 costs 同币种，货币在资源级）。
 * 注意 `sv` 是**货币**（EV − PV），与 `startVariance`（工作日）**不同量纲** —— spec 缺陷 D4。
 */
export interface EarnedValue {
  /** 完工预算（BAC）= 该任务的成本总额（costs.total；摘要为子任务之和） */
  bac: number
  /** 挣值（BCWP / EV）= bac × progress/100 —— progress 是 **0–100**（spec 缺陷 D1） */
  ev: number
  /** 计划值（BCWS / PV）。缺活动基线快照 / 缺基准日时为 **null**（不是 0，见计划偏差 4） */
  pv: number | null
  /** 进度差异（SV）= ev − pv（**货币**）。pv 为 null 时同为 null */
  sv: number | null
}

/** v1.0：一个任务相对**活动基线**的排期差异。差异为**工作日**口径（spec §1.3） */
export interface BaselineComparison {
  /** 基线开始日。无活动基线 / 该任务（叶子）无快照时为 undefined */
  baselineStart?: DateStr
  baselineFinish?: DateStr
  /** 当前 − 基线（工作日，**正数表示延后**） */
  startVariance?: number
  finishVariance?: number
}

export interface ScheduleResult {
  schedules: Record<TaskId, ComputedSchedule>
  conflicts: ConflictInfo[]
  /**
   * v0.5：每个任务的投入（人·工作日）。fixedEffort 取输入的 effort，
   * fixedDuration = Σunits × 工期；摘要任务为子任务之和。**UI 只读这里** ——
   * 不在 UI 里重算一遍 Σunits × duration（那是同一条规则的第二份实现）。
   */
  efforts: Record<TaskId, number>
  /** v0.5：每个任务的成本拆解，摘要为子任务之和 */
  costs: Record<TaskId, TaskCosts>
  /** v0.5：每个资源的派生总计（含零分配的资源） */
  resourceTotals: Record<ResourceId, ResourceSummary>
  /**
   * v0.6：资源平衡的派生结果（推量 + 平衡后仍存在的超载）。
   * **UI 只读这里** —— 负载与超载的判定在 `scheduler/leveling.ts`，不在 UI 重算。
   */
  leveling: LevelingResult
}
