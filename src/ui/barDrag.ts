import type { Calendar, DateStr, Project, Task, TaskId } from '../domain/model/types'
import { solve } from '../domain/scheduler'
import { addWorkdays, snapToWorkday, taskFinish, workdaysBetween } from '../domain/calendar/workdays'
import type { Command } from '../commands/types'

export type DragMode = 'move' | 'resizeStart' | 'resizeEnd'

export interface DragOrigin {
  startDate: DateStr
  duration: number
}

export interface DragPreview {
  startDate: DateStr
  duration: number
}

/**
 * 位移像素 → 天数，向零截断（避免亚像素抖动导致日期乱跳）。
 *
 * **必须用 `Math.trunc` 而不是 `Math.floor`**：`floor` 对负数是向更负的方向取整，
 * 会使「向左拖」比「向右拖」多跳一天 —— 例如 dayWidth=30 时，向右拖 15px
 * 换算成 0 天（不动），向左拖 15px 却被 `floor` 算成 -1 天（整体左移一天）。
 * 向零截断让左右两个方向严格对称。
 */
export function daysBetweenPixels(deltaPx: number, dayWidth: number): number {
  const days = Math.trunc(deltaPx / dayWidth)
  // `Math.trunc(-0.5)` 返回 `-0`：数值上无害，但它会让 `Object.is(-0, 0)`
  // 为 false，污染下游断言与任何做恒等比较的调用方。归一化成 +0。
  return days === 0 ? 0 : days
}

/**
 * 像素位移所依附的日期锚点。
 *
 * 指针位移必须叠加在**被抓住的那条边**上：
 * - `move` / `resizeStart` 抓的是左缘，锚点即开始日期
 * - `resizeEnd` 抓的是**右缘**，锚点必须是结束日期
 *
 * 若 `resizeEnd` 也锚在开始日期，落点会整体前移 `duration - 1` 个工作日 ——
 * 表现为「右把手拖 N 天，工期几乎不变」，甚至完全拖不动。
 */
export function dragAnchorDate(mode: DragMode, origin: DragOrigin, cal: Calendar): DateStr {
  return mode === 'resizeEnd'
    ? taskFinish(origin.startDate, origin.duration, cal)
    : origin.startDate
}

/**
 * 由拖拽模式、拖拽起点与落点日期算出预览排期。
 *
 * 落点一律先吸附到工作日、再以工作日为单位推演 ——
 * 这样「拖过周末」与「拖过节假日」都能得到符合直觉的结果。
 */
export function computeDragPreview(
  mode: DragMode,
  origin: DragOrigin,
  targetDate: DateStr,
  cal: Calendar,
): DragPreview {
  const snappedTarget = snapToWorkday(targetDate, cal)
  const snappedOriginStart = snapToWorkday(origin.startDate, cal)

  switch (mode) {
    case 'move': {
      const delta = workdaysBetween(snappedOriginStart, snappedTarget, cal)
      return {
        startDate: addWorkdays(snappedOriginStart, delta, cal),
        duration: origin.duration,
      }
    }

    case 'resizeStart': {
      const delta = workdaysBetween(snappedOriginStart, snappedTarget, cal)
      return {
        startDate: addWorkdays(snappedOriginStart, delta, cal),
        duration: Math.max(1, origin.duration - delta),
      }
    }

    case 'resizeEnd': {
      const originalFinish = taskFinish(snappedOriginStart, origin.duration, cal)
      const delta = workdaysBetween(originalFinish, snappedTarget, cal)
      return {
        startDate: origin.startDate,
        duration: Math.max(1, origin.duration + delta),
      }
    }
  }
}

/**
 * 该模式在松手时**真正会提交**的命令序列。
 *
 * ProjectView 直接消费它来 dispatch；`buildHypothetical` 的不变式测试也用它。
 * 两者共用同一来源，是为了保证「影子」与「提交」永远描述同一次变更 ——
 * 若提交路径改了而假设项目没跟上，影子就会显示一个从未发生过的结果。
 */
export function dragCommitCommands(
  mode: DragMode,
  taskId: TaskId,
  preview: DragPreview,
): Command[] {
  switch (mode) {
    case 'move':
      return [
        {
          type: 'task.moveTo',
          label: 'commands.task.moveTo',
          payload: { taskId, startDate: preview.startDate },
        },
      ]

    case 'resizeStart':
      // 一条命令同时设开始与工期，因此只产生一条撤销记录
      return [
        {
          type: 'task.resize',
          label: 'commands.task.resize',
          payload: { taskId, startDate: preview.startDate, duration: preview.duration },
        },
      ]

    case 'resizeEnd':
      // 只改工期，**不动 scheduling**
      return [
        {
          type: 'task.setDuration',
          label: 'commands.task.setDuration',
          payload: { taskId, duration: preview.duration },
        },
      ]
  }
}

/**
 * 预览用的「假设项目」：如果现在就松手，排期会是什么样。
 *
 * **核心不变式：被拖任务的那几个字段，必须与 `dragCommitCommands` 落盘的结果
 * 完全一致。** 否则影子会骗人 —— 用户看到的是另一个项目算出来的排期。
 *
 * 所以这里不能一律写成 `startOn`：
 * - `move` 提交 `task.moveTo`（= startOn）→ 假设项目也用 startOn
 * - `resizeStart` 提交 `task.resize`（= startOn + 工期）→ 假设项目也用 startOn
 * - `resizeEnd` 提交 `task.setDuration` —— **只改工期、保留原有 scheduling**。
 *   若这里也钉成 startOn，一个原本 `finishOn 03-04` 的任务会被假设成
 *   `startOn 03-02`：影子显示 `03-02 → 03-06`，实际落盘却是 `02-26 → 03-04`，
 *   连下游都会被带偏。
 */
export function buildHypothetical(
  project: Project,
  taskId: TaskId,
  mode: DragMode,
  preview: DragPreview,
): Project {
  const task = project.tasks[taskId]
  if (!task) return project

  const hypotheticalTask: Task =
    mode === 'resizeEnd'
      ? { ...task, duration: preview.duration }
      : {
          ...task,
          duration: preview.duration,
          scheduling: { mode: 'constraint', type: 'startOn', date: preview.startDate },
        }

  return { ...project, tasks: { ...project.tasks, [taskId]: hypotheticalTask } }
}

/** 渲染一根影子条所需的全部信息 */
export interface ShadowTask {
  startDate: DateStr
  duration: number
}

/**
 * **渲染用的**影子排期：把假设项目解一遍，得到每根条应当画在哪里。
 *
 * 关键点：**被拖的那根条也走这里**，不要拿 `preview` 直接渲染。
 * `preview` 只是「抓住的那条边移到了哪」的日期算术，它对 `auto` / `startOn`
 * 任务恰好等于最终结果，但对 `finishOn` 任务不是 —— 例如 `finishOn 03-04`
 * 工期 3 的任务，右把手右拖 2 天：`preview` 是 `{03-02, 5}`（渲染成 03-02→03-06），
 * 而真正落盘的是 `{02-26, 5}`（03-04 仍被钉住，开始日反推）。若用 `preview`
 * 渲染，影子就显示了一个从未发生过的结果。
 *
 * 走 solve 之后，「被拖条」「下游条」「提交结果」三者天然同源。
 */
export function buildShadowTasks(
  project: Project,
  taskId: TaskId,
  mode: DragMode,
  preview: DragPreview,
): Record<TaskId, ShadowTask> {
  const hypothetical = buildHypothetical(project, taskId, mode, preview)
  const { schedules } = solve(hypothetical)

  const shadows: Record<TaskId, ShadowTask> = {}
  for (const [id, schedule] of Object.entries(schedules)) {
    const task = hypothetical.tasks[id]
    if (!task) continue
    shadows[id] = { startDate: schedule.scheduledStart, duration: task.duration }
  }
  return shadows
}
