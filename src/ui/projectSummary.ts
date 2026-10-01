import type { ComputedSchedule, DateStr, Project, TaskId } from '../domain/model/types'
import { workdaysBetween } from '../domain/calendar/workdays'

export interface ProjectSummary {
  start: DateStr
  finish: DateStr
  /** 含首尾两天，与甘特条宽度口径一致 */
  totalWorkdays: number
  /** 全部任务数（含摘要任务） */
  taskCount: number
}

/**
 * 项目摘要（spec §4「复用 StatusBar 的算法」）。**唯一的一份** ——
 * StatusBar 与项目面板都调它，避免「跨度」出现第二套实现。
 *
 * 只用**叶子任务**统计跨度：摘要任务的排期是从子任务汇总来的，
 * 重复计入不会改变 min/max，但会掩盖「没有叶子就没有真实排期」这一事实。
 * 没有任何叶子排期时返回 null（调用方决定空态文案）。
 */
export function computeProjectSummary(
  project: Project,
  schedules: Record<TaskId, ComputedSchedule>,
): ProjectSummary | null {
  const leaves = Object.values(project.tasks)
    .filter((task) => task.childIds.length === 0)
    .map((task) => schedules[task.id])
    .filter((schedule): schedule is ComputedSchedule => Boolean(schedule))

  if (leaves.length === 0) return null

  const start = leaves.reduce(
    (acc, schedule) => (schedule.scheduledStart < acc ? schedule.scheduledStart : acc),
    leaves[0].scheduledStart,
  )
  const finish = leaves.reduce(
    (acc, schedule) => (schedule.scheduledFinish > acc ? schedule.scheduledFinish : acc),
    leaves[0].scheduledFinish,
  )
  const calendar = project.calendars[project.calendarId]

  return {
    start,
    finish,
    totalWorkdays: workdaysBetween(start, finish, calendar) + 1,
    taskCount: Object.keys(project.tasks).length,
  }
}
