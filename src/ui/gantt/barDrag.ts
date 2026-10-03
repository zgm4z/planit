import type { Calendar, DateStr, Project, Task, TaskId } from '../../domain/model/types'
import { solve } from '../../domain/scheduler'
import {
  addWorkdays,
  manualInterval,
  snapToWorkday,
  taskFinish,
  workdaysBetween,
  workdaysInclusive,
} from '../../domain/calendar/workdays'
import type { Command } from '../../commands/types'

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
 * 拖拽起点：用户抓住的那根条 = `scheduledStart` + **视觉宽度**。
 *
 * 视觉宽度取排期跨度（`scheduledStart`→`scheduledFinish` 的工作日数）= 引擎的
 * **有效工期**，**不是** `task.duration`：fixedEffort 任务的 duration 会被引擎按
 * `ceil(effort / Σunits)` 覆盖（见 `effort.effectiveDuration`），二者可不同。
 * 条按有效工期渲染，拖拽起点必须与之一致，否则松手会把宽度掰回 stale 的旧值、
 * 把整条下游链带走。
 *
 * 里程碑恒 0 —— 它的零宽区间会被 `workdaysInclusive` 算成 1（渲染成 1 天）。
 */
export function dragOrigin(
  task: Task,
  schedule: { scheduledStart: DateStr; scheduledFinish: DateStr },
  cal: Calendar,
): DragOrigin {
  if (task.kind === 'milestone') {
    return { startDate: schedule.scheduledStart, duration: 0 }
  }
  return {
    startDate: schedule.scheduledStart,
    duration: workdaysInclusive(schedule.scheduledStart, schedule.scheduledFinish, cal),
  }
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
          // 带上**视觉宽度**（preview.duration = 排期跨度）：moveTo 据此写 manual 区间，
          // 而不是回退到 `task.duration` —— fixedEffort 下后者是 stale 的旧值，
          // 会让「用户看到 2 天、松手变 4 天」。
          payload: { taskId, startDate: preview.startDate, duration: preview.duration },
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
      // 拖右把手 = 改结束日、保开始日 → 落 manual（start 取 preview 里保留的原开始日）。
      // 与左把手共用 task.resize：manual 下 setDuration 是 no-op，若仍提交 setDuration，
      // 右把手在 manual 任务上会「点了没反应」。
      return [
        {
          type: 'task.resize',
          label: 'commands.task.resize',
          payload: { taskId, startDate: preview.startDate, duration: preview.duration },
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
 * v6 起三种拖拽模式**都落 manual**（钉死区间 = 手动排期），且提交时都带上
 * `preview.duration`（= 视觉宽度），因此假设项目与落盘统一写成
 * 「manualInterval(preview.startDate, preview.duration)」：
 * - `move` 提交 `task.moveTo {startDate, duration}` → manual 同上。
 * - `resizeStart` / `resizeEnd` 提交 `task.resize {startDate, duration}` → manual 同上。
 *
 * manual 语义天然使「影子」与「落盘」同形 —— 不再有 finishOn 那类「假设项目钉错边」
 * 的坑。`mode` 仅为签名对称保留。
 */
export function buildHypothetical(
  project: Project,
  taskId: TaskId,
  _mode: DragMode,
  preview: DragPreview,
): Project {
  const task = project.tasks[taskId]
  if (!task) return project

  const calendar = project.calendars[project.calendarId]
  const hypotheticalTask: Task = {
    ...task,
    duration: preview.duration,
    // 与 task.resize 落盘走**同一处**区间构造（manualInterval），影子与提交不再各写一份
    scheduling: manualInterval(preview.startDate, preview.duration, calendar),
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
 * v6 起拖拽一律落 manual，而 manual 区间就是 `preview` 描述的那段日期算术 ——
 * 于是影子和落盘天然同形（不再有旧 `finishOn` 那种「假设项目钉错边」的坑）。
 * 但下游条仍要靠 solve 重算，故整条链路照旧走 `buildShadowTasks`。
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
