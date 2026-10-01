import { describe, it, expect } from 'vitest'
import {
  createCalendar,
  createProject,
  createTask,
  createDependency,
  __resetIdCounterForTests,
  seedIdCounterFromProject,
  DEFAULT_CALENDAR_ID,
} from './factories'

describe('createCalendar', () => {
  it('默认为周一至周五工作、每天 8 小时、无例外', () => {
    const cal = createCalendar()
    expect(cal.workingDays).toEqual([true, true, true, true, true, false, false])
    expect(cal.hoursPerDay).toBe(8)
    expect(cal.exceptions).toEqual({})
  })
})

describe('createProject', () => {
  it('创建一个带默认日历的空项目', () => {
    const p = createProject('测试项目', '2026-03-02')
    expect(p.name).toBe('测试项目')
    expect(p.startDate).toBe('2026-03-02')
    expect(p.calendarId).toBe(DEFAULT_CALENDAR_ID)
    expect(p.calendars[DEFAULT_CALENDAR_ID]).toBeDefined()
    expect(p.rootIds).toEqual([])
    expect(Object.keys(p.tasks)).toEqual([])
    expect(p.resources).toEqual({})
    expect(p.assignments).toEqual({})
  })

  it('生成的 id 互不相同', () => {
    expect(createProject('A').id).not.toBe(createProject('B').id)
  })
})

describe('createTask', () => {
  it('默认工期 1 天、auto 排期、0 进度、非里程碑', () => {
    const t = createTask({ name: '写文档' })
    expect(t.name).toBe('写文档')
    expect(t.duration).toBe(1)
    expect(t.scheduling).toEqual({ mode: 'auto' })
    expect(t.progress).toBe(0)
    expect(t.kind).toBe('task')
    expect(t.childIds).toEqual([])
    expect(t.parentId).toBeNull()
    expect(t.effortMode).toBe('fixedDuration')
  })

  it('里程碑强制工期为 0', () => {
    const t = createTask({ name: '发布', kind: 'milestone', duration: 5 })
    expect(t.kind).toBe('milestone')
    expect(t.duration).toBe(0)
  })
})

describe('createDependency', () => {
  it('默认 FS 且 lag 为 0', () => {
    const d = createDependency('a', 'b')
    expect(d.fromTaskId).toBe('a')
    expect(d.toTaskId).toBe('b')
    expect(d.type).toBe('FS')
    expect(d.lag).toBe(0)
  })
})

describe('seedIdCounterFromProject', () => {
  it('从已载入项目播种计数器后，新建 id 不会与既有 id 冲突', () => {
    __resetIdCounterForTests()
    const first = createProject('原始', '2026-03-02')
    const t1 = createTask({ name: 'A' })
    first.tasks[t1.id] = t1
    const t2 = createTask({ name: 'B' })
    first.tasks[t2.id] = t2

    // 模拟页面重载：计数器归零
    __resetIdCounterForTests()
    seedIdCounterFromProject(first)

    // 连续新建多个任务：只建一个是抓不住 bug 的 —— 计数器归零后第一个
    // 新 id 恰好是尚未占用的 task_1，直到第二个才会撞上既有的 task_2。
    for (const name of ['C', 'D', 'E', 'F', 'G']) {
      const t = createTask({ name })
      expect(first.tasks[t.id]).toBeUndefined()
      first.tasks[t.id] = t
    }
  })
})
