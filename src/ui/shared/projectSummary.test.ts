import { describe, it, expect } from 'vitest'
import { createDependency, createProject, createTask } from '../../domain/model/factories'
import { solve } from '../../domain/scheduler'
import { computeProjectSummary } from './projectSummary'

function projectWithChain() {
  const project = createProject('测试', '2026-03-02')
  const a = createTask({ name: 'A', duration: 3 })
  const b = createTask({ name: 'B', duration: 2 })
  project.tasks[a.id] = a
  project.tasks[b.id] = b
  project.rootIds = [a.id, b.id]
  const dep = createDependency(a.id, b.id)
  project.dependencies[dep.id] = dep
  return project
}

describe('computeProjectSummary', () => {
  it('跨度取叶子排期的最早开始 → 最晚结束，工作日含首尾', () => {
    const project = projectWithChain()
    // A: 03-02..03-04，B: 03-05..03-06 → 跨度 03-02..03-06 = 5 个工作日
    expect(computeProjectSummary(project, solve(project).schedules)).toEqual({
      start: '2026-03-02',
      finish: '2026-03-06',
      totalWorkdays: 5,
      taskCount: 2,
    })
  })

  it('只统计叶子任务（摘要任务不重复计数）', () => {
    const project = projectWithChain()
    const parent = createTask({ name: '阶段' })
    project.tasks[parent.id] = parent
    parent.childIds = [project.rootIds[0]]
    project.tasks[project.rootIds[0]].parentId = parent.id
    project.rootIds = [parent.id, project.rootIds[1]]

    const summary = computeProjectSummary(project, solve(project).schedules)!
    expect(summary.start).toBe('2026-03-02')
    expect(summary.finish).toBe('2026-03-06')
    // taskCount 数全部任务（含摘要）
    expect(summary.taskCount).toBe(3)
  })

  it('没有任何叶子排期时返回 null', () => {
    const empty = createProject('空', '2026-03-02')
    expect(computeProjectSummary(empty, {})).toBeNull()
  })
})
