import type {
  Assignment,
  AssignmentId,
  Calendar,
  Dependency,
  Project,
  ResourceId,
  Task,
  TaskId,
} from '../model/types'
import { assignmentUnits } from '../model/units'
import type { WorkdayIndex } from '../calendar/workdays'
import { buildWorkdayIndex } from '../calendar/workdays'
import type { ResourceBounds } from './effort'
import { resourceBoundsFromAssignments } from './effort'
import { buildGraph, type TaskGraph } from './graph'
import { expandDependencies } from './expandDependencies'

export interface ScheduleContext {
  readonly project: Project
  readonly leaves: readonly Task[]
  readonly calendar: Calendar
  /**
   * 日历例外索引：把「工作日计数」从逐日 O(天数) 降到 O(log 例外数)，热循环
   * （CPM 浮时 / 平衡的剩余浮时）按此查表。**每次 `solve()` 现建**，求解期间日历
   * 不变（纯函数）—— 刻意不做跨调用的身份缓存，因为日历在测试里会被就地改动
   * （见 calendar/workdays.ts 的 `WorkdayIndex` 说明）。
   */
  readonly calendarIndex: WorkdayIndex
  /**
   * 叶子级依赖（摘要端点中可精确展开者已展开，见 `expandDependencies`）。
   * CPM 与构图消费的是这一份，不是 `project.dependencies`。
   */
  readonly dependencies: readonly Dependency[]
  /**
   * `taskId → 该叶子在 `leaves` 里的下标`。热路径（图 / CPM / 平衡）一律按下标访问
   * 数组，不再以 TaskId 字符串作哈希键（见 graph.ts 顶部说明）。只含**叶子** ——
   * 摘要任务不进 CPM / 平衡，查不到即「不是叶子」，与旧行为一致。
   */
  readonly leafIndex: ReadonlyMap<TaskId, number>
  readonly graph: TaskGraph
  readonly assignmentsByTask: ReadonlyMap<TaskId, readonly Assignment[]>
  readonly assignmentsByResource: ReadonlyMap<ResourceId, readonly Assignment[]>
  readonly assignmentUnitsById: ReadonlyMap<AssignmentId, number>
  readonly unitsByTask: ReadonlyMap<TaskId, number>
  readonly resourceBoundsByTask: ReadonlyMap<TaskId, ResourceBounds>
}

/** 构建一次调度过程可共享的叶子、依赖图与 assignment 派生索引。 */
export function buildScheduleContext(project: Project): ScheduleContext {
  const leaves = collectLeaves(project)
  const leafIndex = new Map<TaskId, number>()
  for (let i = 0; i < leaves.length; i += 1) leafIndex.set(leaves[i].id, i)
  const calendar = project.calendars[project.calendarId]
  // 日历例外索引一次建好，贯穿本次求解的全部工作日计数（CPM / 平衡 / 基线差异）。
  const calendarIndex = buildWorkdayIndex(calendar)
  const assignmentsByTask = new Map<TaskId, Assignment[]>()
  const assignmentsByResource = new Map<ResourceId, Assignment[]>()
  const assignmentUnitsById = new Map<AssignmentId, number>()
  const unitsByTask = new Map<TaskId, number>(leaves.map((task) => [task.id, 0]))

  for (const assignment of Object.values(project.assignments)) {
    const taskAssignments = assignmentsByTask.get(assignment.taskId) ?? []
    taskAssignments.push(assignment)
    assignmentsByTask.set(assignment.taskId, taskAssignments)

    const resource = project.resources[assignment.resourceId]
    if (!resource) continue

    const resourceAssignments = assignmentsByResource.get(resource.id) ?? []
    resourceAssignments.push(assignment)
    assignmentsByResource.set(resource.id, resourceAssignments)

    const units = assignmentUnits(resource, assignment)
    assignmentUnitsById.set(assignment.id, units)
    unitsByTask.set(assignment.taskId, (unitsByTask.get(assignment.taskId) ?? 0) + units)
  }

  const resourceBoundsByTask = new Map<TaskId, ResourceBounds>()
  for (const task of leaves) {
    const bounds = resourceBoundsFromAssignments(
      assignmentsByTask.get(task.id) ?? [],
      project.resources,
      calendar,
    )
    if (bounds.earliestStart !== undefined || bounds.latestFinish !== undefined) {
      resourceBoundsByTask.set(task.id, bounds)
    }
  }

  // 摘要端点在进图前展开到叶子级（否则会被当作悬空边静默丢弃）。
  // `expanded.unsupported`（无法在叶子级精确表达的摘要依赖）**刻意不带上** ——
  // ScheduleContext 里曾有一份 `unsupportedDependencies` 拷贝，但全仓无消费者，
  // 属死管道。审计路径仍在 `expandDependencies` 的返回值 + 其单测 / guard 测试里，
  // 需要时再从这里接线（别重新往 context 里塞一份没人读的拷贝）。
  const expanded = expandDependencies(project.tasks, Object.values(project.dependencies))

  return {
    project,
    leaves,
    calendar,
    calendarIndex,
    dependencies: expanded.dependencies,
    leafIndex,
    graph: buildGraph(leaves, expanded.dependencies),
    assignmentsByTask,
    assignmentsByResource,
    assignmentUnitsById,
    unitsByTask,
    resourceBoundsByTask,
  }
}

/** 深度优先收集叶子任务，顺序与项目树一致。 */
function collectLeaves(project: Project): Task[] {
  const leaves: Task[] = []

  const visit = (id: TaskId): void => {
    const task = project.tasks[id]
    if (!task) return
    if (task.childIds.length === 0) {
      leaves.push(task)
      return
    }
    for (const childId of task.childIds) visit(childId)
  }

  for (const rootId of project.rootIds) visit(rootId)
  return leaves
}
