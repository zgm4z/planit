import type { Project } from '../model/types'
import type { SimulationConfig, SimulationResult, TaskUncertainty } from './simulationTypes'
import { runSimulation } from './engine'

export interface SimulationRequest {
  type: 'run'
  project: Project
  uncertainties: TaskUncertainty[]
  config: SimulationConfig
}

export interface SimulationProgressMessage {
  type: 'progress'
  progress: number
}

export interface SimulationResultMessage {
  type: 'result'
  result: SimulationResult
}

export interface SimulationErrorMessage {
  type: 'error'
  error: string
}

export type SimulationResponse = SimulationProgressMessage | SimulationResultMessage | SimulationErrorMessage

self.onmessage = (e: MessageEvent<SimulationRequest>) => {
  const { type, project, uncertainties, config } = e.data

  if (type !== 'run') {
    self.postMessage({
      type: 'error',
      error: 'Unknown message type',
    } satisfies SimulationErrorMessage)
    return
  }

  try {
    // 运行模拟
    const result = runSimulation(project, uncertainties, config)

    // 发送结果
    self.postMessage({
      type: 'result',
      result,
    } satisfies SimulationResultMessage)
  } catch (error) {
    self.postMessage({
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
    } satisfies SimulationErrorMessage)
  }
}
