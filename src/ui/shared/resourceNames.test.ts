import { describe, it, expect } from 'vitest'
import {
  createAssignment,
  createProject,
  createResource,
  createTask,
  __resetIdCounterForTests,
} from '../../domain/model/factories'
import type { Project } from '../../domain/model/types'
import { resourceNamesByTask, taskResourceNames } from './resourceNames'

/**
 * 夹具：资源**声明序** r1(张三) → r2(李四) → r3(王五)；
 * assignments 的**插入序**刻意相反（先 r3、再 r1、再 r2），用来区分两种顺序。
 * t2 无任何分配；t3 只有一条**悬空**分配（resourceId 指向不存在的资源）。
 */
function fixture(): Project {
  __resetIdCounterForTests()
  const project = createProject('测试', '2026-03-02')

  const r1 = { ...createResource({ name: '张三' }), id: 'r1' }
  const r2 = { ...createResource({ name: '李四' }), id: 'r2' }
  const r3 = { ...createResource({ name: '王五' }), id: 'r3' }
  project.resources = { r1, r2, r3 }

  const t1 = { ...createTask({ name: 'T1' }), id: 't1' }
  const t2 = { ...createTask({ name: 'T2' }), id: 't2' }
  const t3 = { ...createTask({ name: 'T3' }), id: 't3' }
  project.tasks = { t1, t2, t3 }
  project.rootIds = ['t1', 't2', 't3']

  const a1 = { ...createAssignment({ taskId: 't1', resourceId: 'r3' }), id: 'a1' }
  const a2 = { ...createAssignment({ taskId: 't1', resourceId: 'r1' }), id: 'a2' }
  const a3 = { ...createAssignment({ taskId: 't1', resourceId: 'r2' }), id: 'a3' }
  const a4 = { ...createAssignment({ taskId: 't3', resourceId: 'rX' }), id: 'a4' }
  project.assignments = { a1, a2, a3, a4 }
  return project
}

describe('resourceNamesByTask', () => {
  it('名字顺序 = 资源声明序（不是 assignment 插入序）', () => {
    const names = resourceNamesByTask(fixture())
    expect(names.get('t1')).toEqual(['张三', '李四', '王五'])
  })

  it('悬空分配不产生名字', () => {
    const names = resourceNamesByTask(fixture())
    // t3 的唯一分配指向已删资源 → 视同无分配
    expect(names.has('t3')).toBe(false)
  })

  it('无任何分配的任务不进 Map', () => {
    const names = resourceNamesByTask(fixture())
    expect(names.has('t2')).toBe(false)
  })

  it('空项目 → 空 Map', () => {
    expect(resourceNamesByTask(createProject('空')).size).toBe(0)
  })
})

describe('taskResourceNames', () => {
  it('等于全量映射的取值，缺省回落空数组', () => {
    const project = fixture()
    expect(taskResourceNames(project, 't1')).toEqual(['张三', '李四', '王五'])
    expect(taskResourceNames(project, 't2')).toEqual([])
    expect(taskResourceNames(project, 't3')).toEqual([])
  })
})
