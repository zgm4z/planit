import type { ComputedSchedule, DateStr, Project, Task, TaskCosts, TaskId, TaskKind } from '../domain/model/types'

/**
 * 列的**标识**：可序列化，进 localStorage 的就是这一层。
 *
 * 与 `OutlineColumn`（渲染描述）分成两个类型的理由见 spec §4.1：
 * localStorage 里只能存标识，宽度 / i18n key / 取值函数存不进去、也不该存。
 */
export type OutlineColumnKey =
  // 本版（v0.3）可用 —— 11 个
  | 'kind'
  | 'title'
  | 'note'
  | 'id'
  | 'start'
  | 'finish'
  | 'duration'
  | 'priority'
  | 'progress'
  | 'totalSlack'
  | 'freeSlack'
  // v0.5 解禁：这 5 列有了真实数据来源（项目的 assignments 反查、引擎的 efforts / costs）
  // 与 v1.0 的基线与挣值列区分开 —— 后 11 个仍是「显示但禁用」。
  | 'assignees'
  | 'effort'
  | 'taskCost'
  | 'resourceCost'
  | 'totalCost'
  // 显示但禁用（依赖 v1.0 的基线与挣值功能）—— 11 个
  | 'baselineStart'
  | 'baselineFinish'
  | 'startVariance'
  | 'finishVariance'
  | 'bcws'
  | 'bcwp'
  | 'acwp'
  | 'cv'
  | 'sv'
  | 'eac'
  | 'bac'

/** 列的**渲染描述**。**不进 localStorage** —— 那里只存 `OutlineColumnKey`。 */
export interface OutlineColumn {
  key: OutlineColumnKey
  width: number
  /** 表头文案的 i18n key */
  labelKey: string
  /** 该列是否可用（依赖的功能是否已实现） */
  enabled: boolean
  /** 禁用时的说明（tooltip），如「需要资源与工作量功能（v0.5）」 */
  disabledReasonKey?: string
  /** title 列用 flex:1，其余固定宽 */
  flex?: boolean
}

/** 依赖 v1.0 的基线与挣值功能的列 */
const BASELINE_REASON = 'outline.disabledReason.baseline'

/**
 * **完整的列注册表**。数组顺序即渲染顺序（表头、单元格、菜单都读它）。
 *
 * 「分批原则」（ROADMAP「通用约定」）：每个条目三选一 —— 可用 / 显示但禁用 + 注明版本 /
 * 不出现。跨项目依赖（「在以下项目之前开始」等）属第三类：架构上不可能，因此
 * **不在这里**，也不在菜单里。
 *
 * 禁用列也必须给 width / labelKey —— 菜单里要显示它们的名字，只是点不动。
 */
export const OUTLINE_COLUMNS: readonly OutlineColumn[] = [
  { key: 'kind', width: 28, labelKey: 'outline.columns.kind', enabled: true },
  { key: 'title', width: 240, labelKey: 'outline.columns.title', enabled: true, flex: true },
  { key: 'note', width: 160, labelKey: 'outline.columns.note', enabled: true },
  { key: 'id', width: 120, labelKey: 'outline.columns.id', enabled: true },
  { key: 'start', width: 100, labelKey: 'outline.columns.start', enabled: true },
  { key: 'finish', width: 100, labelKey: 'outline.columns.finish', enabled: true },
  { key: 'duration', width: 80, labelKey: 'outline.columns.duration', enabled: true },
  { key: 'priority', width: 80, labelKey: 'outline.columns.priority', enabled: true },
  { key: 'progress', width: 80, labelKey: 'outline.columns.progress', enabled: true },
  { key: 'totalSlack', width: 90, labelKey: 'outline.columns.totalSlack', enabled: true },
  { key: 'freeSlack', width: 90, labelKey: 'outline.columns.freeSlack', enabled: true },

  // v0.5：以下 5 列有了真实数据来源（引擎的 efforts / costs 与项目的 assignments）
  { key: 'assignees', width: 120, labelKey: 'outline.columns.assignees', enabled: true },
  { key: 'effort', width: 100, labelKey: 'outline.columns.effort', enabled: true },
  { key: 'taskCost', width: 100, labelKey: 'outline.columns.taskCost', enabled: true },
  { key: 'resourceCost', width: 100, labelKey: 'outline.columns.resourceCost', enabled: true },
  { key: 'totalCost', width: 100, labelKey: 'outline.columns.totalCost', enabled: true },

  { key: 'baselineStart', width: 110, labelKey: 'outline.columns.baselineStart', enabled: false, disabledReasonKey: BASELINE_REASON },
  { key: 'baselineFinish', width: 110, labelKey: 'outline.columns.baselineFinish', enabled: false, disabledReasonKey: BASELINE_REASON },
  { key: 'startVariance', width: 100, labelKey: 'outline.columns.startVariance', enabled: false, disabledReasonKey: BASELINE_REASON },
  { key: 'finishVariance', width: 100, labelKey: 'outline.columns.finishVariance', enabled: false, disabledReasonKey: BASELINE_REASON },
  { key: 'bcws', width: 90, labelKey: 'outline.columns.bcws', enabled: false, disabledReasonKey: BASELINE_REASON },
  { key: 'bcwp', width: 90, labelKey: 'outline.columns.bcwp', enabled: false, disabledReasonKey: BASELINE_REASON },
  { key: 'acwp', width: 90, labelKey: 'outline.columns.acwp', enabled: false, disabledReasonKey: BASELINE_REASON },
  { key: 'cv', width: 80, labelKey: 'outline.columns.cv', enabled: false, disabledReasonKey: BASELINE_REASON },
  { key: 'sv', width: 80, labelKey: 'outline.columns.sv', enabled: false, disabledReasonKey: BASELINE_REASON },
  { key: 'eac', width: 80, labelKey: 'outline.columns.eac', enabled: false, disabledReasonKey: BASELINE_REASON },
  { key: 'bac', width: 80, labelKey: 'outline.columns.bac', enabled: false, disabledReasonKey: BASELINE_REASON },
]

/**
 * 大纲视图的初始可见列。spec 没有规定默认集 —— 取「看排期时最常用的五列」。
 * 必须已按注册表顺序排列，且含 `title`（否则首次打开就是一张空表）。
 */
export const DEFAULT_VISIBLE_COLUMNS: OutlineColumnKey[] = [
  'kind',
  'title',
  'start',
  'finish',
  'duration',
]

/**
 * 甘特视图左列固定渲染的两列：类型图标 + 标题。
 * 用 filter 而不是手写两个字面量，保证取到的就是注册表里那一份（宽度不会漂）。
 */
export const GANTT_OUTLINE_COLUMNS: OutlineColumn[] = OUTLINE_COLUMNS.filter(
  (column) => column.key === 'kind' || column.key === 'title',
)

/**
 * 列宽转成 CSS 的 `flex` 值：`title` 列吃剩余宽度（`1 1 Wpx`），其余固定宽且不收缩
 * （`0 0 Wpx`）。
 *
 * **这是「表头必须与单元格逐列对齐」这条不变量的唯一实现**：表头（OutlineTable）
 * 与正文单元格（OutlineTree）都读它。曾经两处各存一份完全相同的实现——将来改规则
 * （比如引入 flex-shrink）会静默错位，而且没有任何测试看得见。放这里是因为本模块
 * 已经是列定义（宽度 / flex 标志）的权威位置，且刻意不依赖 i18n / React。
 */
export function cellFlex(column: OutlineColumn): string {
  return column.flex ? `1 1 ${column.width}px` : `0 0 ${column.width}px`
}

/** localStorage 里只能存 key，这里是 key 的运行时白名单（载入时的校验靠它） */
const COLUMN_KEYS: ReadonlySet<string> = new Set(OUTLINE_COLUMNS.map((column) => column.key))

/** **本版可用**的 key 集合 —— 与 COLUMN_KEYS 的区别是它排除了禁用列 */
const ENABLED_KEYS: ReadonlySet<string> = new Set(
  OUTLINE_COLUMNS.filter((column) => column.enabled).map((column) => column.key),
)

/** 注册表里**认识**这个 key 吗（不区分可用 / 禁用） */
export function isOutlineColumnKey(value: unknown): value is OutlineColumnKey {
  return typeof value === 'string' && COLUMN_KEYS.has(value)
}

/**
 * 这个 key 本版**可用**吗（不只是「认识」）。载入 localStorage 时用它过滤。
 *
 * 为什么必须过滤**禁用**列、而不只是「不认识的」列：禁用列在菜单里的开关是
 * disabled 的，用户**没有办法把它关掉** —— 一旦它真出现在表里，就会卡住一个
 * 恒空、又删不掉的列。所以「载入时只接受本版能真正渲染出内容的列」。
 */
export function isEnabledOutlineColumnKey(value: unknown): value is OutlineColumnKey {
  return isOutlineColumnKey(value) && ENABLED_KEYS.has(value)
}

/**
 * 「用户看到的日期」的**唯一取值口径**：列表单元格与甘特条经这里取同一对字段。
 *
 * 为什么是单参、为什么不做方向分支：v0.2 已把「方向 × 顺序」解析烤进了引擎输出 ——
 * `scheduledStart` / `scheduledFinish` **就是**最终排期（见 ComputedSchedule 的注释）。
 * spec §4.2 的三参签名会让本函数再实现一遍方向判断，那正是 v0.2 偏差 3（`deriveKind`）
 * 刚消灭掉的「同一条规则两份实现」。保留这个名字，是为了让「列表与甘特条同口径」
 * 这条不变量有一个可指认的位置（甘特条侧读的是同一对字段，不需要改）。
 */
export function resolveScheduleDates(schedule: ComputedSchedule): {
  start: DateStr
  finish: DateStr
} {
  return { start: schedule.scheduledStart, finish: schedule.scheduledFinish }
}

/**
 * 单元格取值的**结构化**结果。
 *
 * 数字不在这里翻译成字符串 —— 「3 天 / 40%」的单位要跟语言走，
 * 而本模块刻意不依赖 i18n（单测因此不必初始化语言）。翻译在渲染层做。
 */
export type CellValue =
  | { type: 'text'; text: string }
  | { type: 'days'; count: number }
  | { type: 'percent'; value: number }
  /** v0.5：投入（人·工作日） */
  | { type: 'effort'; count: number }
  /** v0.5：成本金额。货币是资源级属性，在资源面板展示，这里只给数字 */
  | { type: 'cost'; amount: number }
  | { type: 'empty' }

export interface ColumnCellContext {
  task: Task
  /** 未选中 / 未算出排期时为 undefined —— 此时日期与浮时列渲染空白 */
  schedule: ComputedSchedule | undefined
  /**
   * 调用点（OutlineTree）会传它，但**本版没有任何 `case` 读它** —— 因此设为可选，
   * 免得每个调用点与测试都得糊一个没人消费的必填字段。等真有列需要项目级信息
   * （如跨项目依赖）时再让它派上用场。
   */
  project?: Project
  /** v0.5：引擎派生的投入（人·工作日）。UI 只读，不重算 */
  efforts?: Record<TaskId, number>
  /** v0.5：引擎派生的成本拆解。UI 只读，不重算 */
  costs?: Record<TaskId, TaskCosts>
}

const EMPTY: CellValue = { type: 'empty' }

/** 成本列：零成本按「没有」处理（不显示 0，与空值同形） */
function costCell(ctx: ColumnCellContext, taskId: TaskId, field: keyof TaskCosts): CellValue {
  const costs = ctx.costs?.[taskId]
  if (!costs || costs[field] === 0) return EMPTY
  return { type: 'cost', amount: costs[field] }
}

/**
 * kind 列的字形：分组 ▤ / 里程碑 ◆ / 任务 ▪。
 *
 * **分组为什么不是三角（▾）**：spec §4.1 说 kind 列的分组图标是 `▾`，同时又说
 * title 列「保留缩进与折叠箭头」—— 两条叠加会让摘要行并排出现两个一模一样的三角，
 * 用户分不清哪个可点（缺陷 1）。约定一行只留一个三角，且必须是**可交互**的那个
 * （title 列里可点的折叠按钮）。因此 kind 列的分组改用非三角的类型标记 `▤`。
 * 改这里之前先确认新字形**不是三角/箭头**，否则缺陷 1 复发。
 *
 * 这是 kind 列字形的**唯一权威来源** —— 渲染层（OutlineTree 的 KindCell）也读它。
 * 曾经渲染层另存了一份（`KIND_GLYPH`），两份一旦漂移没有任何测试能看见，
 * 正是本项目反复要避免的「同一条规则两份实现」。
 *
 * 为什么放在这个刻意不依赖 i18n 的模块里：字形是与语言无关的类型标记，
 * 不是需要在三种语言里各写一遍的文案，因此放这里不破坏「取值层不碰 i18n」的分层。
 */
const TASK_KIND_GLYPH: Record<TaskKind, string> = {
  group: '▤',
  milestone: '◆',
  task: '▪',
}

/**
 * 各列的取值来源（spec §4.2 的表）。`title` 也在这里给一个值，是为了「每个可用 key
 * 都有取值口径」这条不变式能整表断言；实际渲染时标题单元格走 OutlineTree 的专用
 * 渲染（缩进 + 折叠箭头），不读这个分支。
 *
 * 只有**可用**列有 case；禁用列（v0.5 起只剩 v1.0 的基线与挣值列）
 * 一律落进 default 返回空。它们永远不会被渲染：菜单里点不动，
 * 且载入配置时被 `isEnabledOutlineColumnKey` 挡在门外。
 */
export function getOutlineCellValue(key: OutlineColumnKey, ctx: ColumnCellContext): CellValue {
  const { task, schedule } = ctx

  switch (key) {
    case 'kind':
      return { type: 'text', text: TASK_KIND_GLYPH[task.kind] }
    case 'title':
      return { type: 'text', text: task.name }
    case 'note':
      return { type: 'text', text: task.note }
    case 'id':
      return { type: 'text', text: task.id }
    case 'start':
      return schedule ? { type: 'text', text: resolveScheduleDates(schedule).start } : EMPTY
    case 'finish':
      return schedule ? { type: 'text', text: resolveScheduleDates(schedule).finish } : EMPTY
    case 'duration':
      // 摘要行（group）**不给** duration：这个字段从不被维护 —— `summarizeParents`
      // （src/domain/scheduler/summarize.ts）只汇总排期 / 浮时，**不碰 duration**；
      // `task.indent` 把任务变成 group 时也不重置它。于是它会停在旧值（新建默认 1），
      // 而 duration 是**默认可见列**：摘要行会渲染成
      // `start=03-02 finish=03-06 duration=1 天`，三个数并排自相矛盾
      // （start/finish 是汇总值，duration 是陈旧字段）。Inspector 对摘要任务同样
      // 刻意隐藏 duration/progress —— 本 App 已声明这两个量对摘要无意义。
      if (task.kind === 'group') return EMPTY
      // 里程碑显示破折号：「0 天」会被误读成「有个零工期的活儿」
      return task.kind === 'milestone' ? { type: 'text', text: '—' } : { type: 'days', count: task.duration }
    case 'priority':
      return { type: 'text', text: String(task.priority) }
    case 'progress':
      // 同 duration：progress 也不被汇总（summarizeParents 不碰它），给摘要行一个
      // 陈旧的原始值只会误导。此处刻意用 EMPTY 而**不是**里程碑那个破折号 ——
      // 「—」的语义是「按定义为 0」（里程碑是零工期的点），摘要行是「本无此量」，
      // 两者语义不同，不能复用同一个字形。详见上面 duration 分支的注释。
      if (task.kind === 'group') return EMPTY
      return { type: 'percent', value: task.progress }
    case 'totalSlack':
      return schedule ? { type: 'days', count: schedule.totalSlack } : EMPTY
    case 'freeSlack':
      return schedule ? { type: 'days', count: schedule.freeSlack } : EMPTY
    case 'assignees': {
      const project = ctx.project
      if (!project) return EMPTY
      // 从 Assignment 反查资源名 —— 这是全项目**唯一**一处该反查。
      // 别处再写一遍就是「同一规则两份实现」（本项目出过的事故），
      // 将来改分配语义（如多资源排序 / 过滤失效资源）必须只改这里。
      const names = Object.values(project.assignments)
        .filter((assignment) => assignment.taskId === task.id)
        .map((assignment) => project.resources[assignment.resourceId]?.name)
        .filter((name): name is string => Boolean(name))
      return names.length > 0 ? { type: 'text', text: names.join(', ') } : EMPTY
    }
    case 'effort': {
      const effort = ctx.efforts?.[task.id]
      // 摘要行显示子任务之和（collectEfforts 会汇总），因此**不**对 group 特判
      return effort === undefined ? EMPTY : { type: 'effort', count: effort }
    }
    case 'taskCost':
      return costCell(ctx, task.id, 'task')
    case 'resourceCost':
      return costCell(ctx, task.id, 'resource')
    case 'totalCost':
      return costCell(ctx, task.id, 'total')
    default:
      // 全部禁用列（基线 / 挣值，v1.0）：本版没有数据来源
      return EMPTY
  }
}
