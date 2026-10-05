export type TaskId = string
export type ResourceId = string
export type CalendarId = string
export type DependencyId = string
export type AssignmentId = string

/** ISO 日历日，格式 YYYY-MM-DD，按本地时区解释 */
export type DateStr = string

/**
 * 带时刻的日期，格式 YYYY-MM-DDTHH:mm，按本地时区解释、无秒。
 * 两个别名都放在此处（而非 dateTime.ts）—— 避免 types.ts ↔ dateTime.ts 的循环依赖。
 * ⚠️ 二者都是 `string` 别名、互相可赋值，编译期拦不住混用：
 * 承载时刻的字段只能经 dateTime.ts 的 toDateStr 归一后再进引擎（dateTime.guard.test.ts 守卫）。
 */
export type DateTimeStr = string

// ── 日历 ────────────────────────────────────────────────

export type CalendarException =
  | { kind: 'holiday' }
  // v0.8：时段本身有真实起止时刻。⚠️ 引擎**仍不消费**它（时段粒度排期不做）——
  // 存得下、但不参与排期；`isWorkday` 只按**日**查 `exceptions` 的键（见下方 Calendar）。
  | { kind: 'custom'; start: DateTimeStr; end: DateTimeStr }

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

/** start 侧的约束类型。约束日期是**输入锚点**，带时刻；引擎经 toDateStr 归一后再进 CPM。 */
export type StartConstraintType = 'startNoEarlierThan' | 'startNoLaterThan'
/** finish 侧的约束类型。约束日期是**输入锚点**，带时刻；引擎经 toDateStr 归一后再进 CPM。 */
export type FinishConstraintType = 'finishNoEarlierThan' | 'finishNoLaterThan'

/**
 * 任务的排期方式（spec §1.2）。
 *
 * - `auto`：交由引擎在「依赖允许的时间窗」内排。可同时挂**一个 start 约束 + 一个 finish 约束**
 *   （对齐 OmniPlan「每个任务一条 start 约束 + 一条 end 约束」）。
 * - `manual`：用户钉死的区间。早链 / 晚链一律取该区间为定值；引擎**不消费** `Task.duration`
 *   （区间宽度即真相）。里程碑 manual 时 `start === finish`。
 *
 * 旧形态的 `startOn` / `finishOn` 已移除：OmniPlan 没有「恰在当日」约束，钉死日期就是
 * 手动排期（corpus 的 48 个 `locked-start-date` 即真实用法）。
 */
export type Scheduling =
  | {
      mode: 'auto'
      startConstraint?: { type: StartConstraintType; date: DateTimeStr }
      finishConstraint?: { type: FinishConstraintType; date: DateTimeStr }
    }
  | { mode: 'manual'; start: DateTimeStr; finish: DateTimeStr }

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
   * **路线图里的所有版本都没做它** —— v0.5 的 spec 明确「拆分排期不在本版」，
   * v0.6 与 v1.0 也没纳入。所以它至今没有消费者，UI 上渲染为禁用态并注明
   * 「尚未排期」（按分批原则：不能指向一个不存在的版本号）。
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

/** 依赖延迟（lag）的三单位表示 */
export type Lag =
  | { kind: 'workdays'; days: number }
  | { kind: 'elapsedDays'; days: number }
  | { kind: 'percent'; value: number }

export interface Dependency {
  id: DependencyId
  fromTaskId: TaskId
  toTaskId: TaskId
  type: DependencyType
  /** 延迟量，支持工作日 / 自然日 / 百分比 */
  lag: Lag
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
  /** 资源可用的起始日（临时工 / 租期）。缺省表示不早于任何日期即可用。v0.8 起带时刻 */
  availableFrom?: DateTimeStr
  /** 资源可用的结束日。缺省表示不晚于任何日期。v0.8 起带时刻 */
  availableUntil?: DateTimeStr
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
  /** 项目基准开始日期，CPM 正推的起点。v0.8 起带时刻（默认 09:00）；引擎经 toDateStr 归一 */
  startDate: DateTimeStr
  /** 整条链从起点正推（forward）还是从终点逆推（backward） */
  schedulingDirection: SchedulingDirection
  /**
   * 项目结束锚点。语义随方向变化：
   *   forward  —— 「最晚必须完成」的期限。未设置即无期限
   *   backward —— 逆推终点。未设置时退回用正推算出的完成日
   * v0.8 起带时刻（默认 18:00 —— 「到该日结束」）。
   */
  endDate?: DateTimeStr
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
   * v0.8 起带时刻（默认 18:00 —— 「到该日为止」= 该日结束）。
   */
  statusDate?: DateTimeStr
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
  /**
   * 负浮时的**归因**（派生量，不落盘）：当本任务的最紧上界**唯一**由一条指向
   * manual 后继的出边给出时，记下该依赖的类型 / 有效 lag 工作日数 / 顶住它的边界日期。
   * 缺省 = 负浮时（若有）并非由某个 manual 后继单独造成（约束 / 资源 / auto 后继所致）。
   *
   * `lagDays` 口径：`workdays` / `percent` 折成工作日数；`elapsedDays` 折不成工作日，
   * 记 `0` —— 三语文案**不嵌 lag 数值**，只依赖 `boundary` 日期。
   */
  conflictBinding?: ConflictBinding
}

/** 负浮时归因到 manual 后继时的结构化参数（见 `ComputedSchedule.conflictBinding`）。 */
export interface ConflictBinding {
  depType: DependencyType
  lagDays: number
  /** 顶住前置的边界日期：FS/SS 取后继 `lateStart`、FF/SF 取后继 `lateFinish`（manual 即其钉住端） */
  boundary: DateStr
}

/** 冲突的说明参数。文案本身由 UI 层按当前语言渲染 —— 领域层不产出自然语言。 */
export type ConflictParams =
  | { kind: 'infeasibleSchedule'; slack: number }
  // 负浮时被 manual 后继顶住时归因到**被顶住的前置**（负浮时所在）。`slack` 与
  // infeasibleSchedule 同口径（负浮时量），便于 UI 统一显示；其余字段见 ConflictBinding。
  | { kind: 'dependencyViolation'; slack: number; depType: DependencyType; lagDays: number; boundary: DateStr }

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
  /**
   * 平衡是否因**安全预算**（迭代上限 / 墙钟）被提前中止（v0.7）。
   * true ⇒ `unresolved` 可能还含「本可继续化解」的超载，但**绝不挂起**。
   * 默认态 / 旧结果可省略（视为 false）。
   */
  budgetExhausted?: boolean
  /** 本次平衡实际消耗的迭代轮数（可观测；默认态/旧结果可省略） */
  iterations?: number
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
  /**
   * v1.0：每任务的挣值（BAC / EV / PV / SV）。**UI 只读这里** ——
   * `BAC × progress/100` 与计划完成比例的计算只在 `earnedValue.ts`，不在 UI 重算。
   */
  earnedValues: Record<TaskId, EarnedValue>
  /** v1.0：每任务相对活动基线的排期差异（工作日口径）。**UI 只读这里** */
  baselineDiffs: Record<TaskId, BaselineComparison>
}

// ── 蒙特卡洛模拟（Monte Carlo Simulation）───────────────

/**
 * 任务的不确定性参数（PERT 三点估算）。
 *
 * 使用 Beta 分布建模：最乐观（O）、最可能（M）、最悲观（P）。
 * 期望值 = (O + 4M + P) / 6，用于生成符合现实的工期分布。
 */
export interface TaskUncertainty {
  /** 任务 ID */
  taskId: TaskId
  /** 最乐观工期（工作日） */
  optimistic: number
  /** 最可能工期（工作日，通常是当前 duration） */
  mostLikely: number
  /** 最悲观工期（工作日） */
  pessimistic: number
}

/**
 * 蒙特卡洛模拟配置。
 *
 * 控制模拟的迭代次数和随机种子（可复现性）。
 */
export interface SimulationConfig {
  /** 模拟迭代次数。典型值：1000-10000 */
  iterations: number
  /** 随机种子（可选）。设置后模拟结果可复现 */
  seed?: number
  /** 每个任务的不确定性参数。未指定的任务使用确定性工期 */
  uncertainties: TaskUncertainty[]
}

/**
 * 单次模拟迭代的结果。
 *
 * 记录一次随机采样后的项目完成日期和关键路径。
 */
export interface IterationResult {
  /** 迭代序号（从 0 开始） */
  iteration: number
  /** 项目完成日期（DateStr） */
  finishDate: DateStr
  /** 项目工期（工作日） */
  duration: number
  /** 本次迭代的关键路径任务 ID 列表 */
  criticalPath: TaskId[]
}

/**
 * 直方图的单个区间（bin）。
 */
export interface HistogramBin {
  /** 区间下界（工作日） */
  min: number
  /** 区间上界（工作日） */
  max: number
  /** 落在该区间的迭代次数 */
  count: number
  /** 落在该区间的百分比（0-100） */
  percentage: number
}

/**
 * 完整的蒙特卡洛模拟结果。
 *
 * 包含统计摘要、直方图、百分位数和所有迭代详情。
 * **派生数据，不落盘，不入撤销栈**（与 ScheduleResult 同类）。
 */
export interface SimulationResult {
  /** 使用的模拟配置 */
  config: SimulationConfig
  /** 统计摘要 */
  statistics: {
    /** 平均工期（工作日） */
    mean: number
    /** 中位数工期（工作日） */
    median: number
    /** 标准差（工作日） */
    stdDev: number
    /** 最小工期（工作日） */
    min: number
    /** 最大工期（工作日） */
    max: number
  }
  /** 关键百分位数：P10, P50, P90, P95 等 */
  percentiles: Record<number, number>
  /** 工期分布直方图（通常 20-50 个区间） */
  histogram: HistogramBin[]
  /** 每个任务在关键路径上出现的频率（0-1） */
  criticalityIndex: Record<TaskId, number>
  /** 所有迭代的详细结果（可选，用于调试或详细分析） */
  iterations?: IterationResult[]
  /** 模拟执行时间（毫秒） */
  executionTime: number
}
