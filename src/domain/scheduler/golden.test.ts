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
// 这与既有的约束机制同构：schedulingLowerBound 只进正推、schedulingUpperBound
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

describe('黄金判据：周末项目截止日仍是硬上界', () => {
  it('forward 截止日为周六但工期延至周一时保留负浮时', () => {
    const { project, tasks } = projectWithChain([6])
    project.endDate = '2026-03-07T18:00'

    const result = solve(project)
    const schedule = result.schedules[tasks[0].id]

    expect(schedule.earlyFinish).toBe('2026-03-09')
    expect(schedule.lateFinish).toBe('2026-03-06')
    expect(schedule.totalSlack).toBe(-1)
    expect(result.conflicts).toHaveLength(1)
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

// ── Task 4：负浮时归因到 manual 后继（dependencyViolation）──────────────
//
// 归因规则（见 cpm.ts backwardPass）：负浮时所在任务的**最紧上界**若**唯一**由
// 一条指向 manual 后继的出边给出（比约束 / 资源上界严格更紧，且没有任何非 manual
// 出边打平），则该负浮时归因到该 manual 后继 —— conflictBinding。
// 反之（约束 / 资源 / auto 后继顶住）保持中性的 infeasibleSchedule，绝不误报。
describe('Task 4：负浮时归因到 manual 后继', () => {
  /** A(auto) →FS→ B：A / B 分别由 aOver / bOver 决定形态（manual 钉死 / auto + 约束） */
  function abProject(
    bOver: Partial<Task>,
    aOver: Partial<Task> = {},
  ): {
    project: Project
    a: Task
    b: Task
  } {
    const project = createProject('归因', START)
    const a = { ...createTask({ name: 'A', duration: 3 }), ...aOver } // 03-02..03-04
    const b = { ...createTask({ name: 'B', duration: 2 }), ...bOver }
    project.tasks[a.id] = a
    project.tasks[b.id] = b
    project.rootIds = [a.id, b.id]
    const dep = createDependency(a.id, b.id, 'FS', 0)
    project.dependencies[dep.id] = dep
    return { project, a, b }
  }

  it('① manual 后继把前置顶出可行窗口 → 冲突挂**前置**、kind = dependencyViolation、含 FS + 边界', () => {
    // B 钉在 03-03（A 自然完成日 03-04 之前）→ 逆推把 A 的最晚结束拉到 03-02 → A 负浮时
    const { project, a, b } = abProject({
      scheduling: { mode: 'manual', start: '2026-03-03', finish: '2026-03-03' },
    })

    const { schedules, conflicts } = solve(project)

    expect(schedules[a.id].totalSlack).toBeLessThan(0)
    const conflict = conflicts.find((c) => c.taskId === a.id)
    expect(conflict).toMatchObject({
      kind: 'dependencyViolation',
      depType: 'FS',
      lagDays: 0,
      // boundary = manual 后继的钉住日期（B.manualStart），供 UI 显示「边界 {date}」
      boundary: '2026-03-03',
      slack: schedules[a.id].totalSlack,
    })
    // 冲突挂在被顶住的前置 A 上，不在 manual 后继 B 上
    expect(conflicts.map((c) => c.taskId)).toEqual([a.id])
    expect(b.id).not.toBe(a.id)
  })

  it('② 同一项目把 B 改 auto + finishNoLaterThan 越界 → infeasibleSchedule（归因不误报）', () => {
    const { project, a } = abProject({
      scheduling: {
        mode: 'auto',
        finishConstraint: { type: 'finishNoLaterThan', date: '2026-03-03' },
      },
    })

    const { schedules, conflicts } = solve(project)

    // 前置 A 仍负浮时（被 auto 后继的早开始顶住），但成因是约束而非 manual 依赖
    expect(schedules[a.id].totalSlack).toBeLessThan(0)
    expect(conflicts.length).toBeGreaterThan(0)
    expect(conflicts.every((c) => c.kind === 'infeasibleSchedule')).toBe(true)
    expect(conflicts.some((c) => c.kind === 'dependencyViolation')).toBe(false)
  })

  it('③ manual 后继自身浮时恒 0、不产生冲突（被顶住的是它的前置）', () => {
    const { project, b } = abProject({
      scheduling: { mode: 'manual', start: '2026-03-03', finish: '2026-03-03' },
    })

    const { schedules, conflicts } = solve(project)

    expect(schedules[b.id].totalSlack).toBe(0)
    expect(conflicts.some((c) => c.taskId === b.id)).toBe(false)
  })

  it('④ manual 与同资源任务重叠 → leveling.delays 里 manual 恒 0（用户 delay 被夹 0）', () => {
    const project = createProject('平衡', START)
    const resource = createResource({ name: 'R', kind: 'staff' })
    project.resources[resource.id] = resource

    // M 钉死 03-02..03-03 且用户 delay=5；浮时恒 0 → delay 被夹成 0，平衡不得推它
    const m = {
      ...createTask({ name: 'M', duration: 2 }),
      delay: 5,
      scheduling: { mode: 'manual' as const, start: '2026-03-02', finish: '2026-03-03' },
    }
    const a = createTask({ name: 'A', duration: 2 }) // 可动、与 M 争用同一资源、同区间
    const s = createTask({ name: 'S', duration: 10 }) // 无分配，仅撑长项目完成日给 A 浮时
    for (const task of [m, a, s]) {
      project.tasks[task.id] = task
      project.rootIds.push(task.id)
    }
    for (const task of [m, a]) {
      const assignment = createAssignment({ taskId: task.id, resourceId: resource.id, units: 1 })
      project.assignments[assignment.id] = assignment
    }

    const { leveling, schedules } = solve(project)

    expect(leveling.delays[m.id]).toBe(0) // 用户 delay 被夹 0
    expect(leveling.delays[a.id]).toBeGreaterThan(0) // 真正可动的是 auto 那条
    // delays=0 不足以证明「条没动」—— 直接钉住 manual 的平衡后落点仍是钉死区间
    // （抓「delays 报 0 但 scheduled* 被 leveledForwardPass 挪走」这类假阴性）。
    expect(schedules[m.id].scheduledStart).toBe('2026-03-02')
    expect(schedules[m.id].scheduledFinish).toBe('2026-03-03')
  })

  it('⑤ backward + ALAP × manual：manual 钉死不动，被顶住的前置仍归因到该 manual 后继', () => {
    // M(manual 03-09) →FS→ A(auto 2d, alap) →FS→ B(manual 03-11)
    // 逆推把 A 的晚窗口夹到 [03-09, 03-10]（受 B 的钉住日期上界）；再由 M 的正推
    // 把 A 的最早开始顶到 03-10 → A 负浮时，且最紧上界来自 B 那条边 → dependencyViolation。
    const project = createProject('backward', START)
    project.schedulingDirection = 'backward'
    project.endDate = '2026-03-20T18:00'

    const m = {
      ...createTask({ name: 'M', duration: 1 }),
      scheduling: { mode: 'manual' as const, start: '2026-03-09', finish: '2026-03-09' },
    }
    const a = { ...createTask({ name: 'A', duration: 2 }), schedulingOrder: 'alap' as const }
    const b = {
      ...createTask({ name: 'B', duration: 1 }),
      scheduling: { mode: 'manual' as const, start: '2026-03-11', finish: '2026-03-11' },
    }
    for (const task of [m, a, b]) {
      project.tasks[task.id] = task
      project.rootIds.push(task.id)
    }
    for (const [from, to] of [
      [m.id, a.id],
      [a.id, b.id],
    ] as const) {
      const dep = createDependency(from, to, 'FS', 0)
      project.dependencies[dep.id] = dep
    }

    const { schedules, conflicts } = solve(project)

    // manual 两端都钉死不动
    expect(schedules[m.id].scheduledStart).toBe('2026-03-09')
    expect(schedules[m.id].scheduledFinish).toBe('2026-03-09')
    expect(schedules[b.id].scheduledStart).toBe('2026-03-11')
    expect(schedules[b.id].scheduledFinish).toBe('2026-03-11')

    // A 被 B 顶住 → 归因到 B 那条 manual 出边
    expect(schedules[a.id].totalSlack).toBeLessThan(0)
    expect(conflicts.find((c) => c.taskId === a.id)).toMatchObject({
      kind: 'dependencyViolation',
      depType: 'FS',
      boundary: '2026-03-11',
    })
    // 注：A 是 ALAP，但不在此断言 scheduled* === late*。leveling 会以「满足依赖的下界」
    // 重推 scheduled*，对不可行窗口（lateStart < 依赖下界）会把它落到依赖隐含日 ——
    // 这是 solve 现有行为，与本次归因无关。此处只钉住 manual 定锚 + 归因。
    expect(schedules[m.id].totalSlack).toBe(0)
    expect(schedules[b.id].totalSlack).toBe(0)
  })

  it('⑥ startNoEarlierThan 把窗口顶负 → infeasibleSchedule（下界约束顶负，无出边可归因）', () => {
    // 本用例**无依赖**（单任务）：`startNoEarlierThan` 抬高 earlyStart、endDate 压低锚，
    // lateStart 反落到下界之前 → 负浮时。它隔离的是「**下界**约束造成的负浮时」这条
    // 成因（与 ② 的「上界约束 / auto 后继」互补），此形状下 `edgeBounds` 为空，
    // 归因结构上不可能，故断言只能是 infeasibleSchedule。
    // 注：`nonEdgeBound > finish` 那道守卫的判别在 ②（有 auto 出边时仍不归因）。
    const project = createProject('约束', START)
    project.endDate = '2026-03-05T18:00'
    const a = {
      ...createTask({ name: 'A', duration: 2 }),
      scheduling: {
        mode: 'auto' as const,
        startConstraint: { type: 'startNoEarlierThan' as const, date: '2026-03-09' },
      },
    }
    project.tasks[a.id] = a
    project.rootIds = [a.id]

    const { schedules, conflicts } = solve(project)

    expect(schedules[a.id].totalSlack).toBeLessThan(0)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].kind).toBe('infeasibleSchedule')
  })

  // ── 归因的判别边界：**打平**时不归因 ──────────────────────────────────
  //
  // 这两条钉住 Task 4 归因规则里两处**故意从严**的比较，防止回归时被「放宽一格」：
  //   (a) 指向 manual 后继的最小出边若与某条**非 manual** 出边打平 → 不归因
  //       （守住 `tightest.every(manual)`，放宽成 `some` 立即变红）；
  //   (b) 约束 / 资源上界若与 manual 出边**打平** → 不归因
  //       （守住 `nonEdgeBound > finish` 的**严格**不等，放宽成 `>=` 立即变红）。
  // 二者都只改「归因标签」，负浮时本身照旧上报，故只断言 kind。

  it('⑦ manual 出边与 auto 出边打平 → 不归因（every(manual) 守卫）', () => {
    // A(auto 3d) →FS→ B(manual 钉 03-04) 且 A →FS→ C(auto 1d, finishNoLaterThan 03-04)。
    // 两条出边回推 A.lateFinish 都得 03-03（B.lateStart−1 / C.lateStart−1）→ 打平，
    // 且严格紧于约束锚（03-05）→ 进入归因分支，但有一条非 manual 打平 → 不归因。
    const project = createProject('打平-a', START)
    const a = createTask({ name: 'A', duration: 3 }) // 03-02..03-04
    const b = {
      ...createTask({ name: 'B', duration: 1 }),
      scheduling: { mode: 'manual' as const, start: '2026-03-04', finish: '2026-03-04' },
    }
    const c = {
      ...createTask({ name: 'C', duration: 1 }),
      scheduling: {
        mode: 'auto' as const,
        finishConstraint: { type: 'finishNoLaterThan' as const, date: '2026-03-04' },
      },
    }
    for (const task of [a, b, c]) {
      project.tasks[task.id] = task
      project.rootIds.push(task.id)
    }
    for (const to of [b.id, c.id]) {
      const dep = createDependency(a.id, to, 'FS', 0)
      project.dependencies[dep.id] = dep
    }

    const { schedules, conflicts } = solve(project)

    expect(schedules[a.id].totalSlack).toBeLessThan(0)
    const conflictA = conflicts.find((cf) => cf.taskId === a.id)
    expect(conflictA?.kind).toBe('infeasibleSchedule')
    expect(conflicts.some((cf) => cf.kind === 'dependencyViolation')).toBe(false)
  })

  it('⑧ finishNoLaterThan 约束与 manual 出边打平 → 不归因（严格 `>` 守卫）', () => {
    // A(auto 3d, finishNoLaterThan 03-03) →FS→ B(manual 钉 03-04)：
    // 约束上界 03-03 与 B 那条边回推的上界 03-03（B.lateStart−1）**打平** →
    // `nonEdgeBound > finish` 为假 → 不归因。
    const { project, a } = abProject(
      { scheduling: { mode: 'manual', start: '2026-03-04', finish: '2026-03-04' } },
      {
        scheduling: {
          mode: 'auto',
          finishConstraint: { type: 'finishNoLaterThan', date: '2026-03-03' },
        },
      },
    )

    const { schedules, conflicts } = solve(project)

    expect(schedules[a.id].totalSlack).toBeLessThan(0)
    const conflictA = conflicts.find((cf) => cf.taskId === a.id)
    expect(conflictA?.kind).toBe('infeasibleSchedule')
    expect(conflicts.some((cf) => cf.kind === 'dependencyViolation')).toBe(false)
  })
})

describe('黄金判据：共享 assignment 索引不改变成本与资源总计', () => {
  it('按每个资源的 units、usage 与 hourly 费率计算任务成本和总计', () => {
    const { project, tasks } = projectWithChain([2])
    const [task] = tasks
    const resourceA = {
      ...staff('A'),
      cost: { usage: 10, hourly: 2, currency: 'CNY' },
    }
    const resourceB = {
      ...staff('B'),
      cost: { usage: 5, hourly: 1, currency: 'CNY' },
    }
    project.resources[resourceA.id] = resourceA
    project.resources[resourceB.id] = resourceB
    const assignmentA = createAssignment({ taskId: task.id, resourceId: resourceA.id, units: 0.5 })
    const assignmentB = createAssignment({ taskId: task.id, resourceId: resourceB.id, units: 1 })
    project.assignments[assignmentA.id] = assignmentA
    project.assignments[assignmentB.id] = assignmentB

    const result = solve(project)

    expect(result.costs[task.id]).toEqual({ task: 15, resource: 32, total: 47 })
    expect(result.resourceTotals[resourceA.id]).toEqual({ assignments: 1, hours: 8, cost: 26 })
    expect(result.resourceTotals[resourceB.id]).toEqual({ assignments: 1, hours: 16, cost: 21 })
  })
})
