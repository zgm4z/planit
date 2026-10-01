import type { Project, ScheduleResult, Task, TaskId } from '../model/types'
import { runCpm } from './cpm'
import { detectConflicts, summarizeParents } from './summarize'

export { CycleError } from './graph'
export { runCpm } from './cpm'
export { summarizeParents, detectConflicts } from './summarize'

/**
 * 排期求解的唯一入口。纯函数，不依赖任何 React 或 store。
 *
 * 管线：收集叶子任务 → CPM 正推/逆推 → 摘要汇总 → 冲突检测
 *
 * 第一阶段不含资源与分配，因此没有独立的「有效工期计算」步骤 ——
 * 任务的 duration 直接作为 CPM 的输入。第二阶段接入资源后，
 * 工作量驱动的工期反解会插在第一步与第二步之间。
 */
export function solve(project: Project): ScheduleResult {
  const leaves = collectLeaves(project)
  const calendar = project.calendars[project.calendarId]

  const leafSchedules = runCpm({
    tasks: leaves,
    dependencies: Object.values(project.dependencies),
    calendar,
    direction: project.schedulingDirection,
    projectStart: project.startDate,
    projectEnd: project.endDate,
  })

  const schedules = summarizeParents(project.tasks, leafSchedules, project.rootIds)
  const conflicts = detectConflicts(project.tasks, schedules, project.rootIds)

  return { schedules, conflicts }
}

/** 深度优先收集全部叶子任务（childIds 为空者） */
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
