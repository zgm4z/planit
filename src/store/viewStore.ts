import { create } from 'zustand'
import type { TaskId } from '../domain/model/types'

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

  selectTask: (taskId) => set({ selectedTaskId: taskId }),

  toggleCollapsed: (taskId) => {
    const next = new Set(get().collapsedIds)
    if (next.has(taskId)) next.delete(taskId)
    else next.add(taskId)
    set({ collapsedIds: next })
  },

  setDayWidth: (dayWidth) => set({ dayWidth: Math.max(2, dayWidth) }),
}))
