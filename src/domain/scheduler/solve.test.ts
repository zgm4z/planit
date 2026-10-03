import { describe, it, expect } from 'vitest'
import {
  createProject,
  createTask,
  createDependency,
  createAssignment,
  createResource,
} from '../model/factories'
import type { Project } from '../model/types'
import { toDateStr } from '../calendar/dateTime'
import { solve, runCpm } from './index'

/** 把任务挂进项目：处理 rootIds 与父子指针的一致性 */
function addTask(project: Project, task: ReturnType<typeof createTask>, parentId: string | null = null): void {
  project.tasks[task.id] = { ...task, parentId }
  if (parentId) {
    project.tasks[parentId].childIds.push(task.id)
    // 与命令层一致：有子任务就是 group
    project.tasks[parentId].kind = 'group'
  } else {
    project.rootIds.push(task.id)
  }
}

describe('solve', () => {
  it('在完整 Project 上端到端求解', () => {
    const project = createProject('端到端', '2026-03-02')

    const a = createTask({ name: 'A', duration: 3 })
    const b = createTask({ name: 'B', duration: 2 })
    addTask(project, a)
    addTask(project, b)
    const dep = createDependency(a.id, b.id)
    project.dependencies[dep.id] = dep

    const { schedules, conflicts } = solve(project)

    expect(schedules[a.id].earlyStart).toBe('2026-03-02')
    expect(schedules[a.id].earlyFinish).toBe('2026-03-04')
    expect(schedules[b.id].earlyStart).toBe('2026-03-05')
    expect(schedules[a.id].isCritical).toBe(true)
    expect(schedules[b.id].isCritical).toBe(true)
    expect(conflicts).toEqual([])
  })

  it('摘要任务在求解结果中被汇总出来', () => {
    const project = createProject('带摘要', '2026-03-02')

    const parent = createTask({ name: '阶段一' })
    addTask(project, parent)
    const c1 = createTask({ name: 'c1', duration: 2 })
    const c2 = createTask({ name: 'c2', duration: 3 })
    addTask(project, c1, parent.id)
    addTask(project, c2, parent.id)

    const dep = createDependency(c1.id, c2.id)
    project.dependencies[dep.id] = dep

    const { schedules } = solve(project)

    // c1: 03-02 → 03-03，c2: 03-04 → 03-06
    expect(schedules[parent.id].earlyStart).toBe('2026-03-02')
    expect(schedules[parent.id].earlyFinish).toBe('2026-03-06')
  })

  it('空项目返回空排期表', () => {
    const project = createProject('空', '2026-03-02')
    const { schedules, conflicts } = solve(project)
    expect(schedules).toEqual({})
    expect(conflicts).toEqual([])
  })
})

describe('v0.6：solve() 接入资源平衡', () => {
  function shared(): { project: Project; a: string; b: string; c: string } {
    const project = createProject('平衡集成', '2026-03-02')
    const a = createTask({ name: 'A', duration: 2 })
    const b = createTask({ name: 'B', duration: 2 })
    const c = createTask({ name: 'C', duration: 6 })
    for (const task of [a, b, c]) {
      project.tasks[task.id] = task
      project.rootIds.push(task.id)
    }
    const resource = createResource({ name: 'R' })
    project.resources[resource.id] = resource
    for (const task of [a, b]) {
      const assignment = createAssignment({ taskId: task.id, resourceId: resource.id, units: 1 })
      project.assignments[assignment.id] = assignment
    }
    return { project, a: a.id, b: b.id, c: c.id }
  }

  it('有超载时 scheduled* 被推到平衡后的日期', () => {
    const { project, a, b } = shared()
    const result = solve(project)

    expect(result.schedules[a].scheduledStart).toBe('2026-03-04') // 被推 2 天
    expect(result.schedules[b].scheduledStart).toBe('2026-03-02')
    expect(result.leveling.delays[a]).toBe(2)
    expect(result.leveling.unresolved).toEqual([])
  })

  it('leveling 不改变 early/late/slack（spec §3）', () => {
    const { project, a } = shared()
    // 对照：把同一任务里被推的 A 抠掉资源（无超载），取它的 CPM 量
    const result = solve(project)
    const schedule = result.schedules[a]

    // early 是「无平衡」的经典 CPM 输出，必须还是 03-02..03-03
    expect(schedule.earlyStart).toBe('2026-03-02')
    expect(schedule.earlyFinish).toBe('2026-03-03')
    // 被推的是 scheduled*，不是 early*
    expect(schedule.scheduledStart).not.toBe(schedule.earlyStart)
    // 有浮时（项目完成日由 C 撑到 03-09）→ slack > 0 且为 4
    expect(schedule.totalSlack).toBe(4)
  })

  it('无资源争用 → scheduled* 与 early* 相同、leveling 全 0', () => {
    const project = createProject('无争用', '2026-03-02')
    const t = createTask({ name: 'T', duration: 3 })
    project.tasks[t.id] = t
    project.rootIds.push(t.id)

    const result = solve(project)
    expect(result.schedules[t.id].scheduledStart).toBe(result.schedules[t.id].earlyStart)
    expect(result.leveling.delays[t.id]).toBe(0)
    expect(result.leveling.unresolved).toEqual([])
  })

  // 这条是「能区分」的断言：光断言 early/late 有值恒真。这里把 solve（leveled）
  // 与直接跑 CPM（未平衡）逐字段对照 —— scheduled* 必须变、其余必须一模一样。
  it('leveling 只改 scheduled*：early/late/slack 逐字段与未平衡的 CPM 完全相同', () => {
    const { project, a } = shared()
    const result = solve(project)

    // 未平衡的基准：leveling 是 solve 在 CPM 之后另加的一步，这里直接跑那一步。
    // 注意 `runCpm` 是低层原语，`CpmInput.projectStart` 契约定为 `DateStr`（不内部归一，
    // 边界 ① 在 `solve` 里）。v0.8 起 `project.startDate` 带时刻，故这里须与 solve 一样
    // 先 `toDateStr` —— 否则 `snapToWorkday` 会拿到带时刻串。
    const reference = runCpm({
      tasks: Object.values(project.tasks),
      dependencies: Object.values(project.dependencies),
      calendar: project.calendars[project.calendarId],
      direction: project.schedulingDirection,
      projectStart: toDateStr(project.startDate),
      projectEnd: project.endDate ? toDateStr(project.endDate) : undefined,
      resourceBounds: {},
    })

    const leveled = result.schedules[a]
    const base = reference[a]

    // scheduled* 真的被推了（不是恒真的「有值」断言）
    expect(leveled.scheduledStart).toBe('2026-03-04')
    expect(base.scheduledStart).toBe('2026-03-02')
    expect(leveled.scheduledStart).not.toBe(base.scheduledStart)

    // 其余 CPM 字段逐字段不变
    expect(leveled.earlyStart).toBe(base.earlyStart)
    expect(leveled.earlyFinish).toBe(base.earlyFinish)
    expect(leveled.lateStart).toBe(base.lateStart)
    expect(leveled.lateFinish).toBe(base.lateFinish)
    expect(leveled.totalSlack).toBe(base.totalSlack)
    expect(leveled.freeSlack).toBe(base.freeSlack)
    expect(leveled.isCritical).toBe(base.isCritical)
  })

  // 钉住第 ⑦ 步的**顺序**：摘要任务的 scheduled* 必须从「已 leveling 过的叶子」汇总。
  // P 是只含一个孩子 A 的摘要；A 被平衡推走后，P.scheduledStart 必须跟着走 ——
  // 若 summarizeParents 在 leveling **之前**跑，P 会停在 A 的旧值 03-02。
  it('摘要任务的 scheduled* 从已 leveling 的叶子汇总（顺序）', () => {
    const project = createProject('摘要顺序', '2026-03-02')
    const parent = createTask({ name: 'P' })
    addTask(project, parent)
    const a = createTask({ name: 'A', duration: 2 }) // priority 0 → 优先被推
    const b = createTask({ name: 'B', duration: 2 })
    b.priority = 10
    addTask(project, a, parent.id)
    addTask(project, b)
    const c = createTask({ name: 'C', duration: 6 }) // 撑起项目完成日 → 给 A/B 浮时
    addTask(project, c)

    const resource = createResource({ name: 'R' })
    project.resources[resource.id] = resource
    for (const task of [a, b]) {
      const assignment = createAssignment({ taskId: task.id, resourceId: resource.id, units: 1 })
      project.assignments[assignment.id] = assignment
    }

    const result = solve(project)

    expect(result.schedules[a.id].scheduledStart).toBe('2026-03-04') // A 被推 2 天
    expect(result.schedules[parent.id].scheduledStart).toBe('2026-03-04') // 摘要跟着走
    expect(result.schedules[parent.id].scheduledStart).toBe(
      result.schedules[a.id].scheduledStart,
    )
  })
})

describe('solve — 中性不可行冲突', () => {
  it('无依赖时资源可用期冲突不归因为 dependency', () => {
    const project = createProject('资源边界冲突', '2026-03-02')
    const task = createTask({ name: '受约束任务', duration: 2 })
    task.scheduling = {
      mode: 'auto',
      startConstraint: { type: 'startNoEarlierThan', date: '2026-03-10T09:00' },
    }
    addTask(project, task)

    const resource = {
      ...createResource({ name: '离职资源' }),
      availableUntil: '2026-03-06T18:00',
    }
    project.resources[resource.id] = resource
    const assignment = createAssignment({ taskId: task.id, resourceId: resource.id })
    project.assignments[assignment.id] = assignment

    const result = solve(project)

    expect(Object.keys(project.dependencies)).toHaveLength(0)
    expect(result.schedules[task.id].totalSlack).toBe(-3)
    expect(result.conflicts).toEqual([
      { taskId: task.id, kind: 'infeasibleSchedule', slack: -3 },
    ])
  })
})
