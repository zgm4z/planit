/**
 * 列的**标识词汇**：可序列化、与渲染无关的「有哪些列 / 哪些本版可用 / 默认看哪些」。
 *
 * **为什么它在 store 而不是 ui**：设计文档 §3 定的依赖方向是
 * **View → Command → Store → Domain** 单向。`viewStore` 需要这套词汇来校验并持久化
 * `visibleColumns`（载入 localStorage 时过滤不认识的 key、按注册顺序归一化），
 * 若把它留在 `ui/`，store 就不得不反向 import ui 侧的模块 —— 方向倒置（曾经的实情）。
 * 因此把**可序列化的列标识**下沉到这里；`ui/outline/outlineColumns.ts` 反过来 import 本模块，
 * 只在其上加**渲染描述**（i18n 的 labelKey / 像素宽 / flex / 禁用原因 tooltip / 取值函数）。
 *
 * 下一个人若想把它挪回 `ui/`：先看 `viewStore.ts` 的 import —— 挪回去就又把方向拧反了。
 */

/**
 * 列的**标识**：可序列化，进 localStorage 的就是这一层。
 *
 * 与 `OutlineColumn`（渲染描述，留在 ui）分成两个类型的理由见 spec §4.1：
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
  | 'assignees'
  | 'effort'
  | 'taskCost'
  | 'resourceCost'
  | 'totalCost'
  // v1.0 解禁：以下 8 列有了真实数据来源（基线快照的差异、引擎的 costs 与进度）
  | 'baselineStart'
  | 'baselineFinish'
  | 'startVariance'
  | 'finishVariance'
  | 'bcws'
  | 'bcwp'
  | 'sv'
  | 'bac'
  // 显示但禁用（依赖「实际成本录入」，本版无数据源）—— 3 个
  | 'acwp'
  | 'cv'
  | 'eac'

/**
 * **列的全集，且顺序即注册顺序（= 渲染顺序）**。
 *
 * 这是「有哪些列、按什么顺序排」的**唯一权威**：ui 侧的 `OUTLINE_COLUMNS` 注册表由它
 * map 出来（在其上贴渲染描述），`viewStore` 的列归一化也按它的下标排序。
 * 两处若各存一份顺序，将来加/删列时必然漂移 —— 这正是本项目反复要避免的「两份真相」。
 *
 * 顺序沿用迁移前的注册表：可用列在前、禁用列在后（`OUTLINE_COLUMNS` 的历史顺序）。
 */
export const OUTLINE_COLUMN_KEYS: readonly OutlineColumnKey[] = [
  'kind',
  'title',
  'note',
  'id',
  'start',
  'finish',
  'duration',
  'priority',
  'progress',
  'totalSlack',
  'freeSlack',
  'assignees',
  'effort',
  'taskCost',
  'resourceCost',
  'totalCost',
  'baselineStart',
  'baselineFinish',
  'startVariance',
  'finishVariance',
  'bcws',
  'bcwp',
  'sv',
  'bac',
  'acwp',
  'cv',
  'eac',
]

/**
 * 依赖「实际成本录入」的列（本版无数据源，**尚未排期**）—— spec 缺陷 D2 / 计划偏差 2。
 *
 * 为什么写「尚未排期」而不是版本号：v1.0 是路线图的**最后一版**，这些条目再也
 * 指不出「某个版本」。写一个不存在的版本号（如 v1.1）是在许一个不会兑现的承诺 ——
 * 这条「指不出真实版本就写尚未排期」的规则由 v0.6 确立。
 *
 * 「可用性」是**数据可用性**（本版有没有真实数据来源），不是渲染描述，因此随标识词汇
 * 一起留在 store；ui 侧注册表只负责给出禁用时的**文案 key**（tooltip）。
 */
const DISABLED_OUTLINE_COLUMN_KEYS: ReadonlySet<string> = new Set(['acwp', 'cv', 'eac'])

/**
 * 大纲视图的**初始可见列**，按 spec §7 的列优先级取「信息量最高的五列」：
 *
 *   标题 > 开始/结束 > 工期 > 进度 > 浮时 > ID/备注
 *
 * 为什么把 `kind`（类型图标）以及 `note`/`id`/`priority` 从默认集里拿掉：
 * 它们是**噪音**而非信息 —— 一列 28px 的类型字形，在摘要底带 + 缩进已经把结构
 * 表达得很清楚的表里是重复的；`note`/`priority` 在真实项目里常年整列为空；
 * `id` 是内部标识，用户几乎不用它排期。默认集每多一列噪音，就多挤占一列
 * 「开始 / 结束 / 工期 / 进度」的横向空间 —— 这正是 spec §7 说的「丢了最重要的、
 * 留了噪音」。这些列**仍然可用**，只是不再**默认**显示（右键表头即可打开）。
 *
 * 必须已按注册表顺序排列，且含 `title`（否则首次打开就是一张空表）。
 */
export const DEFAULT_VISIBLE_COLUMNS: OutlineColumnKey[] = [
  'title',
  'start',
  'finish',
  'duration',
  'progress',
]

/** localStorage 里只能存 key，这里是 key 的运行时白名单（载入时的校验靠它） */
const COLUMN_KEYS: ReadonlySet<string> = new Set(OUTLINE_COLUMN_KEYS)

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
  return isOutlineColumnKey(value) && !DISABLED_OUTLINE_COLUMN_KEYS.has(value)
}

/**
 * 通用列宽下限。`title` 另有更高的下限，见下。
 */
export const COLUMN_WIDTH_MIN = 40

/** 通用列宽上限 —— 防止拖出一个占满屏幕的巨列 */
export const COLUMN_WIDTH_MAX = 1000

/**
 * `title` 列的宽度下限。
 *
 * 这个数字**不是新发明的** —— 它就是现有的 CSS
 * `.outlineHeaderCellSticky { min-width: 160px }`（见 `ProjectView.module.scss`）。
 *
 * 为什么两边必须是同一个数：CSS 的 `min-width` 是兜底，但若 JS 允许拖到 100
 * 而 CSS 把渲染宽度撑在 160，拖拽逻辑每帧算出的宽度与实际渲染宽度就对不上，
 * 手感表现为「拖不动」。JS 侧的 clamp 必须与 CSS 一致（或更紧）。
 */
export const TITLE_COLUMN_WIDTH_MIN = 160

/**
 * 列宽的**唯一** clamp 实现 —— `viewStore.setColumnWidth` 与载入时的归一化
 * 都读它。两处各写一遍上下限，将来改区间必然漂移。
 *
 * 取整是必需的：HiDPI 下 `clientX` 是小数，`startWidth + delta` 会算出小数宽，
 * 存进 localStorage 后每次载入都会变；取整让它稳定。
 */
export function clampColumnWidth(key: OutlineColumnKey, width: number): number {
  const min = key === 'title' ? TITLE_COLUMN_WIDTH_MIN : COLUMN_WIDTH_MIN
  // NaN 是真洞：Math.round(NaN) 是 NaN，且会原样穿过 Math.max / Math.min。它一旦
  // 流进渲染层就是 `flex: 0 0 NaNpx` —— 无效值，整列宽度塌回 auto，且要到刷新才
  // 自愈（落盘的 null 会被 normalizeColumnWidths 丢掉）。回落到下限即可。
  // 只为 NaN 设防而不写成 `!Number.isFinite`：后者会把 Infinity 从「钳到上限」变成
  // 「钳到下限」，那是行为变更；Infinity 经 Math.min 本来就能得到正确的上限。
  if (Number.isNaN(width)) return min
  return Math.min(COLUMN_WIDTH_MAX, Math.max(min, Math.round(width)))
}
