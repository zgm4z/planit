import { describe, it, expect, beforeEach } from 'vitest'

import { createProject, createTask, __resetIdCounterForTests } from '../domain/model/factories'
import type { Project } from '../domain/model/types'
import { canIndent, canOutdent } from './outlineActions'

let project: Project
/** 顶层三个兄弟：first / second / third */
let first: string
let second: string
let third: string
let childOfFirst: string
let childOfSecond: string
let milestone: string

beforeEach(() => {
  __resetIdCounterForTests()
  project = createProject('测试', '2026-03-02')

  const a = createTask({ name: '一' })
  const b = createTask({ name: '二' })
  const c = createTask({ name: '三' })
  const m = createTask({ name: '里程碑', kind: 'milestone' })
  const aChild = createTask({ name: '一之子', parentId: a.id })
  const bChild = createTask({ name: '二之子', parentId: b.id })

  first = a.id
  second = b.id
  third = c.id
  milestone = m.id
  childOfFirst = aChild.id
  childOfSecond = bChild.id

  project.tasks = {
    [a.id]: { ...a, childIds: [aChild.id] },
    [b.id]: { ...b, childIds: [bChild.id] },
    [c.id]: c,
    [m.id]: m,
    [aChild.id]: aChild,
    [bChild.id]: bChild,
  }
  project.rootIds = [a.id, b.id, c.id]
})

describe('canIndent', () => {
  it('第一个兄弟不能缩进（没有可依附的前驱）', () => {
    expect(canIndent(project, first)).toBe(false)
  })

  it('第二个兄弟可以缩进为第一个兄弟的子任务', () => {
    expect(canIndent(project, second)).toBe(true)
  })

  it('第三个兄弟同样可以缩进', () => {
    expect(canIndent(project, third)).toBe(true)
  })

  it('前一个兄弟是里程碑时不能缩进（里程碑不可作父任务）', () => {
    project.rootIds = [milestone, second]
    expect(canIndent(project, second)).toBe(false)
  })

  it('子任务在父层内不是第一个时也可以继续缩进', () => {
    // 「一」下挂两个孩子，「二之子」在父层里排第二 → 可缩进
    project.tasks[first].childIds = [childOfFirst, childOfSecond]
    project.tasks[childOfSecond].parentId = first
    expect(canIndent(project, childOfSecond)).toBe(true)
  })

  it('未选中任务 / 任务不存在时返回 false', () => {
    expect(canIndent(project, null)).toBe(false)
    expect(canIndent(project, 'task_不存在')).toBe(false)
  })
})

describe('canOutdent', () => {
  it('顶层任务不能反缩进（已经在顶层）', () => {
    expect(canOutdent(project, first)).toBe(false)
  })

  it('有父任务的子任务可以反缩进', () => {
    expect(canOutdent(project, childOfFirst)).toBe(true)
  })

  it('父任务缺失（数据损坏）时返回 false，与命令层的静默 no-op 一致', () => {
    project.tasks[childOfFirst].parentId = 'task_幽灵'
    expect(canOutdent(project, childOfFirst)).toBe(false)
  })

  it('未选中任务 / 任务不存在时返回 false', () => {
    expect(canOutdent(project, null)).toBe(false)
    expect(canOutdent(project, 'task_不存在')).toBe(false)
  })
})
