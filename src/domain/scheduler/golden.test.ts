import { describe, it, expect } from 'vitest'
import {
  createAssignment,
  createDependency,
  createProject,
  createResource,
  createTask,
} from '../model/factories'
import type { Project, Task } from '../model/types'
import { workdaysBetween } from '../calendar/workdays'
import { solve } from './index'

// 2026-03-02 是周一，默认日历周一至周五上班。
const START = '2026-03-02'

function projectWithChain(durations: number[]): { project: Project; tasks: Task[] } {
  const project = createProject('黄金测试', START)
  const tasks = durations.map((duration, index) => createTask({ name: `T${index + 1}`, duration }))
  tasks.forEach((task) => {
    project.tasks[task.id] = task
    project.rootIds.push(task.id)
  })
  for (let i = 0; i < tasks.length - 1; i += 1) {
    const dep = createDependency(tasks[i].id, tasks[i + 1].id)
    project.dependencies[dep.id] = dep
  }
  return { project, tasks }
}

function staff(name: string, over: Partial<ReturnType<typeof createResource>> = {}) {
  return { ...createResource({ name, kind: 'staff' }), ...over }
}

/** 用 DOM/实现无关的方式量工期：起止之间的工作日数 + 含起始日 */
function durationOf(project: Project, taskId: string): number {
  const schedule = solve(project).schedules[taskId]
  return workdaysBetween(schedule.earlyStart, schedule.earlyFinish, project.calendars.default) + 1
}

describe('黄金判据 1：fixedEffort 多派一人 → 工期减半（ceil）', () => {
  it('effort=5，1 人 → 5 天；2 人 → 3 天（ceil(2.5)，不是 2 也不是 2.5）', () => {
    const { project, tasks } = projectWithChain([1])
    const target = tasks[0]
    // effortMode 与 effort 是引擎的输入；duration 的初值 (1) 会被反解覆盖
    project.tasks[target.id] = { ...target, effortMode: 'fixedEffort', effort: 5 }

    const alice = staff('Alice')
    project.resources[alice.id] = alice
    const a1 = createAssignment({ taskId: target.id, resourceId: alice.id, units: 1 })
    project.assignments[a1.id] = a1

    // 1 人：ceil(5 / 1) = 5 个工作日 → 03-02 .. 03-06
    const one = solve(project)
    expect(one.efforts[target.id]).toBe(5)
    expect(one.schedules[target.id].scheduledStart).toBe('2026-03-02')
    expect(one.schedules[target.id].scheduledFinish).toBe('2026-03-06')
    expect(durationOf(project, target.id)).toBe(5)

    // +2 人：ceil(5 / 2) = 3 个工作日 → 03-02 .. 03-04
    const bob = staff('Bob')
    project.resources[bob.id] = bob
    const a2 = createAssignment({ taskId: target.id, resourceId: bob.id, units: 1 })
    project.assignments[a2.id] = a2

    const two = solve(project)
    expect(two.efforts[target.id]).toBe(5) // 投入不变
    expect(two.schedules[target.id].scheduledFinish).toBe('2026-03-04')
    expect(durationOf(project, target.id)).toBe(3)
  })
})

describe('黄金判据 2：fixedDuration 多派一人 → 工期不变、effort 翻倍', () => {
  it('duration=4，1 人 → effort 4；2 人 → effort 8，工期仍 4', () => {
    const { project, tasks } = projectWithChain([4])
    const target = tasks[0]

    const alice = staff('Alice')
    project.resources[alice.id] = alice
    const a1 = createAssignment({ taskId: target.id, resourceId: alice.id, units: 1 })
    project.assignments[a1.id] = a1

    const one = solve(project)
    expect(one.efforts[target.id]).toBe(4)
    expect(durationOf(project, target.id)).toBe(4)

    const bob = staff('Bob')
    project.resources[bob.id] = bob
    const a2 = createAssignment({ taskId: target.id, resourceId: bob.id, units: 1 })
    project.assignments[a2.id] = a2

    const two = solve(project)
    expect(two.efforts[target.id]).toBe(8) // 翻倍
    expect(durationOf(project, target.id)).toBe(4) // 工期不变
    expect(two.schedules[target.id].scheduledFinish).toBe(one.schedules[target.id].scheduledFinish)
  })
})

describe('黄金判据 3：工期取整（ceil）', () => {
  it('effort=5, Σunits=2 → 3 天', () => {
    const { project, tasks } = projectWithChain([1])
    const target = tasks[0]
    project.tasks[target.id] = { ...target, effortMode: 'fixedEffort', effort: 5 }

    for (const name of ['Alice', 'Bob']) {
      const resource = staff(name, { availability: 1 })
      project.resources[resource.id] = resource
      const assignment = createAssignment({ taskId: target.id, resourceId: resource.id, units: 1 })
      project.assignments[assignment.id] = assignment
    }

    expect(durationOf(project, target.id)).toBe(3) // ceil(2.5)
  })
})

describe('黄金判据 4：资源可用期间之外不被分配', () => {
  it('availableFrom 把任务开始推到资源入职日', () => {
    const { project, tasks } = projectWithChain([2])
    const target = tasks[0]

    const temp = staff('临时工', { availableFrom: '2026-03-10' })
    project.resources[temp.id] = temp
    const assignment = createAssignment({ taskId: target.id, resourceId: temp.id, units: 1 })
    project.assignments[assignment.id] = assignment

    const { schedules } = solve(project)
    // 控制组：无可用期时任务从 03-02 开始。有 availableFrom 后必须推到 03-10。
    expect(schedules[target.id].scheduledStart).toBe('2026-03-10')
    expect(schedules[target.id].scheduledFinish).toBe('2026-03-11')
  })

  it('availableUntil 早于任务装得下的结束日 → 浮时变负（如实报冲突）', () => {
    const { project, tasks } = projectWithChain([5])
    const target = tasks[0]

    const leaver = staff('离职者', { availableUntil: '2026-03-04' })
    project.resources[leaver.id] = leaver
    const assignment = createAssignment({ taskId: target.id, resourceId: leaver.id, units: 1 })
    project.assignments[assignment.id] = assignment

    const { schedules } = solve(project)
    // 03-02 起 5 天要到 03-06，但资源 03-04 就离职 —— 上界把 lateFinish 拉到 03-04
    expect(schedules[target.id].earlyFinish).toBe('2026-03-06')
    expect(schedules[target.id].totalSlack).toBeLessThan(0)
  })
})

describe('黄金判据 5：分配变更后下游重排正确', () => {
  it('给 T1 加一人使其工期缩短 → 后继 T2 的日期跟着提前', () => {
    const { project, tasks } = projectWithChain([1, 2])
    const [t1, t2] = tasks
    project.tasks[t1.id] = { ...t1, effortMode: 'fixedEffort', effort: 4 }

    const alice = staff('Alice')
    project.resources[alice.id] = alice
    const a1 = createAssignment({ taskId: t1.id, resourceId: alice.id, units: 1 })
    project.assignments[a1.id] = a1

    const before = solve(project)
    expect(before.schedules[t1.id].scheduledFinish).toBe('2026-03-05') // 4 天
    expect(before.schedules[t2.id].scheduledStart).toBe('2026-03-06')

    const bob = staff('Bob')
    project.resources[bob.id] = bob
    const a2 = createAssignment({ taskId: t1.id, resourceId: bob.id, units: 1 })
    project.assignments[a2.id] = a2

    const after = solve(project)
    // ceil(4 / 2) = 2 天 → T1 提前到 03-03 结束，T2 随之提前
    expect(after.schedules[t1.id].scheduledFinish).toBe('2026-03-03')
    expect(after.schedules[t2.id].scheduledStart).toBe('2026-03-04')
    expect(after.schedules[t2.id].scheduledStart < before.schedules[t2.id].scheduledStart).toBe(true)
  })
})
