import { solve } from './index'
import { serializeSolveError, type SolveRequest, type SolveResponse } from './solveProtocol'

/**
 * 排期 worker。
 *
 * **唯一职责**：收一条消息 → 调同一个 `solve()` → 回一条消息。
 * 这里没有算法 —— `solve()` 是主线程与 worker 共用的那一份（`index.ts`），
 * worker 只是它的第二个调用入口（第一个是同步兜底，见 `solveClient.ts`）。
 *
 * 之所以保持这么薄：jsdom 里没有 `Worker`，单测跑的是同步兜底那条路 ——
 * 如果 worker 侧另有一份有意义的逻辑，它就会只被 e2e 覆盖甚至无人覆盖。
 * 薄的边界意味着「兜底通过=worker 也通过」。
 */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SolveRequest>) => void) | null
  postMessage: (message: SolveResponse) => void
}

scope.onmessage = (event: MessageEvent<SolveRequest>): void => {
  const { id, project, budget } = event.data
  let response: SolveResponse
  try {
    response = { id, ok: true, result: solve(project, budget) }
  } catch (error) {
    response = { id, ok: false, error: serializeSolveError(error) }
  }
  scope.postMessage(response)
}
