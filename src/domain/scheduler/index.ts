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
 * 资源与分配在第一阶段恒为空，因此「有效工期计算」这一步退化为恒等变换。
 */
export function solve(project: Project): ScheduleResult {
  const leaves = collectLeaves(project)
  const calendar = project.calendars[project.calendarId]

  const leafSchedules = runCpm({
    tasks: leaves,
    dependencies: Object.values(project.dependencies),
    calendar,
    projectStart: project.startDate,
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
