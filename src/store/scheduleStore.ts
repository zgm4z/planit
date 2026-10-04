import { create } from 'zustand'
import type { ScheduleResult } from '../domain/model/types'
import { solveClient, SupersededError, type SolveMode } from '../domain/scheduler/solveClient'
import { useProjectStore } from './projectStore'

interface ScheduleState {
  /**
   * 最近一次**成功**的求解结果。
   * 求解在途时**保持上一次的好结果**（不清空、不闪）—— 界面在等待新结果期间
   * 仍显示旧排期，而不是塌成空态。这依赖求解在 worker 里异步完成（见 `computing`）。
   */
  result: ScheduleResult
  /** 求解失败（如依赖成环）时的说明。保留上一次 result 不清空 */
  error: string | null
  /** 是否有一次求解在途 —— UI 据此显示「计算中」 */
  computing: boolean
  /** 实际生效的求解路径（`'worker'` / 无 Worker 环境的 `'inline'`）。供 e2e 观测 */
  solveMode: SolveMode
}

const EMPTY: ScheduleResult = {
  schedules: {},
  conflicts: [],
  efforts: {},
  costs: {},
  resourceTotals: {},
  leveling: { delays: {}, unresolved: [] },
  earnedValues: {},
  baselineDiffs: {},
}

export const useScheduleStore = create<ScheduleState>(() => ({
  result: EMPTY,
  error: null,
  computing: false,
  solveMode: solveClient.mode,
}))

/**
 * 每次重算自增。异步结果回来时若不是**最新**的一次，直接作废 ——
 * 这是「旧结果永远不能覆盖新结果」在 store 一侧的兜底（客户端自己也有同样的保证）。
 */
let recomputeSeq = 0

async function recompute(): Promise<void> {
  const seq = (recomputeSeq += 1)
  const project = useProjectStore.getState().project
  if (!project) {
    useScheduleStore.setState({ result: EMPTY, error: null, computing: false })
    return
  }

  // 同步置位：dispatch 返回时 `computing` 已经是 true，UI 能立刻反映「在算」
  useScheduleStore.setState({ computing: true })

  try {
    const result = await solveClient.solve(project)
    if (seq !== recomputeSeq) return // 已被更新的一次求解取代
    useScheduleStore.setState({ result, error: null, computing: false })
  } catch (error) {
    if (error instanceof SupersededError) return // 被取代 —— 既非成功也非失败
    if (seq !== recomputeSeq) return
    const message = error instanceof Error ? error.message : String(error)
    // **保留上一次的好结果**（不塌成空态），错误走上层既有的错误通道：
    //   · scheduleStore.error → 工具栏内联提示（既有）
    //   · projectStore.lastError / clearError → App 顶部的 Alert（既有）
    useScheduleStore.setState({ error: message, computing: false })
    useProjectStore.setState({ lastError: message })
  }
}

// 唯一的重算触发源。不要在上层再加 useEffect 之类的二次触发 ——
// project 每次变更都是新引用，重复触发会让 solve() 白跑一遍。
//
// `loadProject` 同样是真实的 store 变更，因此「首次载入」也走这里 ——
// 无需（也不该有）单独的初始化入口。
useProjectStore.subscribe((state, prevState) => {
  if (state.project !== prevState.project) void recompute()
})
