import { describe, it, expect } from 'vitest'
import { createTask } from '../model/factories'
import type { ComputedSchedule, Task } from '../model/types'
import { summarizeParents, detectConflicts } from './summarize'

const sch = (o: Partial<ComputedSchedule>): ComputedSchedule => ({
  earlyStart: '2026-03-02',
  earlyFinish: '2026-03-04',
  lateStart: '2026-03-02',
  lateFinish: '2026-03-04',
  // 默认（asap + forward）下 scheduled* === early*，与引擎的不变量一致
  scheduledStart: '2026-03-02',
  scheduledFinish: '2026-03-04',
  totalSlack: 0,
  freeSlack: 0,
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

  it('freeSlack 取子任务最小值（两个子任务都非零且不相等）', () => {
    const tasks: Record<string, Task> = {
      P: task('P', { childIds: ['c1', 'c2'] }),
      c1: task('c1', { parentId: 'P' }),
      c2: task('c2', { parentId: 'P' }),
    }
    // 两个子任务的 freeSlack 都非零且不相等，于是：
    //   min → 2（正确）；取第一个 → 5；取 0（硬编码）→ 0；取 max → 5。
    // totalSlack 同样设为不等值，顺带区分 freeSlack 与 totalSlack 两个口径。
    const leaf = {
      c1: sch({ freeSlack: 5, totalSlack: 7 }),
      c2: sch({ freeSlack: 2, totalSlack: 3 }),
    }
    const r = summarizeParents(tasks, leaf, ['P'])

    expect(r.P.freeSlack).toBe(2)
    expect(r.P.totalSlack).toBe(3)
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

  it('汇总结果与叶子排期合并在同一张表里', () => {
    const tasks: Record<string, Task> = {
      Root: task('Root', { childIds: ['Child'] }),
      Child: task('Child', { parentId: 'Root' }),
    }
    const leaf = { Child: sch({ earlyStart: '2026-03-09', earlyFinish: '2026-03-11' }) }
    const r = summarizeParents(tasks, leaf, ['Root'])

    // Child 原样保留；Root 只能由 visit 递归汇总得到
    expect(r.Child.earlyStart).toBe('2026-03-09')
    expect(r.Root).toEqual(
      sch({ earlyStart: '2026-03-09', earlyFinish: '2026-03-11' }),
    )
  })
})

describe('detectConflicts', () => {
  it('有约束的负浮时任务只报告不可行与浮时，不推断成因', () => {
    const t = task('A', {
      scheduling: { mode: 'manual', start: '2026-03-04', finish: '2026-03-04' },
    })
    const tasks = { A: t }
    const schedules = { A: sch({ totalSlack: -3, earlyStart: '2026-03-09' }) }

    const conflicts = detectConflicts(tasks, schedules, ['A'])

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toEqual({
      taskId: 'A',
      kind: 'infeasibleSchedule',
      slack: -3,
    })
  })

  it('无约束任务的负浮时使用相同的中性结构', () => {
    const t = task('A') // 默认 mode: 'auto'
    const tasks = { A: t }
    const schedules = { A: sch({ totalSlack: -2, earlyStart: '2026-03-09' }) }

    const conflicts = detectConflicts(tasks, schedules, ['A'])

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toEqual({
      taskId: 'A',
      kind: 'infeasibleSchedule',
      slack: -2,
    })
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
