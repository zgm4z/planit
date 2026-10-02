import type {
  BaselineComparison,
  ComputedSchedule,
  DateStr,
  EarnedValue,
  Project,
  Task,
  TaskCosts,
  TaskId,
  TaskKind,
} from '../../domain/model/types'
import {
  OUTLINE_COLUMN_KEYS,
  isEnabledOutlineColumnKey,
  type OutlineColumnKey,
} from '../../store/columnKeys'
import type { ColumnWidths } from '../../store/viewStore'
import { resolveScheduleDates } from '../shared/scheduleDates'

/**
 * 列的**渲染描述**。**不进 localStorage** —— 那里只存 `OutlineColumnKey`。
 *
 * `OutlineColumnKey`（标识）与「哪些 key 可用」都在 `store/columnKeys.ts` ——
 * 依赖方向是 View → Store 单向，这里只加渲染概念（i18n / 像素宽 / 取值函数）。
 */
export interface OutlineColumn {
  key: OutlineColumnKey
  width: number
  /** 表头文案的 i18n key */
  labelKey: string
  /** 该列是否可用（依赖的功能是否已实现）—— 由 store 的可用性判定派生，不另存一份 */
  enabled: boolean
  /** 禁用时的说明（tooltip），如「需要资源与工作量功能（v0.5）」 */
  disabledReasonKey?: string
  /** title 列用 flex:1，其余固定宽 */
  flex?: boolean
}

/**
 * 依赖「实际成本录入」的列（本版无数据源，**尚未排期**）—— spec 缺陷 D2 / 计划偏差 2。
 *
 * 为什么写「尚未排期」而不是版本号：v1.0 是路线图的**最后一版**，这些条目再也
 * 指不出「某个版本」。写一个不存在的版本号（如 v1.1）是在许一个不会兑现的承诺 ——
 * 这条「指不出真实版本就写尚未排期」的规则由 v0.6 确立。
 */
const ACTUAL_COST_REASON = 'outline.disabledReason.actualCost'

/**
 * 每列的**渲染描述**（i18n key / 像素宽 / flex / 禁用原因）。**顺序不在这里** ——
 * 顺序是 store `OUTLINE_COLUMN_KEYS` 的注册顺序，`OUTLINE_COLUMNS` 由它 map 出来。
 *
 * 「分批原则」（ROADMAP「通用约定」）：每个条目三选一 —— 可用（**有真实数据来源**）/
 * 显示但禁用 + 注明原因 / 不出现。跨项目依赖（「在以下项目之前开始」等）属第三类：
 * 架构上不可能，因此**不在这里**，也不在菜单里。
 *
 * 禁用列也必须给 width / labelKey —— 菜单里要显示它们的名字，只是点不动。
 * 是否 `enabled` 不写在这里：它是**数据可用性**（store 的口径），这里只给禁用时的文案。
 */
const COLUMN_META: Record<OutlineColumnKey, Omit<OutlineColumn, 'key' | 'enabled'>> = {
  kind: { width: 28, labelKey: 'outline.columns.kind' },
  title: { width: 240, labelKey: 'outline.columns.title', flex: true },
  note: { width: 160, labelKey: 'outline.columns.note' },
  id: { width: 120, labelKey: 'outline.columns.id' },
  start: { width: 100, labelKey: 'outline.columns.start' },
  finish: { width: 100, labelKey: 'outline.columns.finish' },
  duration: { width: 80, labelKey: 'outline.columns.duration' },
  priority: { width: 80, labelKey: 'outline.columns.priority' },
  progress: { width: 80, labelKey: 'outline.columns.progress' },
  totalSlack: { width: 90, labelKey: 'outline.columns.totalSlack' },
  freeSlack: { width: 90, labelKey: 'outline.columns.freeSlack' },
  // v0.5：以下 5 列有了真实数据来源（引擎的 efforts / costs 与项目的 assignments）
  assignees: { width: 120, labelKey: 'outline.columns.assignees' },
  effort: { width: 100, labelKey: 'outline.columns.effort' },
  taskCost: { width: 100, labelKey: 'outline.columns.taskCost' },
  resourceCost: { width: 100, labelKey: 'outline.columns.resourceCost' },
  totalCost: { width: 100, labelKey: 'outline.columns.totalCost' },
  // v1.0：基线 4 列 + 可算的挣值 4 列解禁（真实数据源：基线快照的差异 / 引擎的 costs 与进度）
  baselineStart: { width: 110, labelKey: 'outline.columns.baselineStart' },
  baselineFinish: { width: 110, labelKey: 'outline.columns.baselineFinish' },
  startVariance: { width: 100, labelKey: 'outline.columns.startVariance' },
  finishVariance: { width: 100, labelKey: 'outline.columns.finishVariance' },
  bcws: { width: 90, labelKey: 'outline.columns.bcws' },
  bcwp: { width: 90, labelKey: 'outline.columns.bcwp' },
  sv: { width: 80, labelKey: 'outline.columns.sv' },
  bac: { width: 80, labelKey: 'outline.columns.bac' },
  // 依赖**实际成本**录入（本版无数据源）→ 显示但禁用 + 注明「尚未排期」。见计划偏差 2。
  acwp: { width: 90, labelKey: 'outline.columns.acwp', disabledReasonKey: ACTUAL_COST_REASON },
  cv: { width: 80, labelKey: 'outline.columns.cv', disabledReasonKey: ACTUAL_COST_REASON },
  eac: { width: 80, labelKey: 'outline.columns.eac', disabledReasonKey: ACTUAL_COST_REASON },
}

/**
 * **完整的列注册表**。数组顺序即渲染顺序（表头、单元格、菜单都读它）—— 顺序取
 * store 的 `OUTLINE_COLUMN_KEYS`（唯一权威），本模块只在其上贴渲染描述。
 *
 * `enabled` 由 `isEnabledOutlineColumnKey` **派生**（数据可用性是 store 的口径），
 * 而不是在这里再写一份字面量 —— 两处各写一次必然漂移。
 */
export const OUTLINE_COLUMNS: readonly OutlineColumn[] = OUTLINE_COLUMN_KEYS.map((key) => ({
  key,
  ...COLUMN_META[key],
  enabled: isEnabledOutlineColumnKey(key),
}))

/** < 1100 时按 §7 **强制隐藏**的低价值列（它们让位给标题列，不是等比压缩） */
const NARROW_HIDDEN_COLUMNS: readonly OutlineColumnKey[] = ['note', 'id', 'priority']

/** < 900 时**唯一保留**的四列 —— 顺序即 §7 的优先级 */
const COMPACT_KEPT_COLUMNS: readonly OutlineColumnKey[] = ['title', 'start', 'finish', 'duration']

/**
 * 某断点下**因响应式而必须隐藏**的列。
 *
 * 这**不是**用户的列偏好 —— 用户的偏好存在 `viewStore.visibleColumns` 里、写进
 * localStorage，绝不因为一次窄屏浏览而被改写（否则回到宽屏时用户会发现自己的
 * 列配置被悄悄改过）。这里返回的是一份**派生的、临时的**隐藏集，渲染时叠加在
 * 用户偏好**之上**：`有效列 = 用户偏好 − 响应式隐藏`。
 *
 * 永远不动 `title`（它是 COMPACT 的保留列之一，也是全表的地基）。
 */
export function responsiveHiddenColumns(isNarrow: boolean, isCompact: boolean): OutlineColumnKey[] {
  if (isCompact) {
    // 全量 key 减去保留列 —— 用一个正向的「保留集」表达，比逐列写 if 更难写错
    return OUTLINE_COLUMNS.map((column) => column.key).filter(
      (key) => !COMPACT_KEPT_COLUMNS.includes(key),
    )
  }
  if (isNarrow) return [...NARROW_HIDDEN_COLUMNS]
  return []
}

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

/**
 * 单元格取值的**结构化**结果。
 *
 * 数字不在这里翻译成字符串 —— 「3 天 / 40%」的单位要跟语言走，
 * 而本模块刻意不依赖 i18n（单测因此不必初始化语言）。翻译在渲染层做。
 */
export type CellValue =
  | { type: 'text'; text: string }
  /**
   * 日期。**与 `text` 分开**，好让渲染层统一过 `formatDate`（§1.3「日期一律
   * YYYY-MM-DD」）—— 与数字量纲各占一个变体是同一条分层原则：取值层给**类型化的
   * 值**，格式化只发生在 `format.ts`，两者不互相跑冒滴漏。
   */
  | { type: 'date'; value: DateStr }
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
  /** v1.0：引擎派生的挣值（BAC/EV/PV/SV）。UI 只读，不重算 —— 见计划偏差 2 / 4 */
  earnedValues?: Record<TaskId, EarnedValue>
  /** v1.0：引擎派生的相对活动基线的差异（工作日）。UI 只读，不重算 */
  baselineDiffs?: Record<TaskId, BaselineComparison>
}

const EMPTY: CellValue = { type: 'empty' }

/** 成本列：零成本按「没有」处理（不显示 0，与空值同形） */
function costCell(ctx: ColumnCellContext, taskId: TaskId, field: keyof TaskCosts): CellValue {
  const costs = ctx.costs?.[taskId]
  if (!costs || costs[field] === 0) return EMPTY
  return { type: 'cost', amount: costs[field] }
}

/**
 * 挣值列取值。与成本列的关键区别：**只有 null / undefined 才算空**。
 * `BAC = 0` / `EV = 0` 是**真实数据**（照常显示 0）；`PV` / `SV = null` 才是
 * 「算不出来」（缺基准日或缺活动基线）—— 见计划偏差 4。把二者混为一谈是本版
 * 最易写错处：把 null 当 0 会让一整列显示 0，看上去像「一切按计划进行」。
 */
function evCell(value: number | null | undefined): CellValue {
  return value === null || value === undefined ? EMPTY : { type: 'cost', amount: value }
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
 * 只有**可用**列有 case；禁用列（本版起只剩依赖实际成本录入的 acwp / cv / eac）
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
      return schedule ? { type: 'date', value: resolveScheduleDates(schedule).start } : EMPTY
    case 'finish':
      return schedule ? { type: 'date', value: resolveScheduleDates(schedule).finish } : EMPTY
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
    // 判定一律用 `=== undefined`（而不是真值）：与下面两个方差列同口径。DateStr
    // 永不为空串，二者当前等价，但同一函数里混用两种口径迟早被后人「统一」错方向。
    case 'baselineStart': {
      const diff = ctx.baselineDiffs?.[task.id]
      return diff?.baselineStart === undefined ? EMPTY : { type: 'date', value: diff.baselineStart }
    }
    case 'baselineFinish': {
      const diff = ctx.baselineDiffs?.[task.id]
      return diff?.baselineFinish === undefined ? EMPTY : { type: 'date', value: diff.baselineFinish }
    }
    // 差异是**工作日**（正数 = 延后），与 sv（货币）不同量纲 —— spec 缺陷 D4。
    // 摘要行不产生 diff 键（基线快照只含叶子）→ 这里自然落到 EMPTY，与 duration /
    // progress 对摘要行的惯例一致，无需特判。
    case 'startVariance': {
      const diff = ctx.baselineDiffs?.[task.id]
      return diff?.startVariance === undefined ? EMPTY : { type: 'days', count: diff.startVariance }
    }
    case 'finishVariance': {
      const diff = ctx.baselineDiffs?.[task.id]
      return diff?.finishVariance === undefined ? EMPTY : { type: 'days', count: diff.finishVariance }
    }
    case 'bcws':
      return evCell(ctx.earnedValues?.[task.id]?.pv)
    case 'bcwp':
      return evCell(ctx.earnedValues?.[task.id]?.ev)
    case 'sv':
      return evCell(ctx.earnedValues?.[task.id]?.sv)
    case 'bac':
      return evCell(ctx.earnedValues?.[task.id]?.bac)
    default:
      // 全部禁用列（v1.0 起只剩依赖实际成本录入的 acwp / cv / eac）：本版没有数据来源
      return EMPTY
  }
}

/**
 * 把用户的宽度覆盖合并进列描述 —— **宽度进入渲染的唯一入口**。
 *
 * 返回的新数组里，被拖过的列 `width` 换成用户值、`flex` 置 false（「拖了即固定」）；
 * 没拖过的列**原样返回同一个对象**（`toBe` 可断言），于是 title 的 `flex: true`
 * 与「从没拖过」完全等价 —— 这是 `resetColumnWidth` 敢用「删除 key」实现的地基。
 *
 * 为什么在这里合并、而不是让 `cellFlex` 去查 store：`cellFlex` 是「表头必须与
 * 单元格逐列对齐」这条不变量的**唯一实现**，表头（`OutlineTable`）与单元格
 * （`OutlineTree`）读的是**同一个** `columns` 数组。宽度在数组进入这两个组件
 * **之前**就已合并完毕，「表头用新宽度、单元格用旧宽度」这类中间态在结构上
 * 不可能出现 —— 本项目反复踩的「同一条规则两份实现」，在这里天然不成立。
 */
export function applyColumnWidths(
  columns: readonly OutlineColumn[],
  widths: ColumnWidths,
): OutlineColumn[] {
  return columns.map((column) => {
    const width = widths[column.key]
    return width === undefined ? column : { ...column, width, flex: false }
  })
}
