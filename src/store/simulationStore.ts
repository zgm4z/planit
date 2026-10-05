import { create } from 'zustand'
import type {
  SimulationConfig,
  SimulationResult,
  TaskUncertainty,
} from '../domain/simulation/simulationTypes'

interface SimulationState {
  /** 当前模拟配置 */
  config: SimulationConfig | null
  /** 任务不确定性参数 */
  uncertainties: TaskUncertainty[]
  /** 模拟结果 */
  result: SimulationResult | null
  /** 模拟是否正在运行 */
  isRunning: boolean
  /** 模拟进度（0-100） */
  progress: number
  /** 最近一次模拟失败的说明 */
  lastError: string | null

  /** 设置模拟配置 */
  setConfig: (config: SimulationConfig) => void
  /** 设置任务不确定性参数 */
  setUncertainties: (uncertainties: TaskUncertainty[]) => void
  /** 更新单个任务的不确定性参数 */
  updateUncertainty: (uncertainty: TaskUncertainty) => void
  /** 移除单个任务的不确定性参数 */
  removeUncertainty: (taskId: string) => void
  /** 设置模拟结果 */
  setResult: (result: SimulationResult) => void
  /** 设置运行状态 */
  setRunning: (isRunning: boolean) => void
  /** 设置进度 */
  setProgress: (progress: number) => void
  /** 设置错误信息 */
  setError: (error: string | null) => void
  /** 清空所有模拟数据 */
  clear: () => void
}

export const useSimulationStore = create<SimulationState>((set) => ({
  config: null,
  uncertainties: [],
  result: null,
  isRunning: false,
  progress: 0,
  lastError: null,

  setConfig: (config) => set({ config }),

  setUncertainties: (uncertainties) => set({ uncertainties }),

  updateUncertainty: (uncertainty) =>
    set((state) => {
      const index = state.uncertainties.findIndex((u) => u.taskId === uncertainty.taskId)
      if (index >= 0) {
        // 更新现有
        const newUncertainties = [...state.uncertainties]
        newUncertainties[index] = uncertainty
        return { uncertainties: newUncertainties }
      } else {
        // 添加新的
        return { uncertainties: [...state.uncertainties, uncertainty] }
      }
    }),

  removeUncertainty: (taskId) =>
    set((state) => ({
      uncertainties: state.uncertainties.filter((u) => u.taskId !== taskId),
    })),

  setResult: (result) => set({ result }),

  setRunning: (isRunning) => set({ isRunning }),

  setProgress: (progress) => set({ progress }),

  setError: (error) => set({ lastError: error }),

  clear: () =>
    set({
      config: null,
      uncertainties: [],
      result: null,
      isRunning: false,
      progress: 0,
      lastError: null,
    }),
}))
