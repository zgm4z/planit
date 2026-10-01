import { describe, it, expect } from 'vitest'
import { createProject, createTask, createResource, createAssignment } from '../model/factories'
import type { Project } from '../model/types'
import { assignmentUnits, sumUnits } from '../model/units'
import { effectiveDuration, taskEffort, resourceBounds } from './effort'

function project(): Project {
  return createProject('资源测试', '2026-03-02')
}

/** 把一个任务挂到根层 */
function addTask(p: Project, task: ReturnType<typeof createTask>): string {
  p.tasks[task.id] = task
  p.rootIds.push(task.id)
  return task.id
}

describe('assignmentUnits / sumUnits', () => {
  it('单条分配 = availability × units × efficiency', () => {
    const staff = { ...createResource({ name: '张三' }), availability: 0.5, efficiency: 2 }
    const assignment = createAssignment({ taskId: 't', resourceId: staff.id, units: 0.5 })
    expect(assignmentUnits(staff, assignment)).toBeCloseTo(0.5 * 0.5 * 2)
  })

  it('efficiency 缺省按 1；Σunits 是全部匹配分配之和', () => {
    const p = project()
    const t = addTask(p, createTask({ name: 'T' }))
    const a = createResource({ name: 'A' }) // availability 1, 无 efficiency
    const b = { ...createResource({ name: 'B' }), availability: 0.5 }
    p.resources[a.id] = a
    p.resources[b.id] = b
    const asg1 = createAssignment({ taskId: t, resourceId: a.id, units: 1 })
    const asg2 = createAssignment({ taskId: t, resourceId: b.id, units: 1 })
    p.assignments[asg1.id] = asg1
    p.assignments[asg2.id] = asg2

    expect(sumUnits(p, t)).toBeCloseTo(1 + 0.5)
  })

  it('指向不存在资源的悬空分配被忽略；无分配时为 0', () => {
    const p = project()
    const t = addTask(p, createTask({ name: 'T' }))
    const ghost = createAssignment({ taskId: t, resourceId: 'ghost', units: 1 })
    p.assignments[ghost.id] = ghost
    expect(sumUnits(p, t)).toBe(0)
  })
})

describe('effectiveDuration（反解）', () => {
  it('fixedEffort：ceil(effort / Σunits)，不是 round', () => {
    const t = createTask({ name: 'T', effortMode: 'fixedEffort', effort: 5 })
    expect(effectiveDuration(t, 1)).toBe(5)
    expect(effectiveDuration(t, 2)).toBe(3) // ceil(2.5)
  })

  it('fixedEffort 的 Σunits 为 0 时无法反解，退回 duration', () => {
    const t = { ...createTask({ name: 'T', duration: 4, effortMode: 'fixedEffort' }), effort: 5 }
    expect(effectiveDuration(t, 0)).toBe(4)
  })

  it('fixedDuration：工期就是 task.duration，与 Σunits 无关', () => {
    const t = createTask({ name: 'T', duration: 3 })
    expect(effectiveDuration(t, 1)).toBe(3)
    expect(effectiveDuration(t, 5)).toBe(3)
  })

  it('里程碑恒为 0', () => {
    const t = createTask({ name: 'M', kind: 'milestone' })
    expect(effectiveDuration(t, 4)).toBe(0)
  })
})

describe('taskEffort（正解）', () => {
  it('fixedDuration：effort = Σunits × 工期', () => {
    const t = createTask({ name: 'T', duration: 4 })
    expect(taskEffort(t, 2, 4)).toBe(8)
  })

  it('fixedEffort：取输入的 effort，不用 Σunits × 工期', () => {
    const t = createTask({ name: 'T', duration: 1, effortMode: 'fixedEffort', effort: 5 })
    expect(taskEffort(t, 2, 3)).toBe(5) // ceil(5/2)=3，但投入仍是 5
  })
})

describe('resourceBounds（可用期 → 排期边界）', () => {
  it('availableFrom 取最大、availableUntil 取最小（多资源取交集）', () => {
    const p = project()
    const t = addTask(p, createTask({ name: 'T' }))
    const a = { ...createResource({ name: 'A' }), availableFrom: '2026-03-05' }
    const b = { ...createResource({ name: 'B' }), availableFrom: '2026-03-10', availableUntil: '2026-04-01' }
    const c = { ...createResource({ name: 'C' }), availableUntil: '2026-03-20' }
    for (const r of [a, b, c]) p.resources[r.id] = r
    for (const r of [a, b, c]) {
      const asg = createAssignment({ taskId: t, resourceId: r.id })
      p.assignments[asg.id] = asg
    }

    const bounds = resourceBounds(p, t)
    expect(bounds.earliestStart).toBe('2026-03-10') // max(03-05, 03-10)
    expect(bounds.latestFinish).toBe('2026-03-20') // min(04-01, 03-20)
  })

  it('无受约束资源时返回空对象（不受限）', () => {
    const p = project()
    const t = addTask(p, createTask({ name: 'T' }))
    const r = createResource({ name: 'A' })
    p.resources[r.id] = r
    const asg = createAssignment({ taskId: t, resourceId: r.id })
    p.assignments[asg.id] = asg
    expect(resourceBounds(p, t)).toEqual({})
  })
})
