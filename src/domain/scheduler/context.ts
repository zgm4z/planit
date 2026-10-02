import type {
  Assignment,
  AssignmentId,
  Calendar,
  Project,
  ResourceId,
  Task,
  TaskId,
} from '../model/types'
import { assignmentUnits } from '../model/units'
import type { ResourceBounds } from './effort'
import { resourceBoundsFromAssignments } from './effort'
import { buildGraph, type TaskGraph } from './graph'

export interface ScheduleContext {
  readonly project: Project
  readonly leaves: readonly Task[]
  readonly calendar: Calendar
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
  const calendar = project.calendars[project.calendarId]
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

  return {
    project,
    leaves,
    calendar,
    graph: buildGraph(leaves, Object.values(project.dependencies)),
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
