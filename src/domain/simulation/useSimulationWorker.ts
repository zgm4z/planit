import { useRef, useCallback } from 'react'
import type { Project } from '../model/types'
import type { SimulationConfig, SimulationResult, TaskUncertainty } from './simulationTypes'
import type {
  SimulationRequest,
  SimulationResponse,
  SimulationProgressMessage,
  SimulationResultMessage,
  SimulationErrorMessage,
} from './simulation.worker'

export interface SimulationCallbacks {
  onProgress?: (progress: number) => void
  onResult: (result: SimulationResult) => void
  onError: (error: string) => void
}

export function useSimulationWorker() {
  const workerRef = useRef<Worker | null>(null)
  const callbacksRef = useRef<SimulationCallbacks | null>(null)

  const runSimulation = useCallback(
    (
      project: Project,
      uncertainties: TaskUncertainty[],
      config: SimulationConfig,
      callbacks: SimulationCallbacks
    ) => {
      // 清理旧的 worker
      if (workerRef.current) {
        workerRef.current.terminate()
      }

      // 保存回调
      callbacksRef.current = callbacks

      // 创建新的 worker
      const worker = new Worker(new URL('./simulation.worker.ts', import.meta.url), {
        type: 'module',
      })

      workerRef.current = worker

      // 设置消息处理
      worker.onmessage = (e: MessageEvent<SimulationResponse>) => {
        const message = e.data
        const callbacks = callbacksRef.current

        if (!callbacks) return

        switch (message.type) {
          case 'progress':
            callbacks.onProgress?.((message as SimulationProgressMessage).progress)
            break
          case 'result':
            callbacks.onResult((message as SimulationResultMessage).result)
            // 清理 worker
            worker.terminate()
            workerRef.current = null
            break
          case 'error':
            callbacks.onError((message as SimulationErrorMessage).error)
            // 清理 worker
            worker.terminate()
            workerRef.current = null
            break
        }
      }

      worker.onerror = (error) => {
        callbacks.onError(error.message || 'Worker error')
        worker.terminate()
        workerRef.current = null
      }

      // 发送请求
      const request: SimulationRequest = {
        type: 'run',
        project,
        uncertainties,
        config,
      }
      worker.postMessage(request)
    },
    []
  )

  const cancel = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate()
      workerRef.current = null
    }
  }, [])

  return { runSimulation, cancel }
}
