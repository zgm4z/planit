import { create } from 'zustand'
import type { TaskId } from '../domain/model/types'
import { useProjectStore } from './projectStore'

export type ZoomLevel = 'day' | 'week' | 'month'

interface ViewState {
  zoom: ZoomLevel
  selectedTaskId: TaskId | null
  collapsedIds: Set<TaskId>
  /** 甘特图一天的像素宽度 */
  dayWidth: number

  setZoom: (zoom: ZoomLevel) => void
  selectTask: (taskId: TaskId | null) => void
  toggleCollapsed: (taskId: TaskId) => void
  setDayWidth: (dayWidth: number) => void
}

const ZOOM_DAY_WIDTH: Record<ZoomLevel, number> = {
  day: 32,
  week: 12,
  month: 4,
}

export const useViewStore = create<ViewState>((set, get) => ({
  zoom: 'day',
  selectedTaskId: null,
  collapsedIds: new Set<TaskId>(),
  dayWidth: ZOOM_DAY_WIDTH.day,

  setZoom: (zoom) => set({ zoom, dayWidth: ZOOM_DAY_WIDTH[zoom] }),

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
  })
}
