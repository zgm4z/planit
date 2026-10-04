import { describe, it, expect, beforeEach } from 'vitest'
import type { ComputedSchedule, Task } from '../../domain/model/types'
import { createTask, __resetIdCounterForTests } from '../../domain/model/factories'
import { initCommands, getHandler, __resetRegistryForTests } from '../../commands/registry'
import { OUTLINE_COLUMN_KEYS, type OutlineColumnKey } from '../../store/columnKeys'
import {
  OUTLINE_CELL_EDITORS,
  OUTLINE_READONLY_COLUMN_KEYS,
  getOutlineCellEditor,
  getCellDisabledReason,
} from './outlineCellEditors'

function schedule(start: string, finish: string): ComputedSchedule {
  return {
    earlyStart: start, earlyFinish: finish, lateStart: start, lateFinish: finish,
    scheduledStart: start, scheduledFinish: finish, totalSlack: 0, freeSlack: 0, isCritical: true,
  }
}

beforeEach(() => {
  __resetRegistryForTests()
  initCommands()
  __resetIdCounterForTests()
})

describe('outlineCellEditors · 整表', () => {
  it('每一列要么在编辑器表、要么在只读集，二者互斥且并集 = 全集', () => {
    const editableKeys = Object.keys(OUTLINE_CELL_EDITORS) as OutlineColumnKey[]
    const readonlyKeys = [...OUTLINE_READONLY_COLUMN_KEYS]
    const union = new Set<OutlineColumnKey>([...editableKeys, ...readonlyKeys])

    // 无遗漏：全集 27 列都在并集中
    for (const key of OUTLINE_COLUMN_KEYS) expect(union.has(key)).toBe(true)
    // 无重复 / 无并集外项：并集大小 = 两集之和 = 全集大小
    expect(union.size).toBe(editableKeys.length + readonlyKeys.length)
    expect(editableKeys.length + readonlyKeys.length).toBe(OUTLINE_COLUMN_KEYS.length)
    // 互斥：可编列不在只读集里
    for (const key of editableKeys) expect(readonlyKeys).not.toContain(key)
  })

  it('可编列的命令全部已注册（不缺命令）', () => {
    const task = createTask({ name: 'A', duration: 3 })
    const sched = schedule('2026-03-04', '2026-03-06')
    const effort = { ...createTask({ name: 'E' }), effortMode: 'fixedEffort' as const, effort: 3 }
    const raws: Record<string, string> = {
      title: 'B', note: 'x', start: '2026-03-05', finish: '2026-03-09',
      duration: '5', priority: '5', progress: '50', effort: '5',
    }
    const targets: Record<string, typeof task> = {
      title: task, note: task, start: task, finish: task,
      duration: task, priority: task, progress: task, effort,
    }
    for (const key of Object.keys(OUTLINE_CELL_EDITORS)) {
      const cmd = OUTLINE_CELL_EDITORS[key as OutlineColumnKey]!.toCommand(
        targets[key], sched, raws[key],
      )
      expect(cmd, `${key} 应产出命令`).not.toBeNull()
      expect(() => getHandler(cmd!.type)).not.toThrow()
    }
  })
})

describe('outlineCellEditors · canEdit 守卫', () => {
  const sched = schedule('2026-03-04', '2026-03-06')
  const autoLeaf = createTask({ name: 'leaf', duration: 3 })
  const manualLeaf = { ...autoLeaf, scheduling: { mode: 'manual' as const, start: '2026-03-02T09:00', finish: '2026-03-04T18:00' } }
  const group = createTask({ name: 'g', kind: 'group' })
  const milestone = createTask({ name: 'm', kind: 'milestone' })
  const fixedEffortLeaf = createTask({ name: 'e', effortMode: 'fixedEffort', effort: 3 })

  it('duration 仅 auto 叶子可编', () => {
    const spec = OUTLINE_CELL_EDITORS.duration!
    expect(spec.canEdit(autoLeaf, sched)).toBe(true)
    expect(spec.canEdit(manualLeaf, sched)).toBe(false)
    expect(spec.canEdit(group, sched)).toBe(false)
    expect(spec.canEdit(milestone, sched)).toBe(false)
  })

  it('start / finish 对 group 与无排期为假', () => {
    for (const key of ['start', 'finish'] as const) {
      const spec = OUTLINE_CELL_EDITORS[key]!
      expect(spec.canEdit(autoLeaf, sched)).toBe(true)
      expect(spec.canEdit(group, sched)).toBe(false)
      expect(spec.canEdit(autoLeaf, undefined)).toBe(false)
    }
  })

  it('effort 仅 fixedEffort 叶子可编（非 group / 非 milestone）', () => {
    const spec = OUTLINE_CELL_EDITORS.effort!
    expect(spec.canEdit(fixedEffortLeaf, sched)).toBe(true)
    expect(spec.canEdit(autoLeaf, sched)).toBe(false) // fixedDuration
    expect(spec.canEdit({ ...fixedEffortLeaf, kind: 'milestone' }, sched)).toBe(false)
    expect(spec.canEdit({ ...fixedEffortLeaf, kind: 'group' }, sched)).toBe(false)
  })

  it('progress 对 group 为假、对其余类型为真；priority / title / note 全类型为真', () => {
    const progress = OUTLINE_CELL_EDITORS.progress!
    expect(progress.canEdit(autoLeaf, sched)).toBe(true)
    expect(progress.canEdit(milestone, sched)).toBe(true)
    expect(progress.canEdit(group, sched)).toBe(false)
    for (const key of ['priority', 'title', 'note'] as const) {
      const spec = OUTLINE_CELL_EDITORS[key]!
      expect(spec.canEdit(autoLeaf, sched)).toBe(true)
      expect(spec.canEdit(milestone, sched)).toBe(true)
      expect(spec.canEdit(group, sched)).toBe(true)
    }
  })
})

describe('outlineCellEditors · seed 取原始字段', () => {
  const sched = schedule('2026-03-04', '2026-03-06')
  it('duration 种子是原始数字串（不是「3 天」）', () => {
    const task = createTask({ name: 'A', duration: 3 })
    expect(OUTLINE_CELL_EDITORS.duration!.seed(task, sched)).toBe('3')
  })
  it('start / finish 种子是排期的 YYYY-MM-DD', () => {
    const task = createTask({ name: 'A', duration: 3 })
    expect(OUTLINE_CELL_EDITORS.start!.seed(task, sched)).toBe('2026-03-04')
    expect(OUTLINE_CELL_EDITORS.finish!.seed(task, sched)).toBe('2026-03-06')
  })
  it('progress / priority 种子是数字串', () => {
    const task = { ...createTask({ name: 'A' }), progress: 40, priority: 7 }
    expect(OUTLINE_CELL_EDITORS.progress!.seed(task, sched)).toBe('40')
    expect(OUTLINE_CELL_EDITORS.priority!.seed(task, sched)).toBe('7')
  })
})

describe('outlineCellEditors · toCommand 值未变返回 null', () => {
  const sched = schedule('2026-03-04', '2026-03-06')
  const task = createTask({ name: 'A', duration: 3 })
  it('各列种子回填时不派发', () => {
    expect(OUTLINE_CELL_EDITORS.title!.toCommand(task, sched, task.name)).toBeNull()
    expect(OUTLINE_CELL_EDITORS.note!.toCommand(task, sched, task.note)).toBeNull()
    expect(OUTLINE_CELL_EDITORS.start!.toCommand(task, sched, '2026-03-04')).toBeNull()
    expect(OUTLINE_CELL_EDITORS.finish!.toCommand(task, sched, '2026-03-06')).toBeNull()
    expect(OUTLINE_CELL_EDITORS.duration!.toCommand(task, sched, String(task.duration))).toBeNull()
    expect(OUTLINE_CELL_EDITORS.priority!.toCommand(task, sched, String(task.priority))).toBeNull()
    expect(OUTLINE_CELL_EDITORS.progress!.toCommand(task, sched, String(task.progress))).toBeNull()
  })
})

describe('outlineCellEditors · getOutlineCellEditor / getCellDisabledReason', () => {
  const sched = schedule('2026-03-04', '2026-03-06')
  it('只读列无编辑器、无原因', () => {
    expect(getOutlineCellEditor('id')).toBeUndefined()
    expect(getCellDisabledReason('id', createTask({ name: 'A' }), sched)).toBeUndefined()
  })
  it('守卫不通过时给出对应原因 key', () => {
    const manual = { ...createTask({ name: 'A' }), scheduling: { mode: 'manual' as const, start: '2026-03-02T09:00', finish: '2026-03-04T18:00' } }
    expect(getCellDisabledReason('duration', manual, sched)).toBe('outline.edit.disabled.manualDuration')
    expect(getCellDisabledReason('duration', createTask({ name: 'm', kind: 'milestone' }), sched)).toBe('outline.edit.disabled.milestone')
    expect(getCellDisabledReason('start', createTask({ name: 'g', kind: 'group' }), sched)).toBe('outline.edit.disabled.group')
    expect(getCellDisabledReason('start', createTask({ name: 'A' }), undefined)).toBe('outline.edit.disabled.noSchedule')
    expect(getCellDisabledReason('effort', createTask({ name: 'A' }), sched)).toBe('outline.edit.disabled.fixedDuration')
  })
})

describe('outlineCellEditors · 守卫与原因同源（canEdit ⟺ 无原因）', () => {
  const sched = schedule('2026-03-04', '2026-03-06')
  const autoLeaf = createTask({ name: 'leaf', duration: 3 })
  const tasks: Task[] = [
    autoLeaf,
    { ...autoLeaf, scheduling: { mode: 'manual' as const, start: '2026-03-02T09:00', finish: '2026-03-04T18:00' } },
    createTask({ name: 'g', kind: 'group' }),
    createTask({ name: 'm', kind: 'milestone' }),
    createTask({ name: 'e', effortMode: 'fixedEffort', effort: 3 }),
    { ...createTask({ name: 'em', effortMode: 'fixedEffort', effort: 3 }), kind: 'milestone' as const },
  ]

  it('全列 × 多类型 × 有/无排期：canEdit=false ⟺ getCellDisabledReason 有值', () => {
    for (const key of Object.keys(OUTLINE_CELL_EDITORS) as OutlineColumnKey[]) {
      const spec = OUTLINE_CELL_EDITORS[key]!
      for (const task of tasks) {
        for (const schedule of [sched, undefined]) {
          const canEdit = spec.canEdit(task, schedule)
          const reason = getCellDisabledReason(key, task, schedule)
          // 两处守卫必须同源：能编 ⟺ 无原因；不能编 ⟺ 有原因（将来任一处漂移立刻红）
          expect(reason !== undefined, `${key} / ${task.kind} / ${schedule ? '排期' : '无排期'}`).toBe(!canEdit)
        }
      }
    }
  })
})
