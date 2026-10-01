import { describe, it, expect } from 'vitest'
import {
  createCalendar,
  createProject,
  createTask,
  createDependency,
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
    expect(t.isMilestone).toBe(false)
    expect(t.childIds).toEqual([])
    expect(t.parentId).toBeNull()
    expect(t.effortMode).toBe('fixedDuration')
  })

  it('里程碑强制工期为 0', () => {
    const t = createTask({ name: '发布', isMilestone: true, duration: 5 })
    expect(t.isMilestone).toBe(true)
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
