import { describe, it, expect, beforeEach } from 'vitest'
import { createProject, createDependency } from '../domain/model/factories'
import type { Project } from '../domain/model/types'
import { registerHandler, execute, __resetRegistryForTests } from './registry'
import { taskHandlers } from './taskCommands'
import type { CommandType } from './types'

let project: Project

function setup(): void {
  __resetRegistryForTests()
  for (const [type, handler] of Object.entries(taskHandlers)) {
    registerHandler(type as CommandType, handler)
  }
  project = createProject('测试项目', '2026-03-02')
}

function run(p: Project, type: CommandType, payload: unknown, label = '操作'): Project {
  return execute(p, { type, label, payload }).project
}

/** 取第一个根任务 id */
function firstRoot(p: Project): string {
  return p.rootIds[0]
}

describe('task.create', () => {
  beforeEach(setup)

  it('在根层创建任务并加入 rootIds', () => {
    const p = run(project, 'task.create', { name: '需求调研' })
    expect(p.rootIds).toHaveLength(1)
    const id = firstRoot(p)
    expect(p.tasks[id].name).toBe('需求调研')
    expect(p.tasks[id].parentId).toBeNull()
  })

  it('指定 parentId 时挂到父任务下', () => {
    const p1 = run(project, 'task.create', { name: '父' })
    const parentId = firstRoot(p1)
    const p2 = run(p1, 'task.create', { name: '子', parentId })

    expect(p2.tasks[parentId].childIds).toHaveLength(1)
    const childId = p2.tasks[parentId].childIds[0]
    expect(p2.tasks[childId].parentId).toBe(parentId)
    expect(p2.rootIds).toHaveLength(1)
  })
})

describe('task.rename', () => {
  beforeEach(setup)

  it('修改任务名', () => {
    const p1 = run(project, 'task.create', { name: '旧' })
    const id = firstRoot(p1)
    const p2 = run(p1, 'task.rename', { taskId: id, name: '新' })
    expect(p2.tasks[id].name).toBe('新')
  })
})

describe('task.delete', () => {
  beforeEach(setup)

  it('删除叶子任务并从 rootIds 移除', () => {
    const p1 = run(project, 'task.create', { name: 'A' })
    const id = firstRoot(p1)
    const p2 = run(p1, 'task.delete', { taskId: id })
    expect(p2.tasks[id]).toBeUndefined()
    expect(p2.rootIds).toEqual([])
  })

  it('删除父任务会连同整棵子树一起删除', () => {
    const p1 = run(project, 'task.create', { name: '父' })
    const parentId = firstRoot(p1)
    const p2 = run(p1, 'task.create', { name: '子', parentId })
    const childId = p2.tasks[parentId].childIds[0]

    const p3 = run(p2, 'task.delete', { taskId: parentId })

    expect(p3.tasks[parentId]).toBeUndefined()
    expect(p3.tasks[childId]).toBeUndefined()
    expect(p3.rootIds).toEqual([])
  })

  it('删除任务时清理与之相关的依赖', () => {
    const p1 = run(project, 'task.create', { name: 'A' })
    const a = p1.rootIds[0]
    const p2 = run(p1, 'task.create', { name: 'B' })
    const b = p2.rootIds[1]

    // 直接构造依赖，不经由命令 —— 避免测试前向引用尚未实现的 dependency.create
    const dep = createDependency(a, b)
    const p3 = { ...p2, dependencies: { ...p2.dependencies, [dep.id]: dep } }

    const p4 = run(p3, 'task.delete', { taskId: a })

    expect(p4.dependencies[dep.id]).toBeUndefined()
  })

  it('删除父任务时清理整棵子树的依赖，不留孤儿', () => {
    const p1 = run(project, 'task.create', { name: '父' })
    const parentId = firstRoot(p1)
    const p2 = run(p1, 'task.create', { name: '子', parentId })
    const childId = p2.tasks[parentId].childIds[0]
    const p3 = run(p2, 'task.create', { name: 'C' })
    const cId = p3.rootIds[1]

    // 依赖挂在【子】任务上，不在被删的父任务上
    const dep = createDependency(childId, cId)
    const p4 = { ...p3, dependencies: { ...p3.dependencies, [dep.id]: dep } }
    expect(Object.keys(p4.dependencies)).toHaveLength(1)

    const p5 = run(p4, 'task.delete', { taskId: parentId })

    expect(p5.tasks[parentId]).toBeUndefined()
    expect(p5.tasks[childId]).toBeUndefined()
    expect(p5.dependencies[dep.id]).toBeUndefined() // 关键：孤儿必须被清掉
  })
})

describe('task.setDuration', () => {
  beforeEach(setup)

  it('设置工期', () => {
    const p1 = run(project, 'task.create', { name: 'A' })
    const id = firstRoot(p1)
    const p2 = run(p1, 'task.setDuration', { taskId: id, duration: 5 })
    expect(p2.tasks[id].duration).toBe(5)
  })

  it('工期最小为 0，负数被夹到 0', () => {
    const p1 = run(project, 'task.create', { name: 'A' })
    const id = firstRoot(p1)
    const p2 = run(p1, 'task.setDuration', { taskId: id, duration: -3 })
    expect(p2.tasks[id].duration).toBe(0)
  })

  it('里程碑的工期恒为 0，设置工期无效', () => {
    const p1 = run(project, 'task.create', { name: 'A' })
    const id = firstRoot(p1)
    const p2 = run(p1, 'task.toggleMilestone', { taskId: id })
    const p3 = run(p2, 'task.setDuration', { taskId: id, duration: 5 })
    expect(p3.tasks[id].duration).toBe(0)
  })
})

describe('task.setProgress', () => {
  beforeEach(setup)

  it('设置进度并夹到 0–100', () => {
    const p1 = run(project, 'task.create', { name: 'A' })
    const id = firstRoot(p1)
    expect(run(p1, 'task.setProgress', { taskId: id, progress: 60 }).tasks[id].progress).toBe(60)
    expect(run(p1, 'task.setProgress', { taskId: id, progress: 180 }).tasks[id].progress).toBe(100)
    expect(run(p1, 'task.setProgress', { taskId: id, progress: -5 }).tasks[id].progress).toBe(0)
  })
})

describe('task.toggleMilestone', () => {
  beforeEach(setup)

  it('切换为里程碑时工期归零', () => {
    const p1 = run(project, 'task.create', { name: 'A' })
    const id = firstRoot(p1)
    const p2 = run(p1, 'task.setDuration', { taskId: id, duration: 5 })
    const p3 = run(p2, 'task.toggleMilestone', { taskId: id })

    expect(p3.tasks[id].kind).toBe('milestone')
    expect(p3.tasks[id].duration).toBe(0)
  })

  it('取消里程碑时恢复 1 个工作日', () => {
    const p1 = run(project, 'task.create', { name: 'A' })
    const id = firstRoot(p1)
    const p2 = run(p1, 'task.toggleMilestone', { taskId: id })
    const p3 = run(p2, 'task.toggleMilestone', { taskId: id })

    expect(p3.tasks[id].kind).toBe('task')
    expect(p3.tasks[id].duration).toBe(1)
  })
})

describe('task.setScheduling / task.moveTo', () => {
  beforeEach(setup)

  it('setScheduling 写入约束', () => {
    const p1 = run(project, 'task.create', { name: 'A' })
    const id = firstRoot(p1)
    const scheduling = { mode: 'constraint', type: 'startOn', date: '2026-03-16' } as const

    const p2 = run(p1, 'task.setScheduling', { taskId: id, scheduling })
    expect(p2.tasks[id].scheduling).toEqual(scheduling)
  })

  it('moveTo 等价于设置 startOn 约束', () => {
    const p1 = run(project, 'task.create', { name: 'A' })
    const id = firstRoot(p1)
    const p2 = run(p1, 'task.moveTo', { taskId: id, startDate: '2026-03-20' })

    expect(p2.tasks[id].scheduling).toEqual({
      mode: 'constraint',
      type: 'startOn',
      date: '2026-03-20',
    })
  })

  it('把约束改回 auto 让引擎重新自由排期', () => {
    const p1 = run(project, 'task.create', { name: 'A' })
    const id = firstRoot(p1)
    const p2 = run(p1, 'task.moveTo', { taskId: id, startDate: '2026-03-20' })
    const p3 = run(p2, 'task.setScheduling', { taskId: id, scheduling: { mode: 'auto' } })

    expect(p3.tasks[id].scheduling).toEqual({ mode: 'auto' })
  })
})

describe('task.resize', () => {
  beforeEach(setup)

  it('一次命令同时改变开始日期与工期，且产生 patch（一条撤销记录）', () => {
    const p1 = run(project, 'task.create', { name: 'A' })
    const id = firstRoot(p1)
    const p2 = run(p1, 'task.setDuration', { taskId: id, duration: 5 })
    expect(p2.tasks[id].duration).toBe(5)

    const result = execute(p2, {
      type: 'task.resize',
      label: '调整工期',
      payload: { taskId: id, startDate: '2026-03-04', duration: 3 },
    })

    // 两个维度在同一条命令里改掉 —— 这是「一次 Ctrl+Z 完全复原」的前提
    expect(result.project.tasks[id].duration).toBe(3)
    expect(result.project.tasks[id].scheduling).toEqual({
      mode: 'constraint',
      type: 'startOn',
      date: '2026-03-04',
    })
    // 非空 patch 才会入撤销栈；且必须只有一条记录的数据来源
    expect(result.patches.length).toBeGreaterThan(0)
  })

  it('工期被夹到至少 1 个工作日', () => {
    const p1 = run(project, 'task.create', { name: 'A' })
    const id = firstRoot(p1)
    const p2 = run(p1, 'task.resize', { taskId: id, startDate: '2026-03-04', duration: 0 })
    expect(p2.tasks[id].duration).toBe(1)
  })

  it('对摘要任务不生效，patches 为空（不入撤销栈）', () => {
    const p1 = run(project, 'task.create', { name: '父' })
    const parentId = firstRoot(p1)
    const p2 = run(p1, 'task.create', { name: '子', parentId })

    const result = execute(p2, {
      type: 'task.resize',
      label: '调整工期',
      payload: { taskId: parentId, startDate: '2026-04-01', duration: 9 },
    })

    expect(result.patches).toHaveLength(0)
    expect(result.project.tasks[parentId].scheduling).toEqual({ mode: 'auto' })
  })

  it('对里程碑不生效，patches 为空', () => {
    const p1 = run(project, 'task.create', { name: 'M' })
    const id = firstRoot(p1)
    const p2 = run(p1, 'task.toggleMilestone', { taskId: id })

    const result = execute(p2, {
      type: 'task.resize',
      label: '调整工期',
      payload: { taskId: id, startDate: '2026-04-01', duration: 5 },
    })

    expect(result.patches).toHaveLength(0)
  })
})

describe('摘要任务保护', () => {
  beforeEach(setup)

  it('对摘要任务设置工期不生效（日期由子任务汇总）', () => {
    const p1 = run(project, 'task.create', { name: '父' })
    const parentId = firstRoot(p1)
    const p2 = run(p1, 'task.create', { name: '子', parentId })
    const p3 = run(p2, 'task.setDuration', { taskId: parentId, duration: 9 })

    expect(p3.tasks[parentId].duration).toBe(1)

    // patch 级断言：store 依赖「无 patch = 未产生变更」来决定是否入撤销栈
    const result = execute(p2, {
      type: 'task.setDuration',
      label: '操作',
      payload: { taskId: parentId, duration: 9 },
    })
    expect(result.patches).toHaveLength(0)
  })

  it('对摘要任务拖拽排期不生效', () => {
    const p1 = run(project, 'task.create', { name: '父' })
    const parentId = firstRoot(p1)
    const p2 = run(p1, 'task.create', { name: '子', parentId })
    const p3 = run(p2, 'task.moveTo', { taskId: parentId, startDate: '2026-04-01' })

    expect(p3.tasks[parentId].scheduling).toEqual({ mode: 'auto' })
  })
})
