import { describe, it, expect } from 'vitest'
import { createProject, createTask } from '../model/factories'
import { activeBaseline, collectBaselineDiffs, collectEarnedValues } from './earnedValue'

const START = '2026-03-02'

describe('activeBaseline', () => {
  it('无 activeBaselineId → undefined；指向不存在的 id → undefined', () => {
    const project = createProject('x', START)
    expect(activeBaseline(project)).toBeUndefined()
    project.activeBaselineId = 'ghost'
    expect(activeBaseline(project)).toBeUndefined()
  })

  it('指向存在的基线 → 返回它', () => {
    const project = createProject('x', START)
    project.baselines = [
      { id: 'bl_1', name: 'B1', createdAt: 'now', entries: {} },
      { id: 'bl_2', name: 'B2', createdAt: 'now', entries: {} },
    ]
    project.activeBaselineId = 'bl_2'
    expect(activeBaseline(project)?.name).toBe('B2')
  })
})

describe('collectEarnedValues —— 无成本时的空表语义', () => {
  it('没有任何分配 → 全部 BAC / EV 为 0，不产生 NaN（costs 兜底 0）', () => {
    const project = createProject('空', START)
    const task = createTask({ name: 'T', duration: 2 })
    project.tasks[task.id] = task
    project.rootIds.push(task.id)

    const result = collectEarnedValues(project, {}, [task])
    expect(result[task.id]).toEqual({ bac: 0, ev: 0, pv: null, sv: null })
  })
})

describe('collectBaselineDiffs —— 空基线', () => {
  it('无活动基线 → 空表（不抛）', () => {
    const project = createProject('x', START)
    expect(collectBaselineDiffs(project, {})).toEqual({})
  })

  it('基线条目的任务存在但当前无排期 → 跳过（不产出 undefined 字段）', () => {
    const project = createProject('x', START)
    project.baselines = [
      { id: 'bl_1', name: 'B', createdAt: 'now', entries: { t1: { name: 'T', start: START, finish: START } } },
    ]
    project.activeBaselineId = 'bl_1'
    project.tasks.t1 = createTask({ name: 'T' })

    expect(collectBaselineDiffs(project, {})).toEqual({}) // schedules 里没有 t1
  })
})
