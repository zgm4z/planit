import type { ComputedSchedule, Task } from '../../domain/model/types'
import type { Command } from '../../commands/types'
import type { OutlineColumnKey } from '../../store/columnKeys'
import { resolveScheduleDates } from '../shared/scheduleDates'

/**
 * 可编列的**编辑器规格**（纯逻辑，不 import React —— 与 outlineColumns.ts 同分层）。
 *
 * 为什么编辑器选择必须由**列 key** 决定、而非按 CellValue 类型分派：
 * `priority` 的 CellValue 是 `text`（`String(task.priority)`）但编辑器必须是数字；
 * `id`/`kind` 也是 `text` 却只读；`duration` 对里程碑返回 `text`「—」、对 group 返回
 * `empty` —— 按类型分派会拿文本编辑器去编一个破折号。CellValue 只继续负责「只读态
 * 怎么显示」，输入控件由本表决定。
 */

export type CellEditorKind = 'text' | 'number' | 'date'

export interface OutlineCellEditorSpec {
  kind: CellEditorKind
  /** 数字量纲位数（0 = 整数，1 = 人日），date/text 忽略 */
  digits?: number
  min?: number
  max?: number
  /** 该行此刻**能不能进编辑**（命令 guard 的镜像；不通过则同只读列） */
  canEdit: (task: Task, schedule: ComputedSchedule | undefined) => boolean
  /** 进编辑时的**草稿种子**。取**原始字段**，绝不去解析显示串（如「3 天」） */
  seed: (task: Task, schedule: ComputedSchedule | undefined) => string
  /** 把已校验的输入拼成命令。返回 null = 不派发（值未变等） */
  toCommand: (task: Task, schedule: ComputedSchedule | undefined, raw: string) => Command | null
}

/**
 * **只读列**：身份列（`kind` / `id`）+ 计算列（浮时 / 基线 / EVM / 成本）+ `assignees`。
 * 这些列**没有**对应写命令，且**不应该**为内联编辑新造命令 —— 它们要么是派生量
 * （造命令 = 两条真相），要么是别人拥有的输入（`assignees` 归 Inspector /
 * 工具栏批量菜单；成本输入在资源级）。它们与可编列**互斥且并集 = 全集**（整表断言）。
 */
export const OUTLINE_READONLY_COLUMN_KEYS: readonly OutlineColumnKey[] = [
  'kind',
  'id',
  'totalSlack',
  'freeSlack',
  'assignees',
  'taskCost',
  'resourceCost',
  'totalCost',
  'baselineStart',
  'baselineFinish',
  'startVariance',
  'finishVariance',
  'bcws',
  'bcwp',
  'sv',
  'bac',
  'acwp',
  'cv',
  'eac',
]

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/**
 * 可编列的编辑器表（**只含可编列**；只读列不在此表 = 无编辑器）。
 * 8 列 8 个既有命令，零新增。
 */
export const OUTLINE_CELL_EDITORS: Partial<Record<OutlineColumnKey, OutlineCellEditorSpec>> = {
  // title 是**唯一例外**：它渲染缩进 + 折叠三角 + 名称，双击目标必须只是「名称 span」
  // （三角仍可点），故内联改名在 TitleCell 内部实现、不复用 EditableCell。本条目供
  // 整表断言与命令测试用（title 的 Display 分支不消费它，但取值口径与其它列统一）。
  title: {
    kind: 'text',
    canEdit: () => true,
    seed: (task) => task.name,
    toCommand: (task, _schedule, raw) =>
      raw === task.name
        ? null
        : {
            type: 'task.rename',
            label: 'commands.task.rename',
            payload: { taskId: task.id, name: raw },
            coalesceKey: `task.rename:${task.id}`,
          },
  },
  note: {
    kind: 'text',
    canEdit: () => true,
    seed: (task) => task.note,
    toCommand: (task, _schedule, raw) =>
      raw === task.note
        ? null
        : {
            type: 'task.setNote',
            label: 'commands.task.setNote',
            payload: { taskId: task.id, note: raw },
            coalesceKey: `task.setNote:${task.id}`,
          },
  },
  // start / finish 复用甘特拖拽的 `task.moveTo`（同一条命令、同一语义：钉成 manual）。
  // start 只给 startDate（moveTo 保留区间宽度）；finish 给 startDate + finishDate
  // （起点不动、宽度按新区间重算）。无排期 → 无种子值 → 只读。
  start: {
    kind: 'date',
    canEdit: (task, schedule) => task.kind !== 'group' && schedule !== undefined,
    seed: (_task, schedule) => (schedule ? resolveScheduleDates(schedule).start : ''),
    toCommand: (task, schedule, raw) => {
      if (!schedule || raw === '' || raw === resolveScheduleDates(schedule).start) return null
      return {
        type: 'task.moveTo',
        label: 'commands.task.moveTo',
        payload: { taskId: task.id, startDate: raw },
        coalesceKey: `task.moveTo:${task.id}`,
      }
    },
  },
  finish: {
    kind: 'date',
    canEdit: (task, schedule) => task.kind !== 'group' && schedule !== undefined,
    seed: (_task, schedule) => (schedule ? resolveScheduleDates(schedule).finish : ''),
    toCommand: (task, schedule, raw) => {
      if (!schedule || raw === '') return null
      const { start, finish } = resolveScheduleDates(schedule)
      if (raw === finish) return null
      return {
        type: 'task.moveTo',
        label: 'commands.task.moveTo',
        payload: { taskId: task.id, startDate: start, finishDate: raw },
        coalesceKey: `task.moveTo:${task.id}`,
      }
    },
  },
  // duration 仅 auto 叶子可编：handler 对 group / milestone / manual 三者皆 no-op
  // （见 taskCommands.ts:127-131），镜像成「不给编辑器」。
  duration: {
    kind: 'number',
    digits: 0,
    min: 0,
    canEdit: (task) => task.kind === 'task' && task.scheduling.mode === 'auto',
    seed: (task) => String(task.duration),
    toCommand: (task, _schedule, raw) => {
      const value = Number(raw)
      if (!Number.isFinite(value) || Math.max(0, Math.floor(value)) === task.duration) return null
      return {
        type: 'task.setDuration',
        label: 'commands.task.setDuration',
        payload: { taskId: task.id, duration: value },
        coalesceKey: `task.setDuration:${task.id}`,
      }
    },
  },
  priority: {
    kind: 'number',
    digits: 0,
    canEdit: () => true,
    seed: (task) => String(task.priority),
    toCommand: (task, _schedule, raw) => {
      const value = Number(raw)
      if (!Number.isFinite(value) || Math.round(value) === task.priority) return null
      return {
        type: 'task.setPriority',
        label: 'commands.task.setPriority',
        payload: { taskId: task.id, priority: value },
        coalesceKey: `task.setPriority:${task.id}`,
      }
    },
  },
  // progress 对 group 行 CellValue 为 empty（无「可编值」）→ 只读；其余类型可编。
  progress: {
    kind: 'number',
    digits: 0,
    min: 0,
    max: 100,
    canEdit: (task) => task.kind !== 'group',
    seed: (task) => String(task.progress),
    toCommand: (task, _schedule, raw) => {
      const value = Number(raw)
      if (!Number.isFinite(value) || clamp(Math.round(value), 0, 100) === task.progress) return null
      return {
        type: 'task.setProgress',
        label: 'commands.task.setProgress',
        payload: { taskId: task.id, progress: value },
        coalesceKey: `task.setProgress:${task.id}`,
      }
    },
  },
  // effort 仅 fixedEffort 叶子可编：fixedDuration 下「投入」是派生量（不是输入）；
  // handler 对 group / milestone 皆 no-op（taskCommands.ts:303-305）。
  effort: {
    kind: 'number',
    digits: 1,
    min: 0,
    canEdit: (task) => task.effortMode === 'fixedEffort' && task.kind === 'task',
    seed: (task) => String(task.effort ?? 0),
    toCommand: (task, _schedule, raw) => {
      const value = Number(raw)
      if (!Number.isFinite(value) || Math.max(0, value) === (task.effort ?? 0)) return null
      return {
        type: 'task.setEffort',
        label: 'commands.task.setEffort',
        payload: { taskId: task.id, effort: value },
        coalesceKey: `task.setEffort:${task.id}`,
      }
    },
  },
}

export function getOutlineCellEditor(key: OutlineColumnKey): OutlineCellEditorSpec | undefined {
  return OUTLINE_CELL_EDITORS[key]
}

/**
 * 显示态的**原因文案** key（原生 `title` tooltip，轻量，不用 Mantine Tooltip）。
 * 只覆盖「可编列但此刻守卫不通过」的情形；天生只读列（id / 浮时 / 基线 / EVM / 成本 /
 * assignees）没有原因 key，返回 undefined（不挂 title）。
 *
 * 与对应 `canEdit` 必须同源：`canEdit` 为真 ⟺ 本函数返回 undefined。
 */
export function getCellDisabledReason(
  key: OutlineColumnKey,
  task: Task,
  schedule: ComputedSchedule | undefined,
): string | undefined {
  switch (key) {
    case 'start':
    case 'finish':
      if (task.kind === 'group') return 'outline.edit.disabled.group'
      if (schedule === undefined) return 'outline.edit.disabled.noSchedule'
      return undefined
    case 'duration':
      if (task.kind === 'group') return 'outline.edit.disabled.group'
      if (task.kind === 'milestone') return 'outline.edit.disabled.milestone'
      if (task.scheduling.mode === 'manual') return 'outline.edit.disabled.manualDuration'
      return undefined
    case 'progress':
      return task.kind === 'group' ? 'outline.edit.disabled.group' : undefined
    case 'effort':
      if (task.kind === 'group') return 'outline.edit.disabled.group'
      if (task.kind === 'milestone') return 'outline.edit.disabled.milestone'
      if (task.effortMode !== 'fixedEffort') return 'outline.edit.disabled.fixedDuration'
      return undefined
    default:
      return undefined
  }
}
