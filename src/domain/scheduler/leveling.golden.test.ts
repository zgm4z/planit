import { describe, it, expect, beforeEach } from 'vitest'
import {
  createAssignment,
  createDependency,
  createProject,
  createResource,
  createTask,
  __resetIdCounterForTests,
} from '../model/factories'
import type { ComputedSchedule, Project, Task, TaskId } from '../model/types'
import { runCpm } from './cpm'
import { addWorkdays } from '../calendar/workdays'
import { levelLeaves } from './leveling'

// 2026-03-02 是周一，默认日历周一至周五上班。
const START = '2026-03-02'

/** 测试本地助手：收集叶子（与 index.ts 的 collectLeaves 同规则；仅测试用） */
function leavesOf(project: Project): Task[] {
  const leaves: Task[] = []
  const visit = (id: TaskId): void => {
    const task = project.tasks[id]
    if (!task) return
    if (task.childIds.length === 0) {
      leaves.push(task)
      return
    }
    for (const childId of task.childIds) visit(childId)
  }
  for (const rootId of project.rootIds) visit(rootId)
  return leaves
}

/** 跑一遍 CPM，拿到 levelLeaves 需要的基线排期（scheduled* / lateStart） */
function solveCpm(project: Project): {
  leaves: Task[]
  calendar: Project['calendars'][string]
  durations: Map<TaskId, number>
  schedules: Record<TaskId, ComputedSchedule>
} {
  const leaves = leavesOf(project)
  const calendar = project.calendars[project.calendarId]
  const durations = new Map(leaves.map((task) => [task.id, task.duration]))
  const schedules = runCpm({
    tasks: leaves,
    dependencies: Object.values(project.dependencies),
    calendar,
    direction: project.schedulingDirection,
    projectStart: project.startDate,
    projectEnd: project.endDate,
  })
  return { leaves, calendar, durations, schedules }
}

/** 建一个「A、B 共用一个资源 R，C 独立」的基础场景（无依赖） */
function sharedResourceProject(): { project: Project; a: Task; b: Task; c: Task; r: string } {
  const project = createProject('平衡', START)
  const a = createTask({ name: 'A', duration: 2 }) // 03-02..03-03
  const b = createTask({ name: 'B', duration: 2 }) // 03-02..03-03
  const c = createTask({ name: 'C', duration: 6 }) // 03-02..03-09，撑出浮时
  const resource = createResource({ name: 'R' })
  for (const task of [a, b, c]) {
    project.tasks[task.id] = task
    project.rootIds.push(task.id)
  }
  project.resources[resource.id] = resource
  for (const task of [a, b]) {
    const assignment = createAssignment({ taskId: task.id, resourceId: resource.id, units: 1 })
    project.assignments[assignment.id] = assignment
  }
  return { project, a, b, c, r: resource.id }
}

// id 计数器是模块级全局、跨本文件所有用例累加，而候选排序是**字典序**比较 id
// （`a.id < b.id`）。跨过 `task_z`(35) → `task_10`(36) 后字典序反转，
// 「谁先被推」会颠倒 → 用例莫名变红（失败信息指向日期，与真实原因无关）。
// 每个用例重置，id 稳定为 task_1 / task_2，字典序即创建序。
beforeEach(() => {
  __resetIdCounterForTests()
})

describe('黄金判据 1：平衡后资源负载不超 100%', () => {
  it('A、B 共占资源 → 低 id 的 A 被推 2 天，负载降到 100%', () => {
    const { project, a, b, c } = sharedResourceProject()
    const { leaves, calendar, durations, schedules } = solveCpm(project)

    const { result, dates } = levelLeaves(project, leaves, durations, calendar, schedules)

    // 手算：A、B 都在 03-02..03-03 占 R（各 1 单元）→ 03-02、03-03 各 150%。
    // C(dur6) 把项目完成日撑到 03-09，给 A 4 个工作日浮时。
    // A 先被推（同优先级、id 更小）：+2 → A 落到 03-04..03-05。
    expect(dates[a.id].start).toBe('2026-03-04')
    expect(dates[a.id].finish).toBe('2026-03-05')
    expect(dates[b.id].start).toBe('2026-03-02') // B 不动
    expect(dates[c.id].start).toBe('2026-03-02')
    expect(result.delays[a.id]).toBe(2)
    expect(result.delays[b.id]).toBe(0)
    expect(result.unresolved).toEqual([]) // 完全平衡
  })
})

describe('黄金判据 3：优先级数值越大越优先（越晚被推）', () => {
  it('A 优先级高（5）、B 低（0）→ 推 B 而非 A', () => {
    const { project, a, b } = sharedResourceProject()
    project.tasks[a.id] = { ...a, priority: 5 }
    project.tasks[b.id] = { ...b, priority: 0 }
    const { leaves, calendar, durations, schedules } = solveCpm(project)

    const { dates } = levelLeaves(project, leaves, durations, calendar, schedules)

    // 与判据 1 相反的分布 —— 仅优先级不同 → 证明优先级真的在起作用（非恒真）
    expect(dates[b.id].start).toBe('2026-03-04')
    expect(dates[a.id].start).toBe('2026-03-02')
  })
})

describe('黄金判据 4：delay 被遵守（先按用户意愿推）', () => {
  it('A.delay = 2 → A 直接落到 03-04，无需 leveling 再推', () => {
    const { project, a, b } = sharedResourceProject()
    project.tasks[a.id] = { ...a, delay: 2 }
    const { leaves, calendar, durations, schedules } = solveCpm(project)

    const { result, dates } = levelLeaves(project, leaves, durations, calendar, schedules)

    expect(dates[a.id].start).toBe('2026-03-04')
    expect(dates[b.id].start).toBe('2026-03-02')
    expect(result.delays[a.id]).toBe(2) // delay 计入
    expect(result.unresolved).toEqual([])
  })

  it('delay 超过剩余浮时 → 夹到浮时上限（不违反依赖优先于遵守 delay）', () => {
    // 只 A、B（无 C）→ 项目完成日 03-03 → 浮时 0 → A 一步都推不动
    const project = createProject('无浮时', START)
    const a = createTask({ name: 'A', duration: 2 })
    const b = createTask({ name: 'B', duration: 2 })
    const r = createResource({ name: 'R' })
    for (const task of [a, b]) {
      project.tasks[task.id] = task
      project.rootIds.push(task.id)
    }
    project.resources[r.id] = r
    for (const task of [a, b]) {
      const assignment = createAssignment({ taskId: task.id, resourceId: r.id, units: 1 })
      project.assignments[assignment.id] = assignment
    }
    project.tasks[a.id] = { ...a, delay: 5 } // 想要的远超浮时
    const { leaves, calendar, durations, schedules } = solveCpm(project)

    const { result, dates } = levelLeaves(project, leaves, durations, calendar, schedules)

    expect(dates[a.id].start).toBe('2026-03-02') // 夹到 0，原地
    expect(result.delays[a.id]).toBe(0)
  })
})

describe('黄金判据 2：平衡后不违反任何依赖', () => {
  it('A→B 时推 A 会把 B 一并带走，且依赖仍成立', () => {
    const project = createProject('依赖', START)
    const a = createTask({ name: 'A', duration: 2 })
    const b = createTask({ name: 'B', duration: 2 })
    const d = createTask({ name: 'D', duration: 2 })
    const c = createTask({ name: 'C', duration: 8 }) // 撑浮时
    for (const task of [a, b, d, c]) {
      project.tasks[task.id] = task
      project.rootIds.push(task.id)
    }
    const dep = createDependency(a.id, b.id) // A → B (FS, lag 0)
    project.dependencies[dep.id] = dep
    const r = createResource({ name: 'R' })
    project.resources[r.id] = r
    // A 与 D 共用 R，在 03-02、03-03 相撞
    for (const task of [a, d]) {
      const assignment = createAssignment({ taskId: task.id, resourceId: r.id, units: 1 })
      project.assignments[assignment.id] = assignment
    }
    const { leaves, calendar, durations, schedules } = solveCpm(project)

    const { dates } = levelLeaves(project, leaves, durations, calendar, schedules)

    // A 被推 2 天 → 03-04..03-05；A→B 把 B 带到 03-06 起
    expect(dates[a.id].start).toBe('2026-03-04')
    expect(dates[b.id].start).toBe('2026-03-06')

    // 依赖不违反：B.start === A.finish + 1 个工作日
    expect(dates[b.id].start).toBe(addWorkdays(dates[a.id].finish, 1, calendar))
    // 且晚窗口不被越过（不推迟项目完成）
    for (const leaf of leaves) {
      expect(dates[leaf.id].start <= schedules[leaf.id].lateStart).toBe(true)
    }
  })
})

describe('黄金判据 2（不可行）：浮时耗尽时如实报告无法平衡', () => {
  it('只有 A、B 相撞且无浮时 → unresolved 非空、排期保持原文', () => {
    const project = createProject('不可行', START)
    const a = createTask({ name: 'A', duration: 2 })
    const b = createTask({ name: 'B', duration: 2 })
    const r = createResource({ name: 'R' })
    for (const task of [a, b]) {
      project.tasks[task.id] = task
      project.rootIds.push(task.id)
    }
    project.resources[r.id] = r
    for (const task of [a, b]) {
      const assignment = createAssignment({ taskId: task.id, resourceId: r.id, units: 1 })
      project.assignments[assignment.id] = assignment
    }
    const { leaves, calendar, durations, schedules } = solveCpm(project)

    const { result, dates } = levelLeaves(project, leaves, durations, calendar, schedules)

    // 无 C 撑浮时 → 推一点就会越过 lateStart → 一步不动
    expect(dates[a.id].start).toBe('2026-03-02')
    expect(dates[b.id].start).toBe('2026-03-02')
    expect(result.unresolved.map((o) => o.date)).toEqual(['2026-03-02', '2026-03-03'])
    expect(result.unresolved[0].load).toBeCloseTo(2)
  })
})

describe('黄金判据（稳定性）：无超载时 dates 与 scheduled 逐字相同', () => {
  it('把 A、B 放到不同资源 → 无超载 → 日期不变、delays 全 0', () => {
    const project = createProject('无争用', START)
    const a = createTask({ name: 'A', duration: 2 })
    const b = createTask({ name: 'B', duration: 2 })
    project.tasks[a.id] = a
    project.tasks[b.id] = b
    project.rootIds.push(a.id, b.id)
    const ra = createResource({ name: 'RA' })
    const rb = createResource({ name: 'RB' })
    project.resources[ra.id] = ra
    project.resources[rb.id] = rb
    project.assignments.a1 = createAssignment({ taskId: a.id, resourceId: ra.id, units: 1 })
    project.assignments.a2 = createAssignment({ taskId: b.id, resourceId: rb.id, units: 1 })
    const { leaves, calendar, durations, schedules } = solveCpm(project)

    const { result, dates } = levelLeaves(project, leaves, durations, calendar, schedules)

    for (const leaf of leaves) {
      expect(dates[leaf.id].start).toBe(schedules[leaf.id].scheduledStart)
      expect(dates[leaf.id].finish).toBe(schedules[leaf.id].scheduledFinish)
      expect(result.delays[leaf.id]).toBe(0)
    }
    expect(result.unresolved).toEqual([])
  })
})
