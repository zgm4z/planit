import type { Project, ScheduleResult } from '../model/types'
import type { LevelingBudget } from './leveling'
import { solve } from './index'
import { deserializeSolveError, type SolveRequest, type SolveResponse } from './solveProtocol'

/**
 * 主线程侧的求解入口：一个可复用的 worker、请求关联、supersede、错误透传，
 * 以及**无 `Worker` 环境下的同步兜底**。
 *
 * 设计要点：
 *  · **一条实现、两种调用方式** —— worker 与兜底都调 `solve()`（`index.ts`），
 *    这里不复制、不重写算法的任何一部分。
 *  · **请求关联 + supersede** —— 每个请求一个自增 id。新请求一到，在途的旧请求
 *    立刻作废（其结果即便回来也丢弃）；迟到的响应按 id 丢弃，**永远不会覆盖更新的**。
 *    丢掉的调用拿到 `SupersededError`（既非成功也非失败，调用方应忽略）。
 *  · **错误透传** —— `CycleError` 用同一个类重建（`instanceof` 成立），其余错误原样重建。
 *
 * 全部状态都在闭包内，`createSolveClient` 每调一次就是一份独立实例。
 */

/** 被更新的一次求解取代：结果作废。**不是失败**，调用方应静默忽略。 */
export class SupersededError extends Error {
  constructor() {
    super('求解已被更新的请求取代')
    this.name = 'SupersededError'
  }
}

/** worker 的最小契约。抽出来是为了在 jsdom（无 `Worker`）里注入假 worker 测客户端逻辑。 */
export interface SolveWorkerLike {
  postMessage(message: SolveRequest): void
  terminate(): void
  onmessage: ((event: MessageEvent<SolveResponse>) => void) | null
  onerror?: ((event: unknown) => void) | null
}

export type SolveMode = 'worker' | 'inline'

export interface SolveClient {
  /**
   * **当前**生效的路径。`'inline'` = 无 `Worker` 的同步兜底 ——
   * 既包括环境本来就没有 `Worker`，也包括 worker 中途失效后退回来的情况。
   */
  readonly mode: SolveMode
  solve(project: Project, budget?: LevelingBudget): Promise<ScheduleResult>
  /** 订阅模式变化（worker 中途失效 → `'inline'`）。返回退订函数。 */
  onModeChange(listener: (mode: SolveMode) => void): () => void
  dispose(): void
}

export interface SolveClientOptions {
  /**
   * 显式指定 worker：
   *   · 省略  → 自动探测（有 `Worker` 就起一个，否则兜底）
   *   · null → 强制走同步兜底
   *   · 对象 → 用注入的假 worker（测试用）
   */
  worker?: SolveWorkerLike | null
}

interface PendingEntry {
  resolve: (result: ScheduleResult) => void
  reject: (error: unknown) => void
}

function createWorker(): SolveWorkerLike | null {
  if (typeof Worker === 'undefined') return null
  try {
    // Vite 静态识别这个模式，把它拆成**独立的 worker chunk**（见 pnpm build 的产物）。
    // 若这里写成字符串路径或变量，打包器会漏掉，生产环境就静默退回主线程。
    // 断言成 SolveWorkerLike 会在**这一处**吸收 DOM 的 `onerror` 参数型别摩擦
    // （ErrorEvent vs unknown）——别把它漏到接口上，测试用的假 worker 才好写。
    return new Worker(new URL('./solve.worker.ts', import.meta.url), {
      type: 'module',
    }) as unknown as SolveWorkerLike
  } catch {
    return null
  }
}

export function createSolveClient(options: SolveClientOptions = {}): SolveClient {
  const worker = options.worker !== undefined ? options.worker : createWorker()

  // 记住当前可用的 worker；一旦它出错（脚本加载失败等）就置空，后续请求退回同步兜底。
  let activeWorker = worker

  let nextId = 1
  let latestId = 0
  const pending = new Map<number, PendingEntry>()
  const modeListeners = new Set<(mode: SolveMode) => void>()

  function notifyMode(mode: SolveMode): void {
    for (const listener of modeListeners) listener(mode)
  }

  /** 新请求一到，把其它在途请求全部作废（拒绝，不再投递结果）。 */
  function supersedeAllBut(keepId: number): void {
    for (const [id, entry] of pending) {
      if (id === keepId) continue
      pending.delete(id)
      entry.reject(new SupersededError())
    }
  }

  function handleResponse(response: SolveResponse): void {
    const entry = pending.get(response.id)
    if (!entry) return // 迟到的 / 未知的响应 —— 丢弃
    pending.delete(response.id)
    if (response.id !== latestId) {
      // 响应到达前已有更新的请求 —— 这份结果作废
      entry.reject(new SupersededError())
      return
    }
    if (response.ok) entry.resolve(response.result)
    else entry.reject(deserializeSolveError(response.error))
  }

  /**
   * 让当前 worker 退役：终止它、拒绝所有在途请求、退回同步兜底。
   *
   * 两个触发点 —— worker 自身出错（脚本 404 / 运行期崩溃）与 `dispose()`。
   * 三件事都必须做：
   *   · **拒绝在途请求**：否则 `postMessage` 石沉大海，`computing` 永远停不住；
   *   · **terminate 死掉的 worker**：否则它连着监听器一起泄漏；
   *   · **通知模式变化**：否则 store 的 `solveMode` 还停在启动时的快照上。
   */
  function retireWorker(reason: Error): void {
    if (activeWorker) {
      try {
        activeWorker.terminate()
      } catch {
        // worker 可能已自行崩溃 —— terminate 失败无所谓
      }
      activeWorker = null
      notifyMode('inline')
    }
    for (const entry of pending.values()) entry.reject(reason)
    pending.clear()
  }

  if (worker) {
    worker.onmessage = (event) => handleResponse(event.data)
    worker.onerror = () => retireWorker(new Error('求解 worker 不可用，已退回主线程'))
  }

  return {
    get mode() {
      return activeWorker ? 'worker' : 'inline'
    },

    onModeChange(listener) {
      modeListeners.add(listener)
      return () => {
        modeListeners.delete(listener)
      }
    },

    solve(project, budget) {
      const id = nextId++
      latestId = id
      supersedeAllBut(id)

      const target = activeWorker
      if (!target) {
        // 同步兜底：就地调用同一个 solve()。没有 worker 就没有可解耦的线程，
        // 这是唯一诚实的行为。用已决 promise 保持 API 形状一致。
        try {
          const result = solve(project, budget)
          if (id !== latestId) return Promise.reject(new SupersededError())
          return Promise.resolve(result)
        } catch (error) {
          return Promise.reject(error)
        }
      }

      return new Promise<ScheduleResult>((resolve, reject) => {
        pending.set(id, { resolve, reject })
        target.postMessage({ id, project, budget })
      })
    },

    dispose() {
      retireWorker(new Error('求解客户端已销毁，在途请求已取消'))
    },
  }
}

/**
 * 全应用共享的单例（store 用它）。
 *
 * e2e 读它的 `mode` 来区分「真的走了 worker」还是「退回了兜底」——
 * 单测在 jsdom 里永远是 `'inline'`，所以只有 e2e 能证明生产路径确实用了 worker。
 */
export const solveClient = createSolveClient()
