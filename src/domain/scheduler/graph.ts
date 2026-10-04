import type { Dependency, TaskId } from '../model/types'

/** 依赖成环时抛出。`cycle` 是构成环路的任务 id 序列，首尾相同。 */
export class CycleError extends Error {
  readonly cycle: TaskId[]

  constructor(cycle: TaskId[]) {
    super(`检测到循环依赖：${cycle.join(' → ')}`)
    this.name = 'CycleError'
    this.cycle = cycle
  }
}

/**
 * 依赖图。**内部一律用「任务在 `tasks` 数组里的下标」表示节点** —— 不再以 `TaskId`
 * 字符串为哈希键。为什么：CPU profile 显示 10k 叶子纯 CPM 的剩余成本是扁平的
 * 「一千次 `Map<string, …>` 查找」，任务 id 是字符串、被反复当哈希键用。
 * 下标化后每次邻接查询退化成一次数组索引。
 *
 * 邻接用 **CSR**（压缩稀疏行）：节点 `i` 的出边落在 `[outStart[i], outStart[i+1])`
 * 这个区间里，端点是 `outTo[e]`、边对象是 `outDep[e]`；入边同理。**同节点内的边次序
 * 与传入 `dependencies` 的次序一致**（与旧的 `Map<TaskId, Dependency[]>` 逐条 push 同序）
 * —— 归因排序、拓扑序都依赖这个次序，改动时务必保持。
 *
 * `order` 是拓扑序的**下标**序列。把下标换回 `TaskId` 只需 `tasks[order[k]].id`。
 */
export interface TaskGraph {
  /** 叶子任务的拓扑序（`tasks` 数组下标） */
  order: number[]
  /** CSR 出边区间起点，长度 n+1 */
  outStart: Int32Array
  /** CSR 出边终点（`tasks` 数组下标），长度 = 边数 */
  outTo: Int32Array
  /** 与 `outTo` 平行的边对象 */
  outDep: Dependency[]
  /** CSR 入边区间起点，长度 n+1 */
  inStart: Int32Array
  /** CSR 入边起点（`tasks` 数组下标），长度 = 边数 */
  inFrom: Int32Array
  /** 与 `inFrom` 平行的边对象 */
  inDep: Dependency[]
}

export function buildGraph(tasks: readonly { id: TaskId }[], dependencies: Dependency[]): TaskGraph {
  const n = tasks.length
  const indexOf = new Map<TaskId, number>()
  for (let i = 0; i < n; i += 1) indexOf.set(tasks[i].id, i)

  // 先筛掉悬空边（指向已被删除的任务），并统计出/入度 —— CSR 的两趟建表。
  const active: { dep: Dependency; from: number; to: number }[] = []
  const outCount = new Int32Array(n)
  const inCount = new Int32Array(n)
  for (const dep of dependencies) {
    const from = indexOf.get(dep.fromTaskId)
    const to = indexOf.get(dep.toTaskId)
    if (from === undefined || to === undefined) continue
    active.push({ dep, from, to })
    outCount[from] += 1
    inCount[to] += 1
  }

  const outStart = new Int32Array(n + 1)
  const inStart = new Int32Array(n + 1)
  for (let i = 0; i < n; i += 1) {
    outStart[i + 1] = outStart[i] + outCount[i]
    inStart[i + 1] = inStart[i] + inCount[i]
  }

  const edgeCount = outStart[n]
  const outTo = new Int32Array(edgeCount)
  const inFrom = new Int32Array(edgeCount)
  const outDep = new Array<Dependency>(edgeCount)
  const inDep = new Array<Dependency>(edgeCount)
  // 游标从区间起点起。按 `active` 的原始次序填充 → 同节点的边保持传入次序。
  const outCursor = outStart.slice(0, n)
  const inCursor = inStart.slice(0, n)
  for (const { dep, from, to } of active) {
    const oe = outCursor[from]!
    outCursor[from] = oe + 1
    outTo[oe] = to
    outDep[oe] = dep
    const ie = inCursor[to]!
    inCursor[to] = ie + 1
    inFrom[ie] = from
    inDep[ie] = dep
  }

  return {
    order: topoSort(tasks, n, outStart, outTo),
    outStart,
    outTo,
    outDep,
    inStart,
    inFrom,
    inDep,
  }
}

const WHITE = 0 // 未访问
const GRAY = 1 // 在当前 DFS 路径上
const BLACK = 2 // 已完成

/**
 * Kahn 算法（稳定版）：入度为 0 的节点按输入顺序入队，
 * 出队顺序即为「保持输入顺序」的拓扑序 —— 无依赖约束的节点不会被无谓地重排。
 */
function topoSort(
  tasks: readonly { id: TaskId }[],
  n: number,
  outStart: Int32Array,
  outTo: Int32Array,
): number[] {
  const indegree = new Int32Array(n)
  for (let e = 0; e < outTo.length; e += 1) indegree[outTo[e]] += 1

  const queue: number[] = []
  for (let i = 0; i < n; i += 1) {
    if (indegree[i] === 0) queue.push(i)
  }

  const order: number[] = []
  for (let head = 0; head < queue.length; head += 1) {
    const i = queue[head]
    order.push(i)

    for (let e = outStart[i]; e < outStart[i + 1]; e += 1) {
      const next = outTo[e]
      indegree[next] -= 1
      if (indegree[next] === 0) queue.push(next)
    }
  }

  // 有节点始终无法出队 → 图里存在环，用 DFS 取出一条完整环路供报错使用
  if (order.length !== n) throw new CycleError(findCycle(tasks, n, outStart, outTo))

  return order
}

/** 前向 DFS，返回一条完整环路（首尾相同）。仅在已确认存在环时调用。 */
function findCycle(
  tasks: readonly { id: TaskId }[],
  n: number,
  outStart: Int32Array,
  outTo: Int32Array,
): TaskId[] {
  const color = new Int8Array(n)

  const path: number[] = []
  let cycle: number[] | null = null

  const visit = (i: number): void => {
    if (cycle) return
    color[i] = GRAY
    path.push(i)

    for (let e = outStart[i]; e < outStart[i + 1]; e += 1) {
      const next = outTo[e]
      const state = color[next]

      if (state === GRAY) {
        // next 仍在当前路径上 → 找到环，从路径中截取
        cycle = [...path.slice(path.indexOf(next)), next]
        return
      }
      if (state === WHITE) visit(next)
      if (cycle) return
    }

    path.pop()
    color[i] = BLACK
  }

  // 按输入顺序遍历，保证同一份输入永远产出同一条环路
  for (let i = 0; i < n; i += 1) {
    if (color[i] === WHITE) visit(i)
    if (cycle) break
  }

  return (cycle ?? []).map((i) => tasks[i].id)
}
