import type { Project, ScheduleResult } from '../model/types'
import type { LevelingBudget } from './leveling'
import { CycleError } from './graph'

/**
 * 主线程 ↔ 排期 worker 之间的消息契约。
 *
 * **算法不在这里** —— 这一层只负责把 `solve()` 的入参搬过去、把它的产出（或抛出的
 * 错误）搬回来。序列化逻辑同时被 worker（发送端）与客户端（接收端）引用，所以它是
 * 「唯一的错误编解码实现」，不是 worker 私有的一份。
 *
 * 为什么错误要手工编解码而不是直接 postMessage(Error)：
 * structured clone 会丢掉子类身份（`CycleError` 到了对面只是一个普通 `Error`），
 * 而应用用 `instanceof CycleError` 区分它。故这里只搬 name / message / cycle，
 * 在接收端用**同一个 `CycleError` 类**重建 —— 身份得以保留。
 */
export interface SolveRequest {
  id: number
  project: Project
  budget?: LevelingBudget
}

export interface SerializedSolveError {
  name: string
  message: string
  /** `CycleError` 的环路（其它错误缺省） */
  cycle?: string[]
}

export type SolveResponse =
  | { id: number; ok: true; result: ScheduleResult }
  | { id: number; ok: false; error: SerializedSolveError }

/** 把 `solve()` 抛出的任意值压成可跨消息边界的普通对象。 */
export function serializeSolveError(error: unknown): SerializedSolveError {
  if (!(error instanceof Error)) return { name: 'Error', message: String(error) }
  const serialized: SerializedSolveError = { name: error.name, message: error.message }
  const cycle = (error as { cycle?: unknown }).cycle
  if (Array.isArray(cycle)) serialized.cycle = cycle.map((id) => String(id))
  return serialized
}

/** 在接收端重建错误。`CycleError` 用**同一个类**重建，`instanceof` 判据得以成立。 */
export function deserializeSolveError(error: SerializedSolveError): Error {
  if (error.name === 'CycleError' && error.cycle) return new CycleError(error.cycle)
  const rebuilt = new Error(error.message)
  rebuilt.name = error.name
  return rebuilt
}
