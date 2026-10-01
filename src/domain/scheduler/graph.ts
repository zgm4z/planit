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

export interface TaskGraph {
  /** 叶子任务的拓扑序 */
  order: TaskId[]
  outgoing: Map<TaskId, Dependency[]>
  incoming: Map<TaskId, Dependency[]>
}

export function buildGraph(tasks: readonly { id: TaskId }[], dependencies: Dependency[]): TaskGraph {
  const known = new Set(tasks.map((task) => task.id))

  const outgoing = new Map<TaskId, Dependency[]>()
  const incoming = new Map<TaskId, Dependency[]>()
  for (const task of tasks) {
    outgoing.set(task.id, [])
    incoming.set(task.id, [])
  }

  for (const dep of dependencies) {
    // 悬空依赖（指向已被删除的任务）直接忽略，不参与构图
    if (!known.has(dep.fromTaskId) || !known.has(dep.toTaskId)) continue
    outgoing.get(dep.fromTaskId)!.push(dep)
    incoming.get(dep.toTaskId)!.push(dep)
  }

  return { order: topoSort(tasks, outgoing), outgoing, incoming }
}

const WHITE = 0 // 未访问
const GRAY = 1  // 在当前 DFS 路径上
const BLACK = 2 // 已完成

/**
 * Kahn 算法（稳定版）：入度为 0 的节点按输入顺序入队，
 * 出队顺序即为「保持输入顺序」的拓扑序 —— 无依赖约束的节点不会被无谓地重排。
 */
function topoSort(tasks: readonly { id: TaskId }[], outgoing: Map<TaskId, Dependency[]>): TaskId[] {
  const indegree = new Map<TaskId, number>()
  for (const task of tasks) indegree.set(task.id, 0)
  for (const task of tasks) {
    for (const dep of outgoing.get(task.id) ?? []) {
      indegree.set(dep.toTaskId, (indegree.get(dep.toTaskId) ?? 0) + 1)
    }
  }

  const queue: TaskId[] = []
  for (const task of tasks) {
    if (indegree.get(task.id) === 0) queue.push(task.id)
  }

  const order: TaskId[] = []
  for (let head = 0; head < queue.length; head += 1) {
    const id = queue[head]
    order.push(id)

    for (const dep of outgoing.get(id) ?? []) {
      const next = dep.toTaskId
      const remaining = (indegree.get(next) ?? 0) - 1
      indegree.set(next, remaining)
      if (remaining === 0) queue.push(next)
    }
  }

  // 有节点始终无法出队 → 图里存在环，用 DFS 取出一条完整环路供报错使用
  if (order.length !== tasks.length) throw new CycleError(findCycle(tasks, outgoing))

  return order
}

/** 前向 DFS，返回一条完整环路（首尾相同）。仅在已确认存在环时调用。 */
function findCycle(tasks: readonly { id: TaskId }[], outgoing: Map<TaskId, Dependency[]>): TaskId[] {
  const color = new Map<TaskId, number>()
  for (const task of tasks) color.set(task.id, WHITE)

  const path: TaskId[] = []
  let cycle: TaskId[] | null = null

  const visit = (id: TaskId): void => {
    if (cycle) return
    color.set(id, GRAY)
    path.push(id)

    for (const dep of outgoing.get(id) ?? []) {
      const next = dep.toTaskId
      const state = color.get(next)

      if (state === GRAY) {
        // next 仍在当前路径上 → 找到环，从路径中截取
        cycle = [...path.slice(path.indexOf(next)), next]
        return
      }
      if (state === WHITE) visit(next)
      if (cycle) return
    }

    path.pop()
    color.set(id, BLACK)
  }

  // 按输入顺序遍历，保证同一份输入永远产出同一条环路
  for (const task of tasks) {
    if (color.get(task.id) === WHITE) visit(task.id)
    if (cycle) break
  }

  return cycle ?? []
}
