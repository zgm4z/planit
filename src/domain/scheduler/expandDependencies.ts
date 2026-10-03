import type { Dependency, DependencyId, DependencyType, Task, TaskId } from '../model/types'

/**
 * 摘要（`kind='group'`）任务作为依赖端点时的**叶子级展开**。
 *
 * 背景：CPM 图只含叶子（摘要是叶子排期之后汇总出来的派生量，见 `summarize.ts`）。
 * 于是「一端是摘要」的依赖在构图时被当作悬空边**静默丢弃**（`buildGraph` 的
 * 悬空分支）—— 排在摘要之后的后继会错误地落在项目起点。
 *
 * 展开是否**精确**，取决于该类型的约束落在摘要的**哪个端点**上。摘要的端点由叶子
 * 汇总而来：`group.start = min(叶子 start)`、`group.finish = max(叶子 finish)`。
 *
 * | 类型 | 约束落在 | 前置是摘要 | 后继是摘要 |
 * |---|---|---|---|
 * | FS | 前置 finish / 后继 start | ✅ max 可取 | ✅ min 可取 |
 * | SS | 前置 **start** / 后继 start | ❌ min→max 不等价 | ✅ |
 * | FF | 前置 finish / 后继 **finish** | ✅ | ❌ max→all 不等价 |
 * | SF | 前置 **start** / 后继 **finish** | ❌ | ❌ |
 *
 * - **前置是摘要**精确 ⟺ 约束落在前置的 **finish**（`FS` / `FF`）：逐叶子的 max
 *   恰等于组的 finish 约束。
 * - **后继是摘要**精确 ⟺ 约束落在后继的 **start**（`FS` / `SS`）：要求 min ≥ X
 *   等价于「每个叶子都 ≥ X」。
 *
 * 不等价的组合（前置组 `SS`/`SF`、后继组 `FF`/`SF`）**不做近似展开** —— 那会静默
 * 产出偏晚的排期（正是本次要修的失败模式）。它们被如实列进 `unsupported`，且不入图。
 */
export interface UnsupportedSummaryDependency {
  dep: Dependency
  /** 哪一端是不受支持的摘要端点 */
  endpoint: 'predecessor' | 'successor'
}

export interface ExpandedDependencies {
  /** 叶子级依赖：摘要端点中可精确展开者已展开；其余（含不受支持的）不入此表 */
  dependencies: Dependency[]
  /** 无法在叶子级精确表达的摘要依赖（未展开、未入图） */
  unsupported: UnsupportedSummaryDependency[]
}

/** 「前置是摘要」能否逐叶子精确替换（约束须落在前置的 finish） */
export function isPredecessorExpandable(type: DependencyType): boolean {
  return type === 'FS' || type === 'FF'
}

/** 「后继是摘要」能否逐叶子精确替换（约束须落在后继的 start） */
export function isSuccessorExpandable(type: DependencyType): boolean {
  return type === 'FS' || type === 'SS'
}

/** 摘要 id → 其下全部叶子 id（深度优先，保持树序）。非摘要返回 `[id]`。 */
function leafIdsOf(tasks: Readonly<Record<TaskId, Task>>, id: TaskId): TaskId[] {
  const task = tasks[id]
  if (!task) return []
  if (task.childIds.length === 0) return [id]

  const leaves: TaskId[] = []
  const visit = (nodeId: TaskId): void => {
    const node = tasks[nodeId]
    if (!node) return
    if (node.childIds.length === 0) {
      leaves.push(nodeId)
      return
    }
    for (const childId of node.childIds) visit(childId)
  }
  visit(id)
  return leaves
}

function isGroup(tasks: Readonly<Record<TaskId, Task>>, id: TaskId): boolean {
  return (tasks[id]?.childIds.length ?? 0) > 0
}

/**
 * 把含摘要端点的依赖展开到叶子级。**无摘要端点的依赖原样透传**（id 不变 ——
 * 既有排期与归因的边序不受影响）。指向不存在任务的悬空边照旧丢弃（不入图）。
 */
export function expandDependencies(
  tasks: Readonly<Record<TaskId, Task>>,
  dependencies: readonly Dependency[],
): ExpandedDependencies {
  const out: Dependency[] = []
  const unsupported: UnsupportedSummaryDependency[] = []

  for (const dep of dependencies) {
    if (!tasks[dep.fromTaskId] || !tasks[dep.toTaskId]) continue // 悬空：照旧不参与构图

    const fromGroup = isGroup(tasks, dep.fromTaskId)
    const toGroup = isGroup(tasks, dep.toTaskId)

    if (fromGroup && !isPredecessorExpandable(dep.type)) {
      unsupported.push({ dep, endpoint: 'predecessor' })
      continue
    }
    if (toGroup && !isSuccessorExpandable(dep.type)) {
      unsupported.push({ dep, endpoint: 'successor' })
      continue
    }

    if (!fromGroup && !toGroup) {
      out.push(dep) // 叶子↔叶子：原样透传，id 不变
      continue
    }

    const froms = fromGroup ? leafIdsOf(tasks, dep.fromTaskId) : [dep.fromTaskId]
    const tos = toGroup ? leafIdsOf(tasks, dep.toTaskId) : [dep.toTaskId]
    for (const from of froms) {
      for (const to of tos) {
        out.push({ ...dep, id: `${dep.id}@${from}>${to}` as DependencyId, fromTaskId: from, toTaskId: to })
      }
    }
  }

  return { dependencies: out, unsupported }
}
