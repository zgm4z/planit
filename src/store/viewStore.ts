import { create } from 'zustand'
import type { ResourceId, TaskId } from '../domain/model/types'
import {
  DEFAULT_VISIBLE_COLUMNS,
  OUTLINE_COLUMN_KEYS,
  clampColumnWidth,
  isEnabledOutlineColumnKey,
  isOutlineColumnKey,
  type OutlineColumnKey,
} from './columnKeys'
import { useProjectStore } from './projectStore'

export type ZoomLevel = 'day' | 'week' | 'month'

/**
 * 四个并列的视图。不是一种布局的两种宽度 —— 见 spec §1。
 * v0.3 是二值（甘特 / 任务列表），v0.7 扩到四值：新增**日历**与**资源**，
 * 它们各自是一等视图（不是甘特的某种模式），在切换器里与甘特平级。
 */
export type ActiveView = 'gantt' | 'outline' | 'calendar' | 'resources'

/**
 * Inspector 右栏的激活 Tab。**提升到 store 是有理由的**：菜单栏的「资源 > 新建资源」
 * 必须能把它切到 `resource` —— 否则菜单点了像是没反应（违反本项目的核心原则：
 * 「点了没反应比明确禁用更糟」）。放在组件 useState 里菜单栏够不着。
 */
export type InspectorTab = 'task' | 'project' | 'resource'

/**
 * 列配置的存储键。**不写进 Project**：列显示是「怎么看」，不是「是什么」，
 * 写进项目文件会污染数据、也会让「换个视图看看」变成一次可撤销的数据变更（spec §5）。
 */
export const OUTLINE_COLUMNS_STORAGE_KEY = 'planit.outlineColumns'

/**
 * 列宽的存储键。**与 `OUTLINE_COLUMNS_STORAGE_KEY` 分开，刻意不合并**：
 *
 *   1. 两件事互不牵连 —— 宽度 JSON 解析失败不该连带毁掉列可见性配置；
 *   2. 旧版本代码读到**非数组**的 `outlineColumns` 会走 `normalizeVisibleColumns`
 *      的 `Array.isArray` 分支静默退回默认，把用户的列配置清空。新 key 天然
 *      向后兼容 —— 旧版本不认识它、新版本不认识旧格式，各自安好。
 */
export const OUTLINE_COLUMN_WIDTHS_STORAGE_KEY = 'planit.outlineColumnWidths'

/** 落盘的去抖窗口（ms）。见 `persistColumnWidthsDebounced`。 */
export const COLUMN_WIDTHS_PERSIST_DEBOUNCE_MS = 200

/** 用户拖过的列宽覆盖。**只记改过的列** —— 没记的列用 COLUMN_META 的默认宽 */
export type ColumnWidths = Partial<Record<OutlineColumnKey, number>>

/** 落盘去抖的挂起句柄。模块级单例 —— 拖拽是全局唯一的交互，不存在并发写。 */
let persistTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 归一化：只保留**认识**的 key 且数值合法的项。
 *
 * **与 `normalizeVisibleColumns` 的口径刻意不对称**（那里用
 * `isEnabledOutlineColumnKey`，这里用 `isOutlineColumnKey`）：禁用列一旦出现在
 * `visibleColumns` 里，会卡住一个**关不掉的空列**（真实危害，必须过滤）；而禁用列
 * 根本不渲染，一条宽度只是死数据 —— 零危害，留着还能让该列将来解禁时，用户的
 * 宽度偏好原地复活。下一个人若想「统一」成同一个口径：先读这段。
 */
export function normalizeColumnWidths(input: unknown): ColumnWidths {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return {}

  const result: ColumnWidths = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!isOutlineColumnKey(key)) continue
    // 非有限数（NaN / Infinity / 字符串 / null）会让 `flex: 0 0 NaNpx` 成为
    // 无效值、整列宽度塌回 auto，一律丢弃
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    result[key] = clampColumnWidth(key, value)
  }
  return result
}

/** 从 localStorage 读列宽。任何异常（非法 JSON / 隐私模式）都退回空表，绝不抛 */
export function loadColumnWidths(): ColumnWidths {
  try {
    const raw = localStorage.getItem(OUTLINE_COLUMN_WIDTHS_STORAGE_KEY)
    if (raw === null) return {}
    return normalizeColumnWidths(JSON.parse(raw))
  } catch {
    return {}
  }
}

/**
 * 防抖落盘，**不是节流**：整个拖拽过程中一次都不写盘，松手后 200ms 落一次。
 *
 * 拖拽每帧都会调 `setColumnWidth`，若每次都 `setItem` 就是无意义的 IO ——
 * store 写入廉价（zustand 一次 `set`），磁盘写入不必跟手。200ms 的静默窗口
 * 也是「一次拖拽 = 一次写入」的保证。
 */
function persistColumnWidthsDebounced(widths: ColumnWidths): void {
  if (persistTimer !== null) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    try {
      localStorage.setItem(OUTLINE_COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(widths))
    } catch {
      // 忽略：持久化是锦上添花，不该让一次普通的列宽调整炸掉界面
    }
  }, COLUMN_WIDTHS_PERSIST_DEBOUNCE_MS)
}

/** 仅供测试使用：取消挂起的落盘，避免定时器跨用例串扰 */
export function __cancelColumnWidthsPersistForTests(): void {
  if (persistTimer !== null) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
}

interface ViewState {
  zoom: ZoomLevel
  selectedTaskId: TaskId | null
  collapsedIds: Set<TaskId>
  /** 甘特图一天的像素宽度 */
  dayWidth: number
  /** 当前视图。**不持久化** —— 每次打开默认甘特更符合直觉（spec §2） */
  activeView: ActiveView
  /** 可见列的**集合**（顺序由 OUTLINE_COLUMN_KEYS 的注册顺序决定，不在这里） */
  visibleColumns: OutlineColumnKey[]
  /** 用户拖过的列宽覆盖。与 visibleColumns 同族：「怎么看」，不进 Project、不进撤销栈 */
  columnWidths: ColumnWidths
  /**
   * Inspector 右栏当前激活的 Tab。默认 `task`（与搬移前的组件 useState 初值一致）。
   * **不持久化** —— 与 activeView 同族：每次打开默认「任务」更符合直觉。
   */
  activeInspectorTab: InspectorTab
  /**
   * 资源面板选中的资源。**不持久化**：资源是否存在于当前项目由 store 之外决定，
   * 载入存档时只校验「形状合法」而不认 id，落盘反而会留下指向不存在资源的悬空引用。
   * 容错（悬空 id 回落到第一个资源）由消费方 ResourceInspector 承担 —— 与搬移前一致。
   */
  selectedResourceId: ResourceId | null
  /**
   * 资源树里被折叠的**组**（有子资源的节点）。与 `collapsedIds`（任务树）同族：
   * 纯 UI 状态，「怎么看」而非「是什么」—— 不持久化、不写进 Project、不进撤销栈。
   */
  collapsedResourceIds: Set<ResourceId>

  setZoom: (zoom: ZoomLevel) => void
  selectTask: (taskId: TaskId | null) => void
  toggleCollapsed: (taskId: TaskId) => void
  /** 折叠全部（只折叠有子任务的行）。纯 UI 状态，不入撤销栈 —— 与 toggleCollapsed 同族 */
  collapseAll: () => void
  /** 展开全部（清空 collapsedIds） */
  expandAll: () => void
  setDayWidth: (dayWidth: number) => void
  setActiveView: (view: ActiveView) => void
  setVisibleColumns: (keys: readonly unknown[]) => void
  toggleColumn: (key: OutlineColumnKey) => void
  /** 设一列的宽度（clamp 后写入并防抖落盘）。拖拽中每帧都会调 */
  setColumnWidth: (key: OutlineColumnKey, width: number) => void
  /** 复位一列到默认宽 —— **删除覆盖**，而不是写入默认值。见实现处注释 */
  resetColumnWidth: (key: OutlineColumnKey) => void
  setActiveInspectorTab: (tab: InspectorTab) => void
  /** 选中一个资源（null = 清空，由消费方回落到第一个资源）。**刻意不 breakCoalescing** ——
   *  见实现处的说明：打断合并留在交互现场（Select 的 onChange），本动作是纯 setter。 */
  selectResource: (resourceId: ResourceId | null) => void
  toggleResourceCollapsed: (resourceId: ResourceId) => void
}

const ZOOM_DAY_WIDTH: Record<ZoomLevel, number> = {
  day: 32,
  week: 12,
  month: 4,
}

/** 注册顺序 → 序号。归一化时按它排序，让 visibleColumns 的顺序可预测 */
const COLUMN_ORDER = new Map(OUTLINE_COLUMN_KEYS.map((key, index) => [key, index]))

/**
 * 收敛成一份**只含本版可用 key 的、去重的、按注册顺序排列的**列表，且保证 `title` 在内。
 *
 * 载入存档与 setter 共用这一处，过滤两类东西：
 *   1. 旧版本留下、本版**不认识**的 key（spec §5 的「载入时的校验」）；
 *   2. 本版**认识但禁用**的 key（如 `assignees`）—— 它们在菜单里点不动，
 *      一旦真出现就卡住一个恒空又关不掉的列（见偏差 5）。
 * 两者都在这里被静默丢掉，而不是崩溃或渲染出空白列。
 * 入参刻意是 `unknown` —— 它同时服务「刚 parse 出来的 JSON」与「类型化的调用方」。
 */
export function normalizeVisibleColumns(input: unknown): OutlineColumnKey[] {
  const raw: unknown[] = Array.isArray(input) ? input : []
  const unique = [...new Set(raw.filter(isEnabledOutlineColumnKey))]

  // title 不允许取消：全关掉的话表格会空白，用户会以为坏了（spec §4.3）
  if (!unique.includes('title')) unique.push('title')

  return unique.sort((a, b) => (COLUMN_ORDER.get(a) ?? 0) - (COLUMN_ORDER.get(b) ?? 0))
}

/** 从 localStorage 读列配置。任何异常（非法 JSON / 隐私模式）都退回默认，绝不抛。 */
export function loadVisibleColumns(): OutlineColumnKey[] {
  try {
    const raw = localStorage.getItem(OUTLINE_COLUMNS_STORAGE_KEY)
    if (raw === null) return [...DEFAULT_VISIBLE_COLUMNS]
    return normalizeVisibleColumns(JSON.parse(raw))
  } catch {
    return [...DEFAULT_VISIBLE_COLUMNS]
  }
}

/** 写列配置。存不下（配额 / 隐私模式）不影响本次会话的显示 */
function persistVisibleColumns(keys: readonly OutlineColumnKey[]): void {
  try {
    localStorage.setItem(OUTLINE_COLUMNS_STORAGE_KEY, JSON.stringify(keys))
  } catch {
    // 忽略：持久化是锦上添花，不该让一次普通的列切换炸掉界面
  }
}

export const useViewStore = create<ViewState>((set, get) => ({
  zoom: 'day',
  selectedTaskId: null,
  collapsedIds: new Set<TaskId>(),
  dayWidth: ZOOM_DAY_WIDTH.day,
  activeView: 'gantt',
  visibleColumns: loadVisibleColumns(),
  columnWidths: loadColumnWidths(),
  activeInspectorTab: 'task',
  selectedResourceId: null,
  collapsedResourceIds: new Set<ResourceId>(),

  setZoom: (zoom) => set({ zoom, dayWidth: ZOOM_DAY_WIDTH[zoom] }),

  setActiveView: (activeView) => set({ activeView }), // 刻意不落盘

  setActiveInspectorTab: (activeInspectorTab) => set({ activeInspectorTab }), // 刻意不落盘

  // 纯 setter（与搬移前的 `setSelectedId` 等价）：换资源时的 breakCoalescing 留在
  // ResourceInspector 的 Select.onChange 现场 —— 那是「用户手动换资源」这一交互边界，
  // 而菜单栏「新建资源」这条路径**不**打断合并（与搬移前 handleCreate 的行为一致）。
  // 若把打断合并塞进这里，就会给菜单路径凭空加一次语义变更。
  selectResource: (selectedResourceId) => set({ selectedResourceId }),

  // 与 toggleCollapsed（任务树）同一手法：换一个 Set 引用，让订阅者看到变化
  toggleResourceCollapsed: (resourceId) => {
    const next = new Set(get().collapsedResourceIds)
    if (next.has(resourceId)) next.delete(resourceId)
    else next.add(resourceId)
    set({ collapsedResourceIds: next })
  },

  setVisibleColumns: (keys) => {
    const visibleColumns = normalizeVisibleColumns(keys)
    set({ visibleColumns })
    persistVisibleColumns(visibleColumns)
  },

  toggleColumn: (key) => {
    if (key === 'title') return // 守卫与 normalize 里的补齐是同一规则的两道闸
    const current = get().visibleColumns
    const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key]
    get().setVisibleColumns(next)
  },

  setColumnWidth: (key, width) => {
    const columnWidths = { ...get().columnWidths, [key]: clampColumnWidth(key, width) }
    set({ columnWidths })
    persistColumnWidthsDebounced(columnWidths)
  },

  // **删除 key，而不是写入默认宽**：title 的 `flex: true` 来自 COLUMN_META 的
  // 默认值（见 applyColumnWidths），覆盖值一删 flex 就回来了。若写成
  // `setColumnWidth(key, 默认宽)`，title 会变成固定 240px 的刚性列 ——
  // 与「从没拖过」的初始状态不再等价。
  resetColumnWidth: (key) => {
    const columnWidths = { ...get().columnWidths }
    delete columnWidths[key]
    set({ columnWidths })
    persistColumnWidthsDebounced(columnWidths)
  },

  selectTask: (taskId) => {
    // 换任务是「我转去做另一件事了」的交互边界：必须打断合并，
    // 否则「改 A 的工期 → 点 B → 点回 A → 再改 A 的工期」会塌缩成
    // 一次 Ctrl+Z —— 中间这次换任务不产生命令，撤销栈顶没被动过。
    // 依赖方向是 viewStore → projectStore（scheduleStore 同理），不构成循环。
    if (get().selectedTaskId !== taskId) {
      useProjectStore.getState().breakCoalescing()
    }
    set({ selectedTaskId: taskId })
  },

  toggleCollapsed: (taskId) => {
    const next = new Set(get().collapsedIds)
    if (next.has(taskId)) next.delete(taskId)
    else next.add(taskId)
    set({ collapsedIds: next })
  },

  // 折叠全部 / 展开全部（§10.2「视图」菜单）。
  //
  // 折叠的是**有子任务的行**：叶子任务折叠没有意义（它没有子任务，折了也只把箭头
  // 换个朝向，行数一行不少）。判定沿用 `flattenVisibleRows` 的同一数据源
  // （`project.tasks` 的 `childIds`）—— 不在这里另立一套「什么算分组」的规则。
  //
  // 与 toggleCollapsed 一样是**纯 UI 状态**：折叠是「怎么看」，不写进 Project，
  // 也不产生 patch，因此不进撤销栈、Ctrl+Z 撤不回来。这也是 §10 里「视图」菜单
  // 与「编辑」菜单的分界。
  collapseAll: () => {
    const project = useProjectStore.getState().project
    if (!project) return
    const next = new Set<TaskId>()
    for (const task of Object.values(project.tasks)) {
      if (task.childIds.length > 0) next.add(task.id)
    }
    set({ collapsedIds: next })
  },

  expandAll: () => set({ collapsedIds: new Set<TaskId>() }),

  setDayWidth: (dayWidth) => set({ dayWidth: Math.max(2, dayWidth) }),
}))

/** 仅供测试使用：把视图状态复位到初始值 */
export function __resetViewStoreForTests(): void {
  __cancelColumnWidthsPersistForTests()
  useViewStore.setState({
    zoom: 'day',
    selectedTaskId: null,
    collapsedIds: new Set(),
    dayWidth: ZOOM_DAY_WIDTH.day,
    activeView: 'gantt',
    visibleColumns: [...DEFAULT_VISIBLE_COLUMNS],
    columnWidths: {},
    activeInspectorTab: 'task',
    selectedResourceId: null,
    collapsedResourceIds: new Set(),
  })
}
