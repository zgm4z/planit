import type {
  Baseline,
  BaselineEntry,
  DateStr,
  Project,
  SchedulingDirection,
  TaskId,
} from '../domain/model/types'
import { nextId } from '../domain/model/factories'
import { solve } from '../domain/scheduler'
import type { CommandHandler } from './types'

export interface ProjectRenamePayload {
  name: string
}

export interface ProjectSetDirectionPayload {
  direction: SchedulingDirection
}

export interface ProjectSetStartDatePayload {
  startDate: DateStr
}

/** endDate 传 undefined 即「清空锚点」（forward 下变为无期限） */
export interface ProjectSetEndDatePayload {
  endDate: DateStr | undefined
}

export interface ProjectSetBaselinePayload {
  /** 基线名。**由 UI 按当前语言给出** —— 领域层不产出自然语言（见 ConflictParams 的注释） */
  name: string
}
export interface ProjectSetActiveBaselinePayload {
  /** null = 不对比 */
  baselineId: string | null
}
export interface ProjectDeleteBaselinePayload {
  baselineId: string
}
/** statusDate 传 undefined 即「清除基准日」 */
export interface ProjectSetStatusDatePayload {
  statusDate: DateStr | undefined
}

export const projectHandlers: Record<string, CommandHandler<any>> = {
  'project.rename': (draft, payload: ProjectRenamePayload) => {
    draft.name = payload.name
  },

  'project.setDirection': (draft, payload: ProjectSetDirectionPayload) => {
    draft.schedulingDirection = payload.direction
  },

  'project.setStartDate': (draft, payload: ProjectSetStartDatePayload) => {
    draft.startDate = payload.startDate
  },

  'project.setEndDate': (draft, payload: ProjectSetEndDatePayload) => {
    draft.endDate = payload.endDate
  },

  /**
   * v1.0：把**当前排期**拍成一份快照，加入 baselines 并设为活动基线。
   *
   * 快照源是 `solve(draft)` —— 引擎是排期的唯一权威，**不由 UI 拼 payload**
   * （那等于让 UI 决定基线的形状，是「同一概念两份实现」的入口）。
   * `solve` 是纯函数、只读；Immer 的 draft 是可正常读取的 Proxy，直接喂它即可
   * （draft 上的读取不会留下 patch）。代价是每次点击多算一遍 solve —— 一次
   * O(n) 的派生，与点击同频，可接受；换来的是「基线形状由引擎定义」这一不变量。
   *
   * 只快照**叶子任务**（摘要的日期是派生量，存它等于两份真相，见计划偏差 1）。
   * `createdAt` 在 handler 里取墙上时钟：与 `createProject` 的 createdAt 同例，
   * 且 redo 走 applyPatches 重放、不会重跑 handler，因此时间戳稳定。
   * 点击驱动 → 合并键不传（命令层注释里登记的约定）。
   */
  'project.setBaseline': (draft, payload: ProjectSetBaselinePayload) => {
    const result = solve(draft as Project)

    const entries: Record<TaskId, BaselineEntry> = {}
    for (const [id, task] of Object.entries(draft.tasks)) {
      if (task.childIds.length > 0) continue // 只快照叶子
      const schedule = result.schedules[id]
      if (!schedule) continue
      entries[id] = { name: task.name, start: schedule.scheduledStart, finish: schedule.scheduledFinish }
    }

    const baseline: Baseline = {
      id: nextId('bl'),
      name: payload.name,
      createdAt: new Date().toISOString(),
      entries,
    }
    draft.baselines.push(baseline)
    draft.activeBaselineId = baseline.id
  },

  // 切换对比基线。未知 id 是 no-op —— 绝不把 activeBaselineId 指到一个不存在的东西上。
  'project.setActiveBaseline': (draft, payload: ProjectSetActiveBaselinePayload) => {
    if (payload.baselineId === null) {
      draft.activeBaselineId = null
      return
    }
    if (draft.baselines.some((baseline) => baseline.id === payload.baselineId)) {
      draft.activeBaselineId = payload.baselineId
    }
  },

  // 删基线。若删的正是活动基线 → 归零，绝不留悬空的 activeBaselineId。
  // **不**级联删任务、也**不**删别的基线的条目 —— 基线之间彼此独立。
  'project.deleteBaseline': (draft, payload: ProjectDeleteBaselinePayload) => {
    draft.baselines = draft.baselines.filter((baseline) => baseline.id !== payload.baselineId)
    if (draft.activeBaselineId === payload.baselineId) draft.activeBaselineId = null
  },

  // 基准日（挣值的「到某日为止」）。输入框驱动 → 合并键 `project.setStatusDate`（见计划文档）。
  'project.setStatusDate': (draft, payload: ProjectSetStatusDatePayload) => {
    draft.statusDate = payload.statusDate
  },
}
