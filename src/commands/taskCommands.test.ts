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
  // task.delete 的依赖清理需要存在一条依赖。真正的 dependency.create 命令
  // 属于 Task 10，这里注册一个最小实现，让删除清理逻辑可被单独验证。
  registerHandler('dependency.create', (draft, payload: { fromTaskId: string; toTaskId: string }) => {
    const dep = createDependency(payload.fromTaskId, payload.toTaskId)
    draft.dependencies[dep.id] = dep
  })
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
    const p3 = run(p2, 'dependency.create', { fromTaskId: a, toTaskId: b })
    const depId = Object.keys(p3.dependencies)[0]

    const p4 = run(p3, 'task.delete', { taskId: a })

    expect(p4.dependencies[depId]).toBeUndefined()
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

    expect(p3.tasks[id].isMilestone).toBe(true)
    expect(p3.tasks[id].duration).toBe(0)
  })

  it('取消里程碑时恢复 1 个工作日', () => {
    const p1 = run(project, 'task.create', { name: 'A' })
    const id = firstRoot(p1)
    const p2 = run(p1, 'task.toggleMilestone', { taskId: id })
    const p3 = run(p2, 'task.toggleMilestone', { taskId: id })

    expect(p3.tasks[id].isMilestone).toBe(false)
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

describe('摘要任务保护', () => {
  beforeEach(setup)

  it('对摘要任务设置工期不生效（日期由子任务汇总）', () => {
    const p1 = run(project, 'task.create', { name: '父' })
    const parentId = firstRoot(p1)
    const p2 = run(p1, 'task.create', { name: '子', parentId })
    const p3 = run(p2, 'task.setDuration', { taskId: parentId, duration: 9 })

    expect(p3.tasks[parentId].duration).not.toBe(9)
  })

  it('对摘要任务拖拽排期不生效', () => {
    const p1 = run(project, 'task.create', { name: '父' })
    const parentId = firstRoot(p1)
    const p2 = run(p1, 'task.create', { name: '子', parentId })
    const p3 = run(p2, 'task.moveTo', { taskId: parentId, startDate: '2026-04-01' })

    expect(p3.tasks[parentId].scheduling).toEqual({ mode: 'auto' })
  })
})
