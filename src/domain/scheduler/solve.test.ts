import { describe, it, expect } from 'vitest'
import { createProject, createTask, createDependency } from '../model/factories'
import type { Project } from '../model/types'
import { solve } from './index'

/** 把任务挂进项目：处理 rootIds 与父子指针的一致性 */
function addTask(project: Project, task: ReturnType<typeof createTask>, parentId: string | null = null): void {
  project.tasks[task.id] = { ...task, parentId }
  if (parentId) {
    project.tasks[parentId].childIds.push(task.id)
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
