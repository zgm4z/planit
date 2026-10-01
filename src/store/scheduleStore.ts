import { create } from 'zustand'
import type { ScheduleResult } from '../domain/model/types'
import { solve } from '../domain/scheduler'
import { useProjectStore } from './projectStore'

interface ScheduleState {
  result: ScheduleResult
  /** 求解失败（如依赖成环）时的说明 */
  error: string | null
}

const EMPTY: ScheduleResult = {
  schedules: {},
  conflicts: [],
  efforts: {},
  costs: {},
  resourceTotals: {},
  leveling: { delays: {}, unresolved: [] },
}

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

// 唯一的重算触发源。不要在上层再加 useEffect 之类的二次触发 ——
// project 每次变更都是新引用，重复触发会让 solve() 白跑一遍。
//
// `loadProject` 同样是真实的 store 变更，因此「首次载入」也走这里 ——
// 无需（也不该有）单独的初始化入口。
useProjectStore.subscribe((state, prevState) => {
  if (state.project !== prevState.project) recompute()
})
