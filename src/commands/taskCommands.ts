import type { Draft } from 'immer'
import type {
  DateStr,
  EffortMode,
  Project,
  Scheduling,
  SchedulingOrder,
  TaskId,
} from '../domain/model/types'
import { createTask } from '../domain/model/factories'
import { manualInterval, taskFinish, workdaysInclusive } from '../domain/calendar/workdays'
import { toDateStr } from '../domain/calendar/dateTime'
import { sumUnits } from '../domain/model/units'
import { reconcileKind } from './reconcileKind'
import type { CommandHandler } from './types'

export interface TaskCreatePayload { name: string; parentId?: TaskId | null }
export interface TaskRenamePayload { taskId: TaskId; name: string }
export interface TaskDeletePayload { taskId: TaskId }
export interface TaskSetDurationPayload { taskId: TaskId; duration: number }
export interface TaskSetProgressPayload { taskId: TaskId; progress: number }
export interface TaskToggleMilestonePayload { taskId: TaskId }
export interface TaskSetSchedulingPayload { taskId: TaskId; scheduling: Scheduling }
export interface TaskMoveToPayload {
  taskId: TaskId
  startDate: DateStr
  /** 缺省时按 `taskFinish(startDate, task.duration)` 用项目日历折算出结束日 */
  finishDate?: DateStr
}
export interface TaskResizePayload { taskId: TaskId; startDate: DateStr; duration: number }
export interface TaskSetSchedulingOrderPayload { taskId: TaskId; order: SchedulingOrder }
export interface TaskSetNotePayload { taskId: TaskId; note: string }
export interface TaskSetPriorityPayload { taskId: TaskId; priority: number }
export interface TaskSetDelayPayload { taskId: TaskId; delay: number }
export interface TaskSetAllowSplittingPayload { taskId: TaskId; allowSplitting: boolean }
export interface TaskSetEffortModePayload { taskId: TaskId; effortMode: EffortMode }
export interface TaskSetEffortPayload { taskId: TaskId; effort: number | undefined }

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/** 把任务从父节点的 childIds（或 rootIds）中摘除。调用方负责清理依赖 */
function detachTask(draft: Draft<Project>, taskId: TaskId): void {
  const task = draft.tasks[taskId]
  if (!task) return

  if (task.parentId) {
    const siblings: TaskId[] = draft.tasks[task.parentId].childIds
    const index = siblings.indexOf(taskId)
    if (index >= 0) siblings.splice(index, 1)
  } else {
    const index = draft.rootIds.indexOf(taskId)
    if (index >= 0) draft.rootIds.splice(index, 1)
  }
}

export const taskHandlers: Record<string, CommandHandler<any>> = {
  'task.create': (draft, payload: TaskCreatePayload) => {
    const task = createTask({ name: payload.name })
    // 里程碑不能当父任务 —— 与 task.indent 的守卫是同一条规则。
    // 两条路径必须一致：indent 拒绝的事，create 也不该换个方式做成。
    // 不可用的 parentId（悬空 id / 里程碑）一律回退到根层，不留下悬空的 parentId。
    // createTask 已把 parentId 默认为 null，因此回退分支无需再赋值。
    const candidate = payload.parentId ? draft.tasks[payload.parentId] : undefined
    const parent = candidate && candidate.kind !== 'milestone' ? candidate : undefined

    draft.tasks[task.id] = task
    if (parent) {
      task.parentId = parent.id
      parent.childIds.push(task.id)
      reconcileKind(draft, parent.id)
    } else {
      draft.rootIds.push(task.id)
    }
  },

  'task.rename': (draft, payload: TaskRenamePayload) => {
    const task = draft.tasks[payload.taskId]
    if (task) task.name = payload.name
  },

  'task.delete': (draft, payload: TaskDeletePayload) => {
    // 后序删除整棵子树
    const collect = (id: TaskId): TaskId[] => {
      const task = draft.tasks[id]
      if (!task) return []
      return [id, ...task.childIds.flatMap(collect)]
    }

    const subtree = collect(payload.taskId)
    if (subtree.length === 0) return // 任务不存在，no-op

    // 先摘掉根节点（更新父节点的 childIds / rootIds），再逐个删
    const parentId = draft.tasks[payload.taskId]?.parentId ?? null
    detachTask(draft, payload.taskId)
    if (parentId) reconcileKind(draft, parentId)

    // 清理整棵子树的依赖 —— 只清理根节点会留下指向已删除任务的孤儿依赖，
    // 这些孤儿会被持久化、污染统计，且因不在 patch 里而无法被撤销恢复
    const removed = new Set(subtree)
    for (const [depId, dep] of Object.entries(draft.dependencies)) {
      if (removed.has(dep.fromTaskId) || removed.has(dep.toTaskId)) {
        delete draft.dependencies[depId]
      }
    }

    // 同样清理整棵子树的 assignment —— 与依赖同理：只删任务会留下指向
    // 不存在任务的孤儿分配，污染资源总计且无法被撤销恢复。
    for (const [assignmentId, assignment] of Object.entries(draft.assignments)) {
      if (removed.has(assignment.taskId)) delete draft.assignments[assignmentId]
    }

    for (const id of [...subtree].reverse()) {
      delete draft.tasks[id]
    }
  },

  'task.setDuration': (draft, payload: TaskSetDurationPayload) => {
    const task = draft.tasks[payload.taskId]
    if (!task) return
    if (task.kind === 'group') return // 摘要任务由汇总决定
    if (task.kind === 'milestone') return // 里程碑恒为 0
    // manual 任务：引擎不消费其 duration（区间宽度即真相），拒绝改工期。
    // UI 上 manual 分支的工期输入应禁用并注明（Task 5）。
    if (task.scheduling.mode === 'manual') return
    task.duration = Math.max(0, Math.floor(payload.duration))
  },

  'task.setProgress': (draft, payload: TaskSetProgressPayload) => {
    const task = draft.tasks[payload.taskId]
    if (!task) return
    task.progress = clamp(Math.round(payload.progress), 0, 100)
  },

  // 名称保留 toggleMilestone：它切换的是 `kind` 在 task / milestone 之间，
  // 命令 id 已出现在既有 UI 与测试里，改名是纯粹的噪音。
  'task.toggleMilestone': (draft, payload: TaskToggleMilestonePayload) => {
    const task = draft.tasks[payload.taskId]
    if (!task) return
    if (task.kind === 'group') return // 摘要任务不能是里程碑

    const toMilestone = task.kind !== 'milestone'
    task.kind = toMilestone ? 'milestone' : 'task'
    task.duration = toMilestone ? 0 : 1
  },

  'task.setScheduling': (draft, payload: TaskSetSchedulingPayload) => {
    const task = draft.tasks[payload.taskId]
    if (!task) return
    if (task.kind === 'group') return // 摘要任务日期只读
    task.scheduling = payload.scheduling
  },

  // 平移任务 = 落成 manual（spec §1.2：钉死区间就是手动排期，旧的 startOn 已移除）。
  // 结束日缺省时按项目日历 taskFinish 折算；拖拽路径已把落点吸附到工作日。
  'task.moveTo': (draft, payload: TaskMoveToPayload) => {
    const task = draft.tasks[payload.taskId]
    if (!task) return
    if (task.kind === 'group') return
    const calendar = draft.calendars[draft.calendarId]
    if (!calendar) return

    const start = payload.startDate
    const isMilestone = task.kind === 'milestone'

    // 平移**保留**当前区间宽度：manual 任务从它的 manual 区间量宽（移动不改宽度），
    // auto 任务仍用 task.duration。**milestone 恒 0** —— 它的零宽区间（起止同日）在
    // workdaysInclusive 下会算成 1，若走量宽分支，第二次拖动就会把里程碑的 duration
    // 从 0 抬成 1（渲染成 1 天、切回 auto 后按 1 个工作日排）。
    const currentWidth = isMilestone
      ? 0
      : task.scheduling.mode === 'manual'
        ? workdaysInclusive(
            toDateStr(task.scheduling.start),
            toDateStr(task.scheduling.finish),
            calendar,
          )
        : task.duration

    const finish = payload.finishDate ?? taskFinish(start, currentWidth, calendar)

    // duration 恒等于**结果区间**的宽度：未给 finishDate 时结束日由 currentWidth 折算，
    // 宽度即 currentWidth（milestone 0）；给了 finishDate 时按新区间重新量宽，避免
    // duration 与新区间漂移（本函数的契约就是「manual 的 duration 等于区间宽度」）。
    const duration =
      isMilestone || payload.finishDate === undefined
        ? currentWidth
        : workdaysInclusive(start, payload.finishDate, calendar)

    task.duration = duration
    task.scheduling = { mode: 'manual', start, finish }
  },

  // 拖拽左/右把手会同时改变「开始日期」与「工期」两个维度。
  // 若拆成 task.setDuration + task.moveTo 两条命令，撤销栈里会留下两条记录 ——
  // 按一次 Ctrl+Z 只退回半步（日期回来了、工期还留着）。
  // 这条命令把两个字段放进**同一次**变更，因此只产生一条撤销记录、一次撤销即可完全复原。
  // manual 下同时写 start 与 finish（区间宽度即真相）。
  'task.resize': (draft, payload: TaskResizePayload) => {
    const task = draft.tasks[payload.taskId]
    if (!task) return
    if (task.kind === 'group') return // 摘要任务日期只读
    if (task.kind === 'milestone') return // 里程碑恒为 0 工期
    const calendar = draft.calendars[draft.calendarId]
    if (!calendar) return

    const duration = Math.max(1, Math.floor(payload.duration))
    task.duration = duration
    // 区间形态收敛到 manualInterval（与拖拽影子共用同一处算式）
    task.scheduling = manualInterval(payload.startDate, duration, calendar)
  },

  // ── v0.2 新增 ─────────────────────────────────────────
  // 合并键约定（v0.4 的 Inspector 按此传参，命令层不登记）：
  //   setNote / setPriority / setDelay 是输入框驱动 → 传 `task.setX:<taskId>`
  //     必须带任务 id：否则「改 A 的备注 → 改 B 的备注」会因相邻且 key 相同
  //     并进同一条撤销记录，一次 Ctrl+Z 连 A 一起退回。
  //   setSchedulingOrder / setAllowSplitting 是点击驱动 → 不传
  'task.setSchedulingOrder': (draft, payload: TaskSetSchedulingOrderPayload) => {
    const task = draft.tasks[payload.taskId]
    if (!task) return
    if (task.kind === 'group') return // 摘要任务的日期由子任务汇总
    task.schedulingOrder = payload.order
  },

  // 备注与优先级对摘要任务同样有意义 —— 不动它们。
  'task.setNote': (draft, payload: TaskSetNotePayload) => {
    const task = draft.tasks[payload.taskId]
    if (!task) return
    task.note = payload.note
  },

  'task.setPriority': (draft, payload: TaskSetPriorityPayload) => {
    const task = draft.tasks[payload.taskId]
    if (!task) return
    task.priority = Math.round(payload.priority)
  },

  'task.setDelay': (draft, payload: TaskSetDelayPayload) => {
    const task = draft.tasks[payload.taskId]
    if (!task) return
    if (task.kind === 'group') return // 同 setSchedulingOrder：摘要不单独挪
    // 负延迟是 lag 的职责，这里只接受非负工作日
    task.delay = Math.max(0, Math.round(payload.delay))
  },

  'task.setAllowSplitting': (draft, payload: TaskSetAllowSplittingPayload) => {
    const task = draft.tasks[payload.taskId]
    if (!task) return
    task.allowSplitting = payload.allowSplitting
  },

  // ── v0.5 新增 ─────────────────────────────────────────
  // 合并键：setEffortMode 点击驱动 → 不传；setEffort 输入框驱动 → 传 `task.setEffort:<taskId>`
  'task.setEffortMode': (draft, payload: TaskSetEffortModePayload) => {
    const task = draft.tasks[payload.taskId]
    if (!task) return
    if (task.kind === 'group') return // 摘要任务的投入由子任务汇总
    // 里程碑是零工期的时间点，按定义不该有工作量。引擎的 effectiveDuration 对
    // milestone 恒返回 0，本不会排出坏日期；但放行会让里程碑挂上 fixedEffort + effort，
    // collectEfforts 随即报出非零投入 —— 一个零工期的点却有工作量，语义自相矛盾。
    // 与同文件其它日期命令（setScheduling / moveTo / resize / setSchedulingOrder）
    // 对 milestone 的守卫保持一致，否则同一类命令里只有这两条放行，规则就不统一了。
    if (task.kind === 'milestone') return

    // 切到「固定工作量」且尚无 effort 时，用「当前工期 × Σunits」初始化：
    // 否则反解会把工期算成 1（effort 缺省 0），任务会突然跳变。
    // Σunits 走与引擎**同一份** sumUnits（src/domain/model/units.ts），不另算一遍。
    if (payload.effortMode === 'fixedEffort' && task.effort === undefined) {
      task.effort = task.duration * Math.max(sumUnits(draft, payload.taskId), 1)
    }
    task.effortMode = payload.effortMode
  },

  'task.setEffort': (draft, payload: TaskSetEffortPayload) => {
    const task = draft.tasks[payload.taskId]
    if (!task) return
    if (task.kind === 'group') return
    // 同 setEffortMode：里程碑零工期，不该有工作量 —— 详见那处的注释。
    if (task.kind === 'milestone') return
    task.effort = payload.effort === undefined ? undefined : Math.max(0, payload.effort)
  },
}
