import { describe, it, expect } from 'vitest'
import {
  createAssignment,
  createDependency,
  createProject,
  createResource,
  createTask,
} from '../model/factories'
import { sumAssignmentUnits, sumUnits } from '../model/units'
import {
  resourceBounds,
  resourceBoundsFromAssignments,
} from './effort'
import { buildScheduleContext } from './context'

describe('buildScheduleContext', () => {
  it('保留树序并仅为叶子构图，悬空依赖仍被忽略', () => {
    const project = createProject('上下文测试', '2026-03-02')
    const parent = createTask({ name: 'P' })
    const child1 = createTask({ name: 'C1', parentId: parent.id })
    const child2 = createTask({ name: 'C2', parentId: parent.id })
    const standalone = createTask({ name: 'S' })
    project.tasks[parent.id] = { ...parent, kind: 'group', childIds: [child1.id, child2.id] }
    project.tasks[child1.id] = { ...child1, parentId: parent.id }
    project.tasks[child2.id] = { ...child2, parentId: parent.id }
    project.tasks[standalone.id] = standalone
    project.rootIds = [parent.id, standalone.id]

    const dependency = createDependency(child1.id, standalone.id)
    const dangling = createDependency(child2.id, 'missing-task')
    project.dependencies[dependency.id] = dependency
    project.dependencies[dangling.id] = dangling

    const context = buildScheduleContext(project)

    expect(context.leaves.map((task) => task.id)).toEqual([
      child1.id,
      child2.id,
      standalone.id,
    ])
    // 图是下标化 CSR（见 graph.ts）：order 是 `leaves` 的下标序列，出边查 CSR。
    expect(context.graph.order.map((i) => context.leaves[i].id)).toEqual([
      child1.id,
      child2.id,
      standalone.id,
    ])
    const child2Index = context.leaves.findIndex((task) => task.id === child2.id)
    expect(context.graph.outStart[child2Index + 1] - context.graph.outStart[child2Index]).toBe(0)
  })

  it('索引多资源单位与可用期交集，忽略悬空资源分配且不改 Project', () => {
    const project = createProject('资源索引', '2026-03-02')
    const task = createTask({ name: 'C1' })
    project.tasks[task.id] = task
    project.rootIds.push(task.id)

    const resourceA = {
      ...createResource({ name: 'A' }),
      availability: 0.5,
      efficiency: 2,
      availableFrom: '2026-03-05T09:00',
      availableUntil: '2026-03-20T18:00',
    }
    const resourceB = {
      ...createResource({ name: 'B' }),
      availableFrom: '2026-03-10T09:00',
      availableUntil: '2026-03-15T18:00',
    }
    project.resources[resourceA.id] = resourceA
    project.resources[resourceB.id] = resourceB

    const assignmentA = createAssignment({ taskId: task.id, resourceId: resourceA.id, units: 0.5 })
    const assignmentB = createAssignment({ taskId: task.id, resourceId: resourceB.id, units: 0.25 })
    const dangling = createAssignment({ taskId: task.id, resourceId: 'missing-resource', units: 1 })
    project.assignments[assignmentA.id] = assignmentA
    project.assignments[assignmentB.id] = assignmentB
    project.assignments[dangling.id] = dangling

    const before = JSON.stringify(project)
    const context = buildScheduleContext(project)
    const assignments = [assignmentA, assignmentB, dangling]

    expect(sumAssignmentUnits(assignments, project.resources)).toBeCloseTo(0.75)
    expect(sumUnits(project, task.id)).toBeCloseTo(0.75)
    expect(context.unitsByTask.get(task.id)).toBeCloseTo(0.75)
    expect(context.assignmentUnitsById.get(assignmentA.id)).toBeCloseTo(0.5)
    expect(context.assignmentUnitsById.has(dangling.id)).toBe(false)
    expect(context.assignmentsByTask.get(task.id)).toEqual(assignments)
    expect(context.assignmentsByResource.get(resourceA.id)).toEqual([assignmentA])

    const expectedBounds = {
      earliestStart: '2026-03-10',
      latestFinish: '2026-03-13',
    }
    expect(
      resourceBoundsFromAssignments(assignments, project.resources, project.calendars.default),
    ).toEqual(expectedBounds)
    expect(resourceBounds(project, task.id)).toEqual(expectedBounds)
    expect(context.resourceBoundsByTask.get(task.id)).toEqual(expectedBounds)
    expect(JSON.stringify(project)).toBe(before)
  })

  it('无有效分配的叶子单位为 0 且没有资源边界', () => {
    const project = createProject('空资源索引', '2026-03-02')
    const task = createTask({ name: '空任务' })
    project.tasks[task.id] = task
    project.rootIds.push(task.id)

    const context = buildScheduleContext(project)

    expect(context.unitsByTask.get(task.id)).toBe(0)
    expect(context.resourceBoundsByTask.get(task.id) ?? {}).toEqual({})
  })
})
