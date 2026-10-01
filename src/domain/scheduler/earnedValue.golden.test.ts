import { describe, it, expect } from 'vitest'
import {
  createAssignment,
  createDependency,
  createProject,
  createResource,
  createTask,
} from '../model/factories'
import type { Baseline, Project, Task } from '../model/types'
import { solve } from './index'

// 2026-03-02 是周一，默认日历周一至周五上班。
const START = '2026-03-02'

/** 一个 4 工作日任务（03-02..03-05）+ 一个一次性成本 1000 的资源 */
function projectWithBudget(): { project: Project; task: Task; resourceId: string } {
  const project = createProject('EVM', START)
  const task = createTask({ name: 'T', duration: 4 }) // 03-02..03-05
  project.tasks[task.id] = task
  project.rootIds.push(task.id)
  const resource = createResource({ name: 'R' })
  project.resources[resource.id] = resource
  // 一次性使用成本 1000 → costs[T].total = 1000 = BAC
  project.resources[resource.id] = { ...resource, cost: { usage: 1000, currency: 'CNY' } }
  const assignment = createAssignment({ taskId: task.id, resourceId: resource.id, units: 1 })
  project.assignments[assignment.id] = assignment
  return { project, task, resourceId: resource.id }
}

function withBaseline(project: Project, taskId: string, name: string, start: string, finish: string): Baseline {
  const baseline: Baseline = {
    id: 'bl_1',
    name,
    createdAt: '2026-03-01T00:00:00.000Z',
    entries: { [taskId]: { name, start, finish } },
  }
  project.baselines = [baseline]
  project.activeBaselineId = baseline.id
  return baseline
}

describe('黄金判据 4 —— 成本量纲：EV = BAC × progress/100（progress 是 0–100）', () => {
  it('BAC = 1000、progress = 40 → EV = 400（不是 40000）', () => {
    const { project, task } = projectWithBudget()
    project.tasks[task.id] = { ...task, progress: 40 }

    const result = solve(project)
    const ev = result.earnedValues[task.id]

    expect(ev.bac).toBe(1000)
    expect(ev.ev).toBe(400) // 1000 × 40/100；写错量纲会得到 40000
    // 无基线、无基准日 → PV / SV 不可算
    expect(ev.pv).toBeNull()
    expect(ev.sv).toBeNull()
  })

  it('progress 越界被夹到 [0, 100]', () => {
    const { project, task } = projectWithBudget()
    project.tasks[task.id] = { ...task, progress: 150 }
    expect(solve(project).earnedValues[task.id].ev).toBe(1000) // 夹到 100%

    const negative = projectWithBudget()
    negative.project.tasks[negative.task.id] = { ...negative.task, progress: -20 }
    expect(solve(negative.project).earnedValues[negative.task.id].ev).toBe(0)
  })
})

describe('黄金判据 4 —— 进度差异：PV 按基准日推进，SV = EV − PV（货币）', () => {
  it('基线 4 天、基准日落在第 3 天 → PV = 750、EV = 500、SV = −250', () => {
    const { project, task } = projectWithBudget()
    project.tasks[task.id] = { ...task, progress: 50 }
    // 基线快照：03-02..03-05（4 个工作日）
    withBaseline(project, task.id, 'T', '2026-03-02', '2026-03-05')
    // 基准日 = 03-04：截至该日应完成 03-02/03-03/03-04 三天 → 3/4
    project.statusDate = '2026-03-04'

    const ev = solve(project).earnedValues[task.id]
    expect(ev.pv).toBe(750) // 1000 × 3/4
    expect(ev.ev).toBe(500)
    expect(ev.sv).toBe(-250) // 落后于计划（SV 为负 = 进度滞后）
  })

  it('基准日早于基线开始 → PV = 0；晚于基线结束 → PV = BAC', () => {
    const { project, task } = projectWithBudget()
    project.tasks[task.id] = { ...task, progress: 50 }
    withBaseline(project, task.id, 'T', '2026-03-02', '2026-03-05')

    project.statusDate = '2026-02-20'
    expect(solve(project).earnedValues[task.id].pv).toBe(0)

    project.statusDate = '2026-04-01'
    expect(solve(project).earnedValues[task.id].pv).toBe(1000)
  })

  it('缺基准日 → PV / SV 为 null（**不是 0**，见计划偏差 4）', () => {
    const { project, task } = projectWithBudget()
    project.tasks[task.id] = { ...task, progress: 50 }
    withBaseline(project, task.id, 'T', '2026-03-02', '2026-03-05')
    // 不设 statusDate

    const ev = solve(project).earnedValues[task.id]
    expect(ev.pv).toBeNull()
    expect(ev.sv).toBeNull()
    expect(ev.ev).toBe(500) // EV 与 BAC 不依赖基准日，照常可算
    expect(ev.bac).toBe(1000)
  })

  it('缺活动基线 → PV / SV 为 null（即便有基准日）', () => {
    const { project, task } = projectWithBudget()
    project.statusDate = '2026-03-04'
    const ev = solve(project).earnedValues[task.id]
    expect(ev.pv).toBeNull()
    expect(ev.sv).toBeNull()
  })
})

describe('黄金判据 1 —— 差异列是**工作日**数（正数 = 延后）', () => {
  it('工期 4 → 6：finishVariance = 2 个工作日，startVariance = 0', () => {
    const { project, task } = projectWithBudget()
    withBaseline(project, task.id, 'T', '2026-03-02', '2026-03-05') // 03-05 = 周四

    // 当前：工期改成 6 → 03-02..03-09（03-07/08 是周末）
    project.tasks[task.id] = { ...task, duration: 6 }

    const diff = solve(project).baselineDiffs[task.id]
    expect(diff.baselineStart).toBe('2026-03-02')
    expect(diff.baselineFinish).toBe('2026-03-05')
    expect(diff.startVariance).toBe(0)
    // [03-05, 03-09) 的工作日 = 03-05、03-06 → 2（跳过 03-07/08 周末）
    expect(diff.finishVariance).toBe(2)
  })

  it('前置任务把开始推后 → startVariance 为正（工作日）', () => {
    const { project, task } = projectWithBudget()
    withBaseline(project, task.id, 'T', '2026-03-02', '2026-03-05')

    // 加一个 2 工作日的前置 P → T 从 03-04 起
    const p = createTask({ name: 'P', duration: 2 }) // 03-02..03-03
    project.tasks[p.id] = p
    project.rootIds.unshift(p.id)
    const dep = createDependency(p.id, task.id)
    project.dependencies[dep.id] = dep

    const diff = solve(project).baselineDiffs[task.id]
    expect(diff.startVariance).toBe(2) // [03-02, 03-04) → 03-02、03-03 = 2
    expect(diff.finishVariance).toBe(2) // 结束随之推后 2 个工作日
  })

  it('基线里已删除的任务被跳过（不产出 diff 键）', () => {
    const { project, task } = projectWithBudget()
    const baseline = withBaseline(project, task.id, 'T', '2026-03-02', '2026-03-05')
    // 塞一条指向不存在任务的条目（模拟「快照后任务被删」）
    baseline.entries['task_gone'] = { name: '已删', start: '2026-03-02', finish: '2026-03-05' }

    const result = solve(project)
    expect(result.baselineDiffs[task.id]).toBeDefined()
    expect(result.baselineDiffs['task_gone']).toBeUndefined()
    // 但基线里的条目本身**仍在**（不级联删除 —— spec §1.2）
    expect(project.baselines[0].entries['task_gone']).toBeDefined()
  })

  it('无活动基线 → baselineDiffs 为空表', () => {
    const { project } = projectWithBudget()
    expect(solve(project).baselineDiffs).toEqual({})
  })
})

describe('摘要与里程碑', () => {
  it('摘要任务：EVM 为子任务之和；基线差异为空（快照只含叶子）', () => {
    const project = createProject('摘要', START)
    const parent = createTask({ name: '阶段', duration: 1 })
    const child = createTask({ name: '子', duration: 2, parentId: parent.id })
    project.tasks[parent.id] = { ...parent, childIds: [child.id] }
    project.tasks[child.id] = { ...child, progress: 50 }
    project.rootIds.push(parent.id)

    const resource = createResource({ name: 'R' })
    project.resources[resource.id] = { ...resource, cost: { usage: 800, currency: 'CNY' } }
    const assignment = createAssignment({ taskId: child.id, resourceId: resource.id, units: 1 })
    project.assignments[assignment.id] = assignment
    withBaseline(project, child.id, '子', '2026-03-02', '2026-03-03')

    const result = solve(project)
    expect(result.earnedValues[child.id].bac).toBe(800)
    expect(result.earnedValues[child.id].ev).toBe(400)
    expect(result.earnedValues[parent.id].bac).toBe(800) // 汇总
    expect(result.earnedValues[parent.id].ev).toBe(400) // 汇总
    // 基线快照只含叶子 → 摘要行没有差异（列渲染空白，与 duration/progress 对摘要的惯例一致）
    expect(result.baselineDiffs[parent.id]).toBeUndefined()
  })

  it('里程碑（零工期）：PV 在基准日 ≥ 基线日时为 BAC，早期为 0', () => {
    const project = createProject('里程碑', START)
    const milestone = createTask({ name: 'M', kind: 'milestone' })
    project.tasks[milestone.id] = milestone
    project.rootIds.push(milestone.id)
    const resource = createResource({ name: 'R' })
    project.resources[resource.id] = { ...resource, cost: { usage: 500, currency: 'CNY' } }
    project.assignments.a1 = createAssignment({ taskId: milestone.id, resourceId: resource.id, units: 1 })
    withBaseline(project, milestone.id, 'M', '2026-03-02', '2026-03-02')

    project.statusDate = '2026-02-20'
    expect(solve(project).earnedValues[milestone.id].pv).toBe(0)
    project.statusDate = '2026-03-02'
    expect(solve(project).earnedValues[milestone.id].pv).toBe(500)
  })
})
