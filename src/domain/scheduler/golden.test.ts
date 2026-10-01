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

// ── 黄金判据 4：资源可用期 ───────────────────────────────────────────
//
// 为什么可用期是「任务级上下界」、且**有意只各进一趟**（有后果的设计决定）：
//
//   availableFrom   = 任务开始的下界（最早能开始）→ 只进**正推**
//   availableUntil  = 任务结束的上界（最晚能结束）→ 只进**逆推**
//
// 这与既有的约束机制同构：constraintLowerBound 只进正推、constraintUpperBound
// 只进逆推。下界刻画最早起点、上界刻画最晚终点，各归其位。
//
// 刻意**不**把两条边界都塞进两趟 —— 那样会：
//   ① 谎报工期：正推里夹 availableUntil 会把 earlyFinish 从真实完成日提前，
//      而甘特条宽度 / 依赖连线端点 / TaskBar 几何全基于 [earlyStart, earlyFinish]，
//      一条 5 天的任务会显示成 3 天。
//   ② 反转晚窗口：逆推里夹 availableFrom 会让 lateStart 越过 lateFinish，
//      晚窗口 [lateStart, lateFinish] 失序，按它求宽度者得到负跨度。
//
// 可用期不可行时**不做调和**：让浮时变负，由 detectConflicts 产出 ConflictInfo
// （UI 三层可见），如实记录排期矛盾 —— 这正是本项目一贯立场。本 describe 里的
// 第二条是「不反转晚窗口」的防回退护栏，第三条钉住「不谎报工期」。
describe('黄金判据 4：资源可用期间之外不被分配', () => {
  it('可行：availableFrom 把任务开始推到资源入职日（scheduledStart 自然 ≥ availableFrom）', () => {
    const { project, tasks } = projectWithChain([2])
    const target = tasks[0]

    const temp = staff('临时工', { availableFrom: '2026-03-10' })
    project.resources[temp.id] = temp
    const assignment = createAssignment({ taskId: target.id, resourceId: temp.id, units: 1 })
    project.assignments[assignment.id] = assignment

    const { schedules } = solve(project)
    // 控制组：无可用期时任务从 03-02 开始。有 availableFrom 后必须推到 03-10。
    // 该场景**可行**（只引下界、不引上界），故排期不违反可用期、也不产生冲突 ——
    // 用来证明「可行时不存在静默违反」。
    expect(schedules[target.id].scheduledStart).toBe('2026-03-10')
    expect(schedules[target.id].scheduledFinish).toBe('2026-03-11')
    expect(schedules[target.id].scheduledStart >= '2026-03-10').toBe(true)
    expect(schedules[target.id].totalSlack).toBeGreaterThanOrEqual(0)
  })

  it('不可行：availableUntil 早于自然完成日 → earlyFinish 不被夹（仍是真实完成日），浮时变负如实报冲突', () => {
    const { project, tasks } = projectWithChain([5])
    const target = tasks[0]

    const leaver = staff('离职者', { availableUntil: '2026-03-04' })
    project.resources[leaver.id] = leaver
    const assignment = createAssignment({ taskId: target.id, resourceId: leaver.id, units: 1 })
    project.assignments[assignment.id] = assignment

    const { schedules } = solve(project)
    // 手算：03-02(一) 起 5 个工作日 = 03-02/03/04/05/06 → 真实完成日 03-06。
    // 不夹边界是刻意的：夹到 availableUntil(03-04) 会让这条 5 天的任务只剩
    // 03-02..03-04 共 3 天，甘特条 / 依赖端点 / TaskBar 几何全被谎报。
    expect(schedules[target.id].earlyFinish).toBe('2026-03-06')
    expect(schedules[target.id].scheduledFinish).toBe('2026-03-06')
    // 上界只在逆推里生效：lateFinish 被拉到 03-04，倒推 lateStart = 02-26，
    // 于是 totalSlack = workdaysBetween(03-02, 02-26) = -2 —— 冲突如实上报。
    expect(schedules[target.id].lateFinish).toBe('2026-03-04')
    expect(schedules[target.id].totalSlack).toBe(-2)
  })

  it('不可行：availableFrom 晚于 endDate 倒推出的开始日 → 不出现日期反转（lateStart ≤ lateFinish）', () => {
    // 护栏用例：若有人把下界 availableFrom 夹进逆推（backwardPass），lateStart
    // 会被抬到 03-10、越过 lateFinish 03-05，本用例立即变红。
    const project = createProject('可用期-逆推', START)
    project.schedulingDirection = 'backward'
    project.endDate = '2026-03-05'
    const target = createTask({ name: 'T', duration: 3 })
    project.tasks[target.id] = { ...target, schedulingOrder: 'alap' }
    project.rootIds.push(target.id)

    const temp = staff('临时工', { availableFrom: '2026-03-10' })
    project.resources[temp.id] = temp
    const assignment = createAssignment({ taskId: target.id, resourceId: temp.id, units: 1 })
    project.assignments[assignment.id] = assignment

    const { schedules } = solve(project)
    const s = schedules[target.id]
    // 手算：终点 03-05 倒推 3 个工作日 → lateFinish 03-05、lateStart 03-03（有序）。
    // availableFrom 03-10 只在正推生效 → early 链是 03-10..03-12，不会被拉进晚窗口，
    // 故晚窗口不被反转。场景不可行，冲突以负浮时如实上报（而非被静默吞掉）。
    expect(s.lateFinish).toBe('2026-03-05')
    expect(s.lateStart).toBe('2026-03-03')
    expect(s.lateStart <= s.lateFinish).toBe(true)
    expect(s.totalSlack).toBe(-5)
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
