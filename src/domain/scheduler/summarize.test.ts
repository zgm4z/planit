import { describe, it, expect } from 'vitest'
import { createTask } from '../model/factories'
import type { ComputedSchedule, Task } from '../model/types'
import { summarizeParents, detectConflicts } from './summarize'

const sch = (o: Partial<ComputedSchedule>): ComputedSchedule => ({
  earlyStart: '2026-03-02',
  earlyFinish: '2026-03-04',
  lateStart: '2026-03-02',
  lateFinish: '2026-03-04',
  totalSlack: 0,
  isCritical: true,
  ...o,
})

const task = (id: string, over: Partial<Task> = {}): Task => ({
  ...createTask({ name: id }),
  id,
  ...over,
})

describe('summarizeParents', () => {
  it('父任务的起止由子任务汇总而来', () => {
    const tasks: Record<string, Task> = {
      P: task('P', { childIds: ['c1', 'c2'] }),
      c1: task('c1', { parentId: 'P' }),
      c2: task('c2', { parentId: 'P' }),
    }
    const leaf = {
      c1: sch({ earlyStart: '2026-03-02', earlyFinish: '2026-03-04' }),
      c2: sch({
        earlyStart: '2026-03-05',
        earlyFinish: '2026-03-10',
        lateStart: '2026-03-05',
        lateFinish: '2026-03-10',
        totalSlack: 2,
        isCritical: false,
      }),
    }
    const r = summarizeParents(tasks, leaf, ['P'])

    expect(r.P.earlyStart).toBe('2026-03-02')
    expect(r.P.earlyFinish).toBe('2026-03-10')
    expect(r.P.lateStart).toBe('2026-03-02')
    expect(r.P.lateFinish).toBe('2026-03-10')
  })

  it('totalSlack 取子任务最小值，isCritical 任一子任务关键即为真', () => {
    const tasks: Record<string, Task> = {
      P: task('P', { childIds: ['c1', 'c2'] }),
      c1: task('c1', { parentId: 'P' }),
      c2: task('c2', { parentId: 'P' }),
    }
    const leaf = {
      c1: sch({ totalSlack: 0, isCritical: true }),
      c2: sch({ totalSlack: 5, isCritical: false }),
    }
    const r = summarizeParents(tasks, leaf, ['P'])

    expect(r.P.totalSlack).toBe(0)
    expect(r.P.isCritical).toBe(true)
  })

  it('多层嵌套递归汇总', () => {
    const tasks: Record<string, Task> = {
      Root: task('Root', { childIds: ['Mid'] }),
      Mid: task('Mid', { parentId: 'Root', childIds: ['Leaf'] }),
      Leaf: task('Leaf', { parentId: 'Mid' }),
    }
    const leaf = {
      Leaf: sch({ earlyStart: '2026-03-10', earlyFinish: '2026-03-12', isCritical: false, totalSlack: 4 }),
    }
    const r = summarizeParents(tasks, leaf, ['Root'])

    expect(r.Mid.earlyStart).toBe('2026-03-10')
    expect(r.Root.earlyStart).toBe('2026-03-10')
    expect(r.Root.earlyFinish).toBe('2026-03-12')
    expect(r.Root.totalSlack).toBe(4)
  })

  it('叶子任务的结果原样保留在这次汇总里', () => {
    const tasks: Record<string, Task> = { Leaf: task('Leaf') }
    const leaf = { Leaf: sch({ earlyStart: '2026-03-09' }) }
    const r = summarizeParents(tasks, leaf, ['Leaf'])

    expect(r.Leaf.earlyStart).toBe('2026-03-09')
  })
})

describe('detectConflicts', () => {
  it('浮时为负的约束任务被标记为 constraintViolatedByDependency', () => {
    const t = task('A', {
      scheduling: { mode: 'constraint', type: 'startOn', date: '2026-03-04' },
    })
    const tasks = { A: t }
    const schedules = { A: sch({ totalSlack: -3, earlyStart: '2026-03-09' }) }

    const conflicts = detectConflicts(tasks, schedules, ['A'])

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].taskId).toBe('A')
    expect(conflicts[0].kind).toBe('constraintViolatedByDependency')
    expect(conflicts[0].message).toContain('2026-03-04')
    expect(conflicts[0].message).toContain('2026-03-09')
  })

  it('浮时非负的任务不产生冲突', () => {
    const tasks = { A: task('A') }
    const schedules = { A: sch({ totalSlack: 0 }) }
    expect(detectConflicts(tasks, schedules, ['A'])).toEqual([])
  })

  it('摘要任务自身不判冲突，只看叶子', () => {
    const tasks: Record<string, Task> = {
      P: task('P', { childIds: ['c1'] }),
      c1: task('c1', { parentId: 'P' }),
    }
    const schedules = {
      P: sch({ totalSlack: -1 }),
      c1: sch({ totalSlack: 0 }),
    }
    expect(detectConflicts(tasks, schedules, ['P'])).toEqual([])
  })
})
