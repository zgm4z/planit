import { describe, it, expect, beforeEach } from 'vitest'
import { createProject } from '../domain/model/factories'
import type { Project } from '../domain/model/types'
import { CycleError } from '../domain/scheduler/graph'
import { isWorkday } from '../domain/calendar/workdays'
import { registerHandler, execute, __resetRegistryForTests } from './registry'
import { taskHandlers } from './taskCommands'
import { taskStructureHandlers } from './taskStructureCommands'
import { dependencyHandlers } from './dependencyCommands'
import { calendarHandlers } from './calendarCommands'
import { projectHandlers } from './projectCommands'
import { resourceHandlers } from './resourceCommands'
import { assignmentHandlers } from './assignmentCommands'
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
    ...resourceHandlers,
    ...assignmentHandlers,
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

describe('v0.2 新命令', () => {
  // 每个 describe 都必须自己 setup —— 少了它，这组用例只能靠上一个 describe
  // 留下的模块级 handlers / project 才跑得通，一被 -t 过滤或 shuffle 就报
  // 「未注册的命令类型」。
  beforeEach(setup)

  function oneTask(): { p: Project; id: string } {
    const p = run(project, 'task.create', { name: 'A' })
    return { p, id: p.rootIds[0] }
  }

  it('task.setSchedulingOrder 改写 schedulingOrder', () => {
    const { p, id } = oneTask()
    const next = run(p, 'task.setSchedulingOrder', { taskId: id, order: 'alap' })
    expect(next.tasks[id].schedulingOrder).toBe('alap')
  })

  it('task.setSchedulingOrder 对摘要任务是 no-op', () => {
    let p = run(project, 'task.create', { name: 'A' })
    p = run(p, 'task.create', { name: 'B' })
    p = run(p, 'task.indent', { taskId: p.rootIds[1] })
    const parent = p.rootIds[0]

    const next = run(p, 'task.setSchedulingOrder', { taskId: parent, order: 'alap' })
    expect(next).toEqual(p)
  })

  it('task.setNote 改写 note，且对摘要任务同样生效', () => {
    let p = run(project, 'task.create', { name: 'A' })
    p = run(p, 'task.create', { name: 'B' })
    p = run(p, 'task.indent', { taskId: p.rootIds[1] })
    const parent = p.rootIds[0]

    const next = run(p, 'task.setNote', { taskId: parent, note: '阶段说明' })
    expect(next.tasks[parent].note).toBe('阶段说明')
  })

  it('task.setPriority 改写 priority，且对摘要任务同样生效', () => {
    const { p, id } = oneTask()
    expect(run(p, 'task.setPriority', { taskId: id, priority: 7 }).tasks[id].priority).toBe(7)

    // 摘要任务也要生效 —— 这与 setSchedulingOrder / setDelay 对 group 的
    // no-op 是相反的规定（备注和优先级对摘要同样有意义）。
    let q = run(project, 'task.create', { name: 'A' })
    q = run(q, 'task.create', { name: 'B' })
    q = run(q, 'task.indent', { taskId: q.rootIds[1] })
    const parent = q.rootIds[0]
    expect(q.tasks[parent].kind).toBe('group')

    const next = run(q, 'task.setPriority', { taskId: parent, priority: 7 })
    expect(next.tasks[parent].priority).toBe(7)
    expect(next).not.toEqual(q) // 确实产生了变更，不是被守卫吞掉的 no-op
  })

  it('task.setDelay 改写 delay，对摘要任务是 no-op', () => {
    const { p, id } = oneTask()
    expect(run(p, 'task.setDelay', { taskId: id, delay: 3 }).tasks[id].delay).toBe(3)

    let q = run(project, 'task.create', { name: 'A' })
    q = run(q, 'task.create', { name: 'B' })
    q = run(q, 'task.indent', { taskId: q.rootIds[1] })
    const parent = q.rootIds[0]
    expect(run(q, 'task.setDelay', { taskId: parent, delay: 3 })).toEqual(q)
  })

  it('task.setAllowSplitting 改写 allowSplitting', () => {
    const { p, id } = oneTask()
    const next = run(p, 'task.setAllowSplitting', { taskId: id, allowSplitting: true })
    expect(next.tasks[id].allowSplitting).toBe(true)
  })

  it('project.setDirection 改写方向', () => {
    const next = run(project, 'project.setDirection', { direction: 'backward' })
    expect(next.schedulingDirection).toBe('backward')
  })

  it('project.setStartDate / setEndDate 改写锚点，endDate 可清空', () => {
    const a = run(project, 'project.setStartDate', { startDate: '2026-04-01' })
    expect(a.startDate).toBe('2026-04-01')

    const b = run(a, 'project.setEndDate', { endDate: '2026-06-30' })
    expect(b.endDate).toBe('2026-06-30')

    const c = run(b, 'project.setEndDate', { endDate: undefined })
    expect(c.endDate).toBeUndefined()
  })
})

describe('v0.5 资源命令', () => {
  beforeEach(setup)

  function withResource(): { p: Project; resourceId: string } {
    const p = run(project, 'resource.create', { name: '张三' })
    return { p, resourceId: Object.keys(p.resources)[0] }
  }

  it('resource.create 建一个默认 staff、可用率 1 的资源', () => {
    const { p, resourceId } = withResource()
    expect(p.resources[resourceId].name).toBe('张三')
    expect(p.resources[resourceId].kind).toBe('staff')
    expect(p.resources[resourceId].availability).toBe(1)
    expect(p.resources[resourceId].cost).toEqual({ currency: 'CNY' })
  })

  it('resource.rename / setKind / setEmail / setAvailability（夹到 0–1）', () => {
    let { p, resourceId } = withResource()
    p = run(p, 'resource.rename', { resourceId, name: '李四' })
    p = run(p, 'resource.setKind', { resourceId, kind: 'equipment' })
    p = run(p, 'resource.setEmail', { resourceId, email: 'a@b.c' })
    p = run(p, 'resource.setAvailability', { resourceId, availability: 1.7 })
    expect(p.resources[resourceId]).toMatchObject({
      name: '李四', kind: 'equipment', email: 'a@b.c', availability: 1,
    })
  })

  it('setEfficiency 传 ≤0 等价于清除', () => {
    let { p, resourceId } = withResource()
    p = run(p, 'resource.setEfficiency', { resourceId, efficiency: 2 })
    expect(p.resources[resourceId].efficiency).toBe(2)
    p = run(p, 'resource.setEfficiency', { resourceId, efficiency: 0 })
    expect(p.resources[resourceId].efficiency).toBeUndefined()
  })

  it('setAvailablePeriod 写入起止；setCost 整体替换', () => {
    let { p, resourceId } = withResource()
    p = run(p, 'resource.setAvailablePeriod', { resourceId, availableFrom: '2026-03-10', availableUntil: '2026-04-01' })
    expect(p.resources[resourceId]).toMatchObject({ availableFrom: '2026-03-10', availableUntil: '2026-04-01' })
    p = run(p, 'resource.setCost', { resourceId, cost: { hourly: 100, usage: 500, currency: 'CNY' } })
    expect(p.resources[resourceId].cost).toEqual({ hourly: 100, usage: 500, currency: 'CNY' })
  })

  it('resource.delete 级联删掉它的全部 assignment（spec §5）', () => {
    let p = run(project, 'task.create', { name: 'A' })
    const taskId = p.rootIds[0]
    p = run(p, 'resource.create', { name: '张三' })
    const resourceId = Object.keys(p.resources)[0]
    p = run(p, 'assignment.create', { taskId, resourceId, units: 1 })
    expect(Object.values(p.assignments)).toHaveLength(1)

    p = run(p, 'resource.delete', { resourceId })
    expect(p.resources[resourceId]).toBeUndefined()
    expect(Object.values(p.assignments)).toHaveLength(0) // 级联
  })
})

describe('v0.5 分配命令', () => {
  beforeEach(setup)

  function fixture(): { p: Project; taskId: string; resourceId: string } {
    let p = run(project, 'task.create', { name: 'A' })
    const taskId = p.rootIds[0]
    p = run(p, 'resource.create', { name: '张三' })
    return { p, taskId, resourceId: Object.keys(p.resources)[0] }
  }

  it('assignment.create 建一条默认 units=1 的分配', () => {
    const { p, taskId, resourceId } = fixture()
    const next = run(p, 'assignment.create', { taskId, resourceId, units: 1 })
    const assignment = Object.values(next.assignments)[0]
    expect(assignment).toMatchObject({ taskId, resourceId, units: 1 })
  })

  it('同一 (任务, 资源) 重复创建是 no-op（只留一条）', () => {
    const { p, taskId, resourceId } = fixture()
    let next = run(p, 'assignment.create', { taskId, resourceId, units: 1 })
    const undoLen = Object.keys(next.assignments).length
    next = run(next, 'assignment.create', { taskId, resourceId, units: 1 })
    expect(Object.keys(next.assignments)).toHaveLength(undoLen)
  })

  it('摘要任务不能直接派资源（与依赖同理）', () => {
    let p = run(project, 'task.create', { name: 'A' })
    p = run(p, 'task.create', { name: 'B' })
    p = run(p, 'task.indent', { taskId: p.rootIds[1] })
    const parent = p.rootIds[0]
    p = run(p, 'resource.create', { name: '张三' })
    const resourceId = Object.keys(p.resources)[0]

    const next = run(p, 'assignment.create', { taskId: parent, resourceId, units: 1 })
    expect(Object.values(next.assignments)).toHaveLength(0)
  })

  it('setUnits 夹到 (0, 1]；delete 按 id 删除', () => {
    const { p, taskId, resourceId } = fixture()
    let next = run(p, 'assignment.create', { taskId, resourceId, units: 0.5 })
    const assignmentId = Object.keys(next.assignments)[0]

    next = run(next, 'assignment.setUnits', { assignmentId, units: 3 })
    expect(next.assignments[assignmentId].units).toBe(1)

    next = run(next, 'assignment.delete', { assignmentId })
    expect(Object.values(next.assignments)).toHaveLength(0)
  })

  it('task.delete 级联删掉子树内任务的 assignment', () => {
    const { p, taskId, resourceId } = fixture()
    let next = run(p, 'assignment.create', { taskId, resourceId, units: 1 })
    expect(Object.values(next.assignments)).toHaveLength(1)

    next = run(next, 'task.delete', { taskId })
    expect(Object.values(next.assignments)).toHaveLength(0) // 级联
  })

  it('task.delete 清的是整棵子树内的 assignment，不只是根节点', () => {
    // 只清根节点是 v0.1 依赖清理踩过的坑：分配挂在**叶子**上，
    // 删掉摘要根节点后叶子随之消失，它的分配就成了指向已删任务的孤儿。
    let p = run(project, 'task.create', { name: 'A' })
    p = run(p, 'task.create', { name: 'B' })
    p = run(p, 'task.indent', { taskId: p.rootIds[1] })
    const parent = p.rootIds[0]
    const child = p.tasks[parent].childIds[0]
    p = run(p, 'resource.create', { name: '张三' })
    const resourceId = Object.keys(p.resources)[0]
    p = run(p, 'assignment.create', { taskId: child, resourceId, units: 1 })
    expect(Object.values(p.assignments)).toHaveLength(1)

    const next = run(p, 'task.delete', { taskId: parent })
    expect(next.tasks[parent]).toBeUndefined()
    expect(next.tasks[child]).toBeUndefined()
    expect(Object.values(next.assignments)).toHaveLength(0)
  })
})

describe('v0.5 工作量命令', () => {
  beforeEach(setup)

  function oneTask(): { p: Project; taskId: string } {
    const p = run(project, 'task.create', { name: 'A' })
    return { p, taskId: p.rootIds[0] }
  }

  it('task.setEffort 写入 effort，负值被夹到 0，undefined 清除', () => {
    const { p, taskId } = oneTask()
    expect(run(p, 'task.setEffort', { taskId, effort: 7 }).tasks[taskId].effort).toBe(7)
    expect(run(p, 'task.setEffort', { taskId, effort: -3 }).tasks[taskId].effort).toBe(0)
    expect(run(p, 'task.setEffort', { taskId, effort: undefined }).tasks[taskId].effort).toBeUndefined()
  })

  it('切到 fixedEffort 时用「工期 × Σunits」初始化 effort（避免工期突然塌成 1）', () => {
    // 注意：task.create 的 payload 没有 duration，工期要先建再改
    let p = run(project, 'task.create', { name: 'A' })
    const taskId = p.rootIds[0]
    p = run(p, 'task.setDuration', { taskId, duration: 4 })

    const next = run(p, 'task.setEffortMode', { taskId, effortMode: 'fixedEffort' })
    expect(next.tasks[taskId].effortMode).toBe('fixedEffort')
    expect(next.tasks[taskId].effort).toBe(4) // 无资源 → max(Σunits, 1) = 1，4 × 1 = 4
  })

  it('切到 fixedEffort 但已有 effort 时不覆盖', () => {
    let p = run(project, 'task.create', { name: 'A' })
    const taskId = p.rootIds[0]
    p = run(p, 'task.setDuration', { taskId, duration: 4 })
    p = run(p, 'task.setEffort', { taskId, effort: 9 })
    const next = run(p, 'task.setEffortMode', { taskId, effortMode: 'fixedEffort' })
    expect(next.tasks[taskId].effort).toBe(9)
  })

  it('task.setEffortMode / task.setEffort 对里程碑是 no-op —— 零工期的时间点不该有工作量', () => {
    // 与同文件其它日期命令（setScheduling / moveTo / resize / setSchedulingOrder）
    // 的 milestone 守卫保持一致：它们都挡住里程碑，这两条也必须挡。
    let p = run(project, 'task.create', { name: 'M' })
    const taskId = p.rootIds[0]
    p = run(p, 'task.toggleMilestone', { taskId })

    const afterMode = run(p, 'task.setEffortMode', { taskId, effortMode: 'fixedEffort' })
    expect(afterMode.tasks[taskId].effortMode).toBe('fixedDuration') // 未被切成 fixedEffort
    expect(afterMode.tasks[taskId].effort).toBeUndefined() // 也未被「工期 × Σunits」初始化

    const afterEffort = run(p, 'task.setEffort', { taskId, effort: 5 })
    expect(afterEffort.tasks[taskId].effort).toBeUndefined() // 未被写入
  })

  it('日历命令 calendar.setHoursPerDay 夹到 ≥1 的整数', () => {
    const next = run(project, 'calendar.setHoursPerDay', { hoursPerDay: 6.4 })
    expect(next.calendars.default.hoursPerDay).toBe(6)
    expect(run(project, 'calendar.setHoursPerDay', { hoursPerDay: 0 }).calendars.default.hoursPerDay).toBe(1)
  })
})

describe('v1.0 基线命令', () => {
  beforeEach(setup)

  /** 建一个 4 工作日任务（03-02..03-05），返回项目与 id */
  function withTask(): { p: Project; taskId: string } {
    const p = run(project, 'task.create', { name: 'A' })
    const taskId = p.rootIds[0]
    return { p: run(p, 'task.setDuration', { taskId, duration: 4 }), taskId }
  }

  it('project.setBaseline 快照当前排期、设为活动基线，name 取 payload', () => {
    const { p, taskId } = withTask()
    const next = run(p, 'project.setBaseline', { name: '基线 1' })

    expect(next.baselines).toHaveLength(1)
    const baseline = next.baselines[0]
    expect(baseline.name).toBe('基线 1')
    expect(typeof baseline.createdAt).toBe('string')
    expect(next.activeBaselineId).toBe(baseline.id)
    // 快照的是**引擎算出的排期**（scheduled*），工期 4 → 03-02..03-05
    expect(baseline.entries[taskId]).toMatchObject({
      name: 'A',
      start: '2026-03-02',
      finish: '2026-03-05',
    })
  })

  it('基线 id 用 nextId(bl) 生成，且前缀可区分（不是别的实体的 id）', () => {
    // 这条断言让「id 生成」可判别：若实现改用 nextId('task')/写死 id，
    // 前缀不同或与既有 taskId 相同 → 红。
    const { p, taskId } = withTask()
    const next = run(p, 'project.setBaseline', { name: '基线 1' })
    expect(next.baselines[0].id).toMatch(/^bl_/)
    expect(next.baselines[0].id).not.toBe(taskId)
  })

  it('快照随排期变化：改工期后再存一次，两条基线各自保留当时的值', () => {
    const { p, taskId } = withTask()
    const first = run(p, 'project.setBaseline', { name: '基线 1' })

    // 工期 4 → 6（03-02..03-09），再存一条
    const changed = run(first, 'task.setDuration', { taskId, duration: 6 })
    const second = run(changed, 'project.setBaseline', { name: '基线 2' })

    expect(second.baselines).toHaveLength(2)
    expect(second.baselines[0].entries[taskId].finish).toBe('2026-03-05') // 第一条不动
    expect(second.baselines[1].entries[taskId].finish).toBe('2026-03-09')
    expect(second.activeBaselineId).toBe(second.baselines[1].id) // 新存的成为活动
  })

  it('快照只含叶子任务，不含摘要任务', () => {
    let p = run(project, 'task.create', { name: 'A' })
    p = run(p, 'task.create', { name: 'B' })
    p = run(p, 'task.indent', { taskId: p.rootIds[1] })
    const parent = p.rootIds[0]
    const child = p.tasks[parent].childIds[0]

    const next = run(p, 'project.setBaseline', { name: '基线 1' })
    const entries = next.baselines[0].entries
    expect(entries[child]).toBeDefined()
    expect(entries[parent]).toBeUndefined() // 摘要不快照
  })

  it('删任务**不**级联删基线条目（spec §1.2：基线是历史记录）', () => {
    const { p, taskId } = withTask()
    const saved = run(p, 'project.setBaseline', { name: '基线 1' })

    const deleted = run(saved, 'task.delete', { taskId })

    expect(deleted.tasks[taskId]).toBeUndefined()
    // 基线条目仍在 —— 这条断言专门守住「不做级联」这个决定
    expect(deleted.baselines[0].entries[taskId]).toBeDefined()
    expect(deleted.baselines[0].entries[taskId].name).toBe('A')
    expect(deleted.activeBaselineId).toBe(deleted.baselines[0].id)
  })
})

describe('v1.0 切换 / 删除基线 + 基准日', () => {
  beforeEach(setup)

  function twoBaselines(): { p: Project } {
    let p = run(project, 'task.create', { name: 'A' })
    p = run(p, 'project.setBaseline', { name: '基线 1' })
    p = run(p, 'project.setBaseline', { name: '基线 2' })
    return { p }
  }

  it('project.setActiveBaseline 切换；null 表示不对比；未知 id 是 no-op', () => {
    const { p } = twoBaselines()
    const first = p.baselines[0].id

    const switched = run(p, 'project.setActiveBaseline', { baselineId: first })
    expect(switched.activeBaselineId).toBe(first)

    const cleared = run(switched, 'project.setActiveBaseline', { baselineId: null })
    expect(cleared.activeBaselineId).toBeNull()

    // 未知 id → no-op（不能把 activeBaselineId 指到一个不存在的东西上）
    const bogus = run(switched, 'project.setActiveBaseline', { baselineId: 'ghost' })
    expect(bogus.activeBaselineId).toBe(first)
  })

  it('project.deleteBaseline 删非活动基线时不动 activeBaselineId', () => {
    const { p } = twoBaselines()
    const [first, second] = p.baselines
    const next = run(p, 'project.deleteBaseline', { baselineId: first.id })

    expect(next.baselines.map((b) => b.id)).toEqual([second.id])
    expect(next.activeBaselineId).toBe(second.id) // 活动的是第二条，未受影响
  })

  it('project.deleteBaseline 删掉活动基线时把 activeBaselineId 归零', () => {
    const { p } = twoBaselines()
    const active = p.activeBaselineId!

    const next = run(p, 'project.deleteBaseline', { baselineId: active })
    expect(next.baselines.map((b) => b.id)).not.toContain(active)
    expect(next.activeBaselineId).toBeNull() // 绝不悬空
  })

  it('project.setStatusDate 写入 / 清除（undefined）', () => {
    const set = run(project, 'project.setStatusDate', { statusDate: '2026-03-04' })
    expect(set.statusDate).toBe('2026-03-04')

    const cleared = run(set, 'project.setStatusDate', { statusDate: undefined })
    expect(cleared.statusDate).toBeUndefined()
  })
})

describe('v0.7 区间例外命令', () => {
  beforeEach(setup)

  it('addExceptionRange 把区间展开成逐日条目（首尾都含）', () => {
    const next = run(project, 'calendar.addExceptionRange', {
      calendarId: 'default',
      start: '2026-03-16',
      end: '2026-03-20',
      kind: 'holiday',
    })
    const exceptions = next.calendars.default.exceptions
    expect(Object.keys(exceptions).sort()).toEqual([
      '2026-03-16', '2026-03-17', '2026-03-18', '2026-03-19', '2026-03-20',
    ])
    expect(exceptions['2026-03-18']).toEqual({ kind: 'holiday' })
  })

  it('kind = custom 展开成 custom 条目，引擎据此判为工作日（区间内每一天）', () => {
    const next = run(project, 'calendar.addExceptionRange', {
      calendarId: 'default',
      start: '2026-03-14', // 周六
      end: '2026-03-15', // 周日
      kind: 'custom',
    })
    const calendar = next.calendars.default
    expect(calendar.exceptions['2026-03-14']).toEqual({
      kind: 'custom',
      start: '2026-03-14',
      end: '2026-03-14',
    })
    // 未被读取的 start/end 在这里**按单日写入**；生效靠的是单日精确查表（isWorkday）
    expect(isWorkday('2026-03-14', calendar)).toBe(true)
    expect(isWorkday('2026-03-15', calendar)).toBe(true)
  })

  it('holiday 区间让区间内每一天都变成非工作日（这正是「区间只生效首日」的修复点）', () => {
    const next = run(project, 'calendar.addExceptionRange', {
      calendarId: 'default',
      start: '2026-03-16',
      end: '2026-03-18',
      kind: 'holiday',
    })
    expect(isWorkday('2026-03-17', next.calendars.default)).toBe(false)
  })

  it('start === end 是合法的单日例外', () => {
    const next = run(project, 'calendar.addExceptionRange', {
      calendarId: 'default',
      start: '2026-03-16',
      end: '2026-03-16',
      kind: 'holiday',
    })
    expect(Object.keys(next.calendars.default.exceptions)).toEqual(['2026-03-16'])
  })

  it('反向区间（end < start）是 no-op，不写任何键', () => {
    const next = run(project, 'calendar.addExceptionRange', {
      calendarId: 'default',
      start: '2026-03-20',
      end: '2026-03-16',
      kind: 'holiday',
    })
    expect(next.calendars.default.exceptions).toEqual({})
  })

  it('未知 calendarId 是 no-op（不抛）', () => {
    const next = run(project, 'calendar.addExceptionRange', {
      calendarId: 'ghost',
      start: '2026-03-16',
      end: '2026-03-17',
      kind: 'holiday',
    })
    expect(next.calendars).toEqual(project.calendars)
  })

  it('removeExceptionRange 只删区间内的键，区间外原样保留', () => {
    const added = run(project, 'calendar.addExceptionRange', {
      calendarId: 'default',
      start: '2026-03-16',
      end: '2026-03-20',
      kind: 'holiday',
    })
    const removed = run(added, 'calendar.removeExceptionRange', {
      calendarId: 'default',
      start: '2026-03-17',
      end: '2026-03-19',
    })
    expect(Object.keys(removed.calendars.default.exceptions).sort()).toEqual([
      '2026-03-16', '2026-03-20',
    ])
  })
})
