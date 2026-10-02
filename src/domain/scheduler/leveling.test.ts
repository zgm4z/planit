import { describe, it, expect } from 'vitest'
import { createAssignment, createProject, createResource, createTask } from '../model/factories'
import type { DateStr, Project, TaskId } from '../model/types'
import { workdaysInRange } from '../calendar/workdays'
import { buildScheduleContext } from './context'
import { resourceDayLoad, collectOverloads, type LeveledDates } from './leveling'

// 2026-03-02 是周一，默认日历周一至周五上班。
const START = '2026-03-02'

function project(): Project {
  return createProject('负载测试', START)
}

describe('workdaysInRange', () => {
  it('含首尾、跳过周末', () => {
    const cal = project().calendars.default
    // 03-06(五) .. 03-10(二)：跳过 03-07/03-08 周末
    expect(workdaysInRange('2026-03-06', '2026-03-10', cal)).toEqual([
      '2026-03-06',
      '2026-03-09',
      '2026-03-10',
    ])
  })

  it('start 落在周末时吸附到下一个工作日', () => {
    const cal = project().calendars.default
    // 03-07 是周六 → 吸附到 03-09
    expect(workdaysInRange('2026-03-07', '2026-03-09', cal)).toEqual(['2026-03-09'])
  })

  it('start > finish 返回空', () => {
    const cal = project().calendars.default
    expect(workdaysInRange('2026-03-10', '2026-03-05', cal)).toEqual([])
  })
})

describe('resourceDayLoad / collectOverloads', () => {
  it('负载 = 该资源当日全部 assignmentUnits 之和（availability × units × efficiency）', () => {
    const p = project()
    const t1 = createTask({ name: 'T1', duration: 3 }) // 03-02..03-04
    const t2 = createTask({ name: 'T2', duration: 2 }) // 03-02..03-03
    const r = { ...createResource({ name: 'R' }), availability: 1 } // eff 缺省 1
    p.tasks[t1.id] = t1
    p.tasks[t2.id] = t2
    p.resources[r.id] = r
    // T1 占 R 全单元；T2 占 R 一半 → 03-02 / 03-03 负载各 1.5，03-04 负载 1
    const a1 = createAssignment({ taskId: t1.id, resourceId: r.id, units: 1 })
    const a2 = createAssignment({ taskId: t2.id, resourceId: r.id, units: 0.5 })
    p.assignments[a1.id] = a1
    p.assignments[a2.id] = a2

    const dates: Record<TaskId, LeveledDates> = {
      [t1.id]: { start: '2026-03-02', finish: '2026-03-04' },
      [t2.id]: { start: '2026-03-02', finish: '2026-03-03' },
    }
    const load = resourceDayLoad(buildScheduleContext(p), dates)
    const byDay = load.get(r.id)!
    expect(byDay.get('2026-03-02')).toBeCloseTo(1.5)
    expect(byDay.get('2026-03-03')).toBeCloseTo(1.5)
    expect(byDay.get('2026-03-04')).toBeCloseTo(1) // =1，不算超载
    expect(byDay.has('2026-03-05')).toBe(false) // 无任务覆盖

    const overloads = collectOverloads(load)
    expect(overloads.map((o) => o.date)).toEqual(['2026-03-02', '2026-03-03'])
    expect(overloads[0].resourceId).toBe(r.id)
  })

  it('efficiency 与 availability 参与负载（同一原语，不重算）', () => {
    const p = project()
    const t = createTask({ name: 'T', duration: 1 })
    // availability 0.5、efficiency 2 → assignmentUnits = 1；units 1
    const r = { ...createResource({ name: 'R' }), availability: 0.5, efficiency: 2 }
    p.tasks[t.id] = t
    p.resources[r.id] = r
    const a = createAssignment({ taskId: t.id, resourceId: r.id, units: 1 })
    p.assignments[a.id] = a

    const dates: Record<TaskId, LeveledDates> = {
      [t.id]: { start: '2026-03-02', finish: '2026-03-02' },
    }
    const byDay = resourceDayLoad(buildScheduleContext(p), dates).get(r.id)!
    expect(byDay.get('2026-03-02')).toBeCloseTo(0.5 * 1 * 2)
    // 负载 = 1，不 > 1 → 不超载
    expect(collectOverloads(resourceDayLoad(buildScheduleContext(p), dates))).toEqual([])
  })

  it('不同资源各自独立；悬空分配（指向不存在资源）被忽略', () => {
    const p = project()
    const t = createTask({ name: 'T', duration: 1 })
    const r1 = createResource({ name: 'R1' })
    const r2 = createResource({ name: 'R2' })
    p.tasks[t.id] = t
    p.resources[r1.id] = r1
    p.resources[r2.id] = r2
    p.assignments.a1 = createAssignment({ taskId: t.id, resourceId: r1.id, units: 1 })
    p.assignments.a2 = createAssignment({ taskId: t.id, resourceId: 'ghost', units: 1 })

    const dates: Record<TaskId, LeveledDates> = {
      [t.id]: { start: '2026-03-02', finish: '2026-03-02' },
    }
    const load = resourceDayLoad(buildScheduleContext(p), dates)
    expect(load.get(r1.id)?.get('2026-03-02')).toBeCloseTo(1)
    expect(load.get(r2.id)).toBeUndefined() // R2 无分配
    expect(collectOverloads(load)).toEqual([])
  })

  it('没有覆盖日期的任务（如摘要）不产生负载', () => {
    const p = project()
    const r = createResource({ name: 'R' })
    p.resources[r.id] = r
    p.assignments.a1 = createAssignment({ taskId: 'missing', resourceId: r.id, units: 1 })

    const load = resourceDayLoad(buildScheduleContext(p), {} as Record<TaskId, LeveledDates>)
    expect(load.size).toBe(0)
  })
})

describe('collectOverloads 顺序确定', () => {
  it('先按资源 id，再按日期升序', () => {
    const load = new Map([
      ['r2', new Map<DateStr, number>([['2026-03-05', 2], ['2026-03-02', 1.5]])],
      ['r1', new Map<DateStr, number>([['2026-03-03', 1.2]])],
    ])
    expect(collectOverloads(load).map((o) => `${o.resourceId}@${o.date}`)).toEqual([
      'r1@2026-03-03',
      'r2@2026-03-02',
      'r2@2026-03-05',
    ])
  })
})
