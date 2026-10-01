import { create } from 'zustand'
import type { TaskId } from '../domain/model/types'
import {
  DEFAULT_VISIBLE_COLUMNS,
  OUTLINE_COLUMNS,
  isEnabledOutlineColumnKey,
  type OutlineColumnKey,
} from '../ui/outlineColumns'
import { useProjectStore } from './projectStore'

export type ZoomLevel = 'day' | 'week' | 'month'

/** 两个并列的视图。不是一种布局的两种宽度 —— 见 spec §1 */
export type ActiveView = 'gantt' | 'outline'

/**
 * 列配置的存储键。**不写进 Project**：列显示是「怎么看」，不是「是什么」，
 * 写进项目文件会污染数据、也会让「换个视图看看」变成一次可撤销的数据变更（spec §5）。
 */
export const OUTLINE_COLUMNS_STORAGE_KEY = 'planit.outlineColumns'

interface ViewState {
  zoom: ZoomLevel
  selectedTaskId: TaskId | null
  collapsedIds: Set<TaskId>
  /** 甘特图一天的像素宽度 */
  dayWidth: number
  /** 当前视图。**不持久化** —— 每次打开默认甘特更符合直觉（spec §2） */
  activeView: ActiveView
  /** 可见列的**集合**（顺序由 OUTLINE_COLUMNS 的注册顺序决定，不在这里） */
  visibleColumns: OutlineColumnKey[]

  setZoom: (zoom: ZoomLevel) => void
  selectTask: (taskId: TaskId | null) => void
  toggleCollapsed: (taskId: TaskId) => void
  setDayWidth: (dayWidth: number) => void
  setActiveView: (view: ActiveView) => void
  setVisibleColumns: (keys: readonly unknown[]) => void
  toggleColumn: (key: OutlineColumnKey) => void
}

const ZOOM_DAY_WIDTH: Record<ZoomLevel, number> = {
  day: 32,
  week: 12,
  month: 4,
}

/** 注册顺序 → 序号。归一化时按它排序，让 visibleColumns 的顺序可预测 */
const COLUMN_ORDER = new Map(OUTLINE_COLUMNS.map((column, index) => [column.key, index]))

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

  setZoom: (zoom) => set({ zoom, dayWidth: ZOOM_DAY_WIDTH[zoom] }),

  setActiveView: (activeView) => set({ activeView }), // 刻意不落盘

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

  setDayWidth: (dayWidth) => set({ dayWidth: Math.max(2, dayWidth) }),
}))

/** 仅供测试使用：把视图状态复位到初始值 */
export function __resetViewStoreForTests(): void {
  useViewStore.setState({
    zoom: 'day',
    selectedTaskId: null,
    collapsedIds: new Set(),
    dayWidth: ZOOM_DAY_WIDTH.day,
    activeView: 'gantt',
    visibleColumns: [...DEFAULT_VISIBLE_COLUMNS],
  })
}
