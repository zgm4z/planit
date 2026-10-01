import { create } from 'zustand'
import type { ScheduleResult } from '../domain/model/types'
import { solve } from '../domain/scheduler'
import { useProjectStore } from './projectStore'

interface ScheduleState {
  result: ScheduleResult
  /** 求解失败（如依赖成环）时的说明 */
  error: string | null
}

const EMPTY: ScheduleResult = { schedules: {}, conflicts: [] }

export const useScheduleStore = create<ScheduleState>(() => ({
  result: EMPTY,
  error: null,
}))

function recompute(): void {
  const project = useProjectStore.getState().project
  if (!project) {
    useScheduleStore.setState({ result: EMPTY, error: null })
    return
  }

  try {
    useScheduleStore.setState({ result: solve(project), error: null })
  } catch (error) {
    useScheduleStore.setState({
      result: EMPTY,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

// 只要 project 引用发生变化就重算一次（redo/undo 同样会触发）
useProjectStore.subscribe((state, prevState) => {
  if (state.project !== prevState.project) recompute()
})

/** 首次载入项目后手动触发一次，因为 subscribe 不会为初始值回调 */
export function initializeSchedules(): void {
  recompute()
}
