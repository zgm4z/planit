import type { ComputedSchedule, DateStr, Project, Task, TaskKind } from '../domain/model/types'

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
  // 显示但禁用（依赖未实现的功能）—— 16 个
  //
  // 注意 `assignees` 在这里，而不是上面：spec §4.1 把它列进「本版可用」，
  // 但 §4.2 说它「本版留空占位（v0.5 填数据）」—— 没有真实数据来源，
  // 按 ROADMAP 的分批原则应当「显示但禁用」。见计划开头的偏差 5。
  | 'assignees'
  | 'effort'
  | 'taskCost'
  | 'resourceCost'
  | 'totalCost'
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

/** 依赖 v0.5 的资源与工作量功能的列 */
const RESOURCES_REASON = 'outline.disabledReason.resources'
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

  // assignees 与成本类同组：都是「数据要等 v0.5 的资源与分配落地」才有的列
  { key: 'assignees', width: 120, labelKey: 'outline.columns.assignees', enabled: false, disabledReasonKey: RESOURCES_REASON },
  { key: 'effort', width: 100, labelKey: 'outline.columns.effort', enabled: false, disabledReasonKey: RESOURCES_REASON },
  { key: 'taskCost', width: 100, labelKey: 'outline.columns.taskCost', enabled: false, disabledReasonKey: RESOURCES_REASON },
  { key: 'resourceCost', width: 100, labelKey: 'outline.columns.resourceCost', enabled: false, disabledReasonKey: RESOURCES_REASON },
  { key: 'totalCost', width: 100, labelKey: 'outline.columns.totalCost', enabled: false, disabledReasonKey: RESOURCES_REASON },

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
  | { type: 'empty' }

export interface ColumnCellContext {
  task: Task
  /** 未选中 / 未算出排期时为 undefined —— 此时日期与浮时列渲染空白 */
  schedule: ComputedSchedule | undefined
  project: Project
}

const EMPTY: CellValue = { type: 'empty' }

/** 类型列的图标：分组 ▾ / 里程碑 ◆ / 任务 ▪ */
const TASK_KIND_GLYPH: Record<TaskKind, string> = {
  group: '▾',
  milestone: '◆',
  task: '▪',
}

/**
 * 各列的取值来源（spec §4.2 的表）。`title` 也在这里给一个值，是为了「每个可用 key
 * 都有取值口径」这条不变式能整表断言；实际渲染时标题单元格走 OutlineTree 的专用
 * 渲染（缩进 + 折叠箭头），不读这个分支。
 *
 * 只有**可用**列有 case；禁用列（含 `assignees` —— 它要等 v0.5 的分配数据）
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
      // 里程碑显示破折号：「0 天」会被误读成「有个零工期的活儿」
      return task.kind === 'milestone' ? { type: 'text', text: '—' } : { type: 'days', count: task.duration }
    case 'priority':
      return { type: 'text', text: String(task.priority) }
    case 'progress':
      return { type: 'percent', value: task.progress }
    case 'totalSlack':
      return schedule ? { type: 'days', count: schedule.totalSlack } : EMPTY
    case 'freeSlack':
      return schedule ? { type: 'days', count: schedule.freeSlack } : EMPTY
    default:
      // 全部禁用列（assignees / 成本 / 基线 / 挣值）：本版没有数据来源
      return EMPTY
  }
}
