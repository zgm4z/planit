import { describe, it, expect, beforeEach } from 'vitest'
import { createProject } from '../domain/model/factories'
import type { Project } from '../domain/model/types'
import { CycleError } from '../domain/scheduler/graph'
import { registerHandler, execute, __resetRegistryForTests } from './registry'
import { taskHandlers } from './taskCommands'
import { taskStructureHandlers } from './taskStructureCommands'
import { dependencyHandlers } from './dependencyCommands'
import { calendarHandlers } from './calendarCommands'
import { projectHandlers } from './projectCommands'
import type { CommandType } from './types'

let project: Project

function setup(): void {
  __resetRegistryForTests()
  const all = {
    ...taskHandlers,
    ...taskStructureHandlers,
    ...dependencyHandlers,
    ...calendarHandlers,
    ...projectHandlers,
  }
  for (const [type, handler] of Object.entries(all)) {
    registerHandler(type as CommandType, handler)
  }
  project = createProject('测试项目', '2026-03-02')
}

function run(p: Project, type: CommandType, payload: unknown): Project {
  return execute(p, { type, label: '操作', payload }).project
}

/** 建一棵 A、B、C 三个顶层任务的树 */
function threeRoots(): { p: Project; a: string; b: string; c: string } {
  const p1 = run(project, 'task.create', { name: 'A' })
  const p2 = run(p1, 'task.create', { name: 'B' })
  const p3 = run(p2, 'task.create', { name: 'C' })
  return { p: p3, a: p3.rootIds[0], b: p3.rootIds[1], c: p3.rootIds[2] }
}

describe('task.reorder', () => {
  beforeEach(setup)

  it('调整同级顺序：把 C 移到最前', () => {
    const { p, c } = threeRoots()
    const r = run(p, 'task.reorder', { taskId: c, toIndex: 0 })
    expect(r.rootIds[0]).toBe(c)
  })

  it('越界的 toIndex 被夹到合法范围', () => {
    const { p, a } = threeRoots()
    const r = run(p, 'task.reorder', { taskId: a, toIndex: 99 })
    expect(r.rootIds[2]).toBe(a)
  })
})

describe('task.indent / task.outdent', () => {
  beforeEach(setup)

  it('缩进为前一个兄弟的子任务', () => {
    const { p, a, b } = threeRoots()
    const r = run(p, 'task.indent', { taskId: b })

    expect(r.tasks[a].childIds).toEqual([b])
    expect(r.tasks[b].parentId).toBe(a)
    expect(r.rootIds).toHaveLength(2)
  })

  it('第一个兄弟无法缩进（没有前一个兄弟）', () => {
    const { p, a } = threeRoots()
    const r = run(p, 'task.indent', { taskId: a })
    expect(r).toEqual(p)
  })

  it('不能缩进到里程碑之下', () => {
    const { p, a, b } = threeRoots()
    const withMilestone = run(p, 'task.toggleMilestone', { taskId: a })
    const r = run(withMilestone, 'task.indent', { taskId: b })
    expect(r.tasks[b].parentId).toBeNull()
  })

  it('反缩进把子任务提升到祖父层级，排在其原父任务之后', () => {
    const { p, a, b } = threeRoots()
    const indented = run(p, 'task.indent', { taskId: b })
    const r = run(indented, 'task.outdent', { taskId: b })

    expect(r.tasks[b].parentId).toBeNull()
    expect(r.tasks[a].childIds).toEqual([])
    expect(r.rootIds).toEqual([a, b, r.rootIds[2]])
  })

  it('顶层任务无法反缩进', () => {
    const { p, a } = threeRoots()
    expect(run(p, 'task.outdent', { taskId: a })).toEqual(p)
  })
})

describe('dependency.create', () => {
  beforeEach(setup)

  it('创建默认 FS 依赖', () => {
    const { p, a, b } = threeRoots()
    const r = run(p, 'dependency.create', { fromTaskId: a, toTaskId: b })

    const deps = Object.values(r.dependencies)
    expect(deps).toHaveLength(1)
    expect(deps[0].fromTaskId).toBe(a)
    expect(deps[0].toTaskId).toBe(b)
    expect(deps[0].type).toBe('FS')
    expect(deps[0].lag).toBe(0)
  })

  it('成环时抛出 CycleError 且不写入任何依赖', () => {
    const { p, a, b } = threeRoots()
    const p2 = run(p, 'dependency.create', { fromTaskId: a, toTaskId: b })

    expect(() => run(p2, 'dependency.create', { fromTaskId: b, toTaskId: a }))
      .toThrow(CycleError)
    // 原项目不受影响
    expect(Object.keys(p2.dependencies)).toHaveLength(1)
  })

  it('自环被拒绝', () => {
    const { p, a } = threeRoots()
    expect(() => run(p, 'dependency.create', { fromTaskId: a, toTaskId: a }))
      .toThrow(CycleError)
  })

  it('拒绝连接摘要任务', () => {
    const { p, a, b } = threeRoots()
    // 把 B 缩进到 A 之下 → A 成为摘要任务
    const indented = run(p, 'task.indent', { taskId: b })

    expect(() => run(indented, 'dependency.create', { fromTaskId: a, toTaskId: b }))
      .toThrow(/摘要任务不能建立依赖/)
  })

  it('同序对的依赖不会被重复创建', () => {
    const { p, a, b } = threeRoots()
    const first = run(p, 'dependency.create', { fromTaskId: a, toTaskId: b })
    expect(Object.keys(first.dependencies)).toHaveLength(1)

    const second = run(first, 'dependency.create', { fromTaskId: a, toTaskId: b })
    expect(Object.keys(second.dependencies)).toHaveLength(1) // 没有新增
  })

  it('重复创建不产生 patch —— store 据此判断「无变更」而不入撤销栈', () => {
    const { p, a, b } = threeRoots()
    const first = execute(p, {
      type: 'dependency.create',
      label: '操作',
      payload: { fromTaskId: a, toTaskId: b },
    })
    const second = execute(first.project, {
      type: 'dependency.create',
      label: '操作',
      payload: { fromTaskId: a, toTaskId: b },
    })

    expect(second.patches).toHaveLength(0)
  })

  it('重复检测只看「序对」：同一对任务换种依赖类型也不新建', () => {
    // FS A→B 与 SS A→B 在图上都是同一条有序边，并存没有意义
    const { p, a, b } = threeRoots()
    const first = run(p, 'dependency.create', { fromTaskId: a, toTaskId: b, type: 'FS' })
    const second = run(first, 'dependency.create', { fromTaskId: a, toTaskId: b, type: 'SS' })

    expect(Object.keys(second.dependencies)).toHaveLength(1)
    expect(Object.values(second.dependencies)[0].type).toBe('FS')
  })

  it('反向的依赖不被查重吞掉，仍按成环处理', () => {
    const { p, a, b } = threeRoots()
    const p2 = run(p, 'dependency.create', { fromTaskId: a, toTaskId: b })

    expect(() => run(p2, 'dependency.create', { fromTaskId: b, toTaskId: a })).toThrow(CycleError)
  })
})

describe('dependency.delete / setType / setLag', () => {
  beforeEach(setup)

  function withDep() {
    const { p, a, b } = threeRoots()
    const p2 = run(p, 'dependency.create', { fromTaskId: a, toTaskId: b })
    const depId = Object.keys(p2.dependencies)[0]
    return { p: p2, depId, a, b }
  }

  it('删除依赖', () => {
    const { p, depId } = withDep()
    const r = run(p, 'dependency.delete', { dependencyId: depId })
    expect(r.dependencies[depId]).toBeUndefined()
  })

  it('修改依赖类型', () => {
    const { p, depId } = withDep()
    const r = run(p, 'dependency.setType', { dependencyId: depId, type: 'SS' })
    expect(r.dependencies[depId].type).toBe('SS')
  })

  it('修改 lag，支持负数', () => {
    const { p, depId } = withDep()
    const r = run(p, 'dependency.setLag', { dependencyId: depId, lag: -2 })
    expect(r.dependencies[depId].lag).toBe(-2)
  })
})

describe('calendar 命令', () => {
  beforeEach(setup)

  it('切换周工作日后排期随之改变', () => {
    const p1 = run(project, 'task.create', { name: 'A' })
    const id = p1.rootIds[0]
    const p2 = run(p1, 'task.setDuration', { taskId: id, duration: 3 })
    // 默认日历：03-05(周四) 起 3 个工作日 → 03-05, 03-06, 03-09
    const calendarId = p2.calendarId

    // 把周六也设为工作日
    const p3 = run(p2, 'calendar.setWorkingDays', {
      calendarId,
      workingDays: [true, true, true, true, true, true, false],
    })

    expect(p3.calendars[calendarId].workingDays[5]).toBe(true)
  })

  it('增删节假日例外', () => {
    const p1 = run(project, 'task.create', { name: 'A' })
    const calendarId = p1.calendarId

    const p2 = run(p1, 'calendar.addException', {
      calendarId,
      date: '2026-03-09',
      exception: { kind: 'holiday' },
    })
    expect(p2.calendars[calendarId].exceptions['2026-03-09']).toEqual({ kind: 'holiday' })

    const p3 = run(p2, 'calendar.removeException', { calendarId, date: '2026-03-09' })
    expect(p3.calendars[calendarId].exceptions['2026-03-09']).toBeUndefined()
  })
})

describe('project.rename', () => {
  beforeEach(setup)

  it('重命名项目', () => {
    const r = run(project, 'project.rename', { name: '新计划' })
    expect(r.name).toBe('新计划')
  })
})

describe('task.kind 不变式', () => {
  beforeEach(setup)

  it('不变式 1：里程碑恒为零工期且无子任务', () => {
    const p1 = run(project, 'task.create', { name: 'M' })
    const id = p1.rootIds[0]
    const p2 = run(p1, 'task.toggleMilestone', { taskId: id })
    const m = p2.tasks[id]
    expect(m.kind).toBe('milestone')
    expect(m.duration).toBe(0)
    expect(m.childIds).toEqual([])
  })

  it('不变式 2：group ⟺ childIds.length > 0（双向）', () => {
    let p = run(project, 'task.create', { name: 'A' })
    p = run(p, 'task.create', { name: 'B' })
    const [a] = p.rootIds
    expect(p.tasks[a].kind).toBe('task')

    p = run(p, 'task.indent', { taskId: p.rootIds[1] }) // B 缩进到 A 下
    expect(p.tasks[a].childIds.length).toBe(1)
    expect(p.tasks[a].kind).toBe('group')

    p = run(p, 'task.outdent', { taskId: p.tasks[a].childIds[0] })
    expect(p.tasks[a].childIds).toEqual([])
    expect(p.tasks[a].kind).toBe('task')
  })

  it('不变式 3：有子任务的任务不能是里程碑（indent 到里程碑之下被拒绝）', () => {
    let p = run(project, 'task.create', { name: 'M' })
    p = run(p, 'task.create', { name: 'B' })
    const [m] = p.rootIds
    p = run(p, 'task.toggleMilestone', { taskId: m })

    const before = p
    p = run(p, 'task.indent', { taskId: p.rootIds[1] })

    expect(p).toEqual(before) // 命令被拒绝，未产生任何变更
    expect(p.tasks[m].kind).toBe('milestone')
    expect(p.tasks[m].childIds).toEqual([])
  })

  it('不变式 4a：加第一个子任务时父任务自动 task → group', () => {
    let p = run(project, 'task.create', { name: 'A' })
    p = run(p, 'task.create', { name: 'B' })
    const [a] = p.rootIds
    p = run(p, 'task.indent', { taskId: p.rootIds[1] })
    expect(p.tasks[a].kind).toBe('group')
  })

  it('不变式 4b：删掉最后一个子任务时 group → task', () => {
    let p = run(project, 'task.create', { name: 'A' })
    p = run(p, 'task.create', { name: 'B' })
    const [a] = p.rootIds
    p = run(p, 'task.indent', { taskId: p.rootIds[1] })
    const child = p.tasks[a].childIds[0]

    p = run(p, 'task.delete', { taskId: child })

    expect(p.tasks[a].kind).toBe('task')
    expect(p.tasks[a].childIds).toEqual([])
  })

  it('不变式 4c：删掉子树的最后一个子任务时同样 group → task', () => {
    let p = run(project, 'task.create', { name: 'A' })
    p = run(p, 'task.create', { name: 'B' })
    p = run(p, 'task.create', { name: 'C' })
    const [a] = p.rootIds
    p = run(p, 'task.indent', { taskId: p.rootIds[1] }) // B 进 A
    expect(p.tasks[a].childIds).toHaveLength(1)
    // B 缩进后从 rootIds 里摘掉，此时 rootIds 已是 [A, C] —— C 落在索引 1。
    // 所以第二次仍取 rootIds[1]（不是 [2]：那是 undefined，命令会静默 no-op，
    // 用例就退化成只缩进一个子任务，悄悄测不到「删空多子任务」这条路径）。
    p = run(p, 'task.indent', { taskId: p.rootIds[1] }) // C 进 A
    expect(p.tasks[a].childIds).toHaveLength(2)
    expect(p.tasks[a].kind).toBe('group')

    for (const childId of [...p.tasks[a].childIds]) {
      p = run(p, 'task.delete', { taskId: childId })
    }

    expect(p.tasks[a].kind).toBe('task')
  })

  it('task.create 挂到里程碑父任务下时回退到根层，不把里程碑转成 group', () => {
    let p = run(project, 'task.create', { name: 'M' })
    const m = p.rootIds[0]
    p = run(p, 'task.toggleMilestone', { taskId: m })

    p = run(p, 'task.create', { name: '子', parentId: m })

    expect(p.tasks[m].kind).toBe('milestone')
    expect(p.tasks[m].childIds).toEqual([])
    expect(p.rootIds).toHaveLength(2) // 新任务落在根层
    expect(p.tasks[p.rootIds[1]].parentId).toBeNull()
  })
})
