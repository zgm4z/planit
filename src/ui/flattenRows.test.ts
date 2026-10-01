import { describe, it, expect } from 'vitest'
import { createProject, createTask } from '../domain/model/factories'
import type { Project, Task } from '../domain/model/types'
import { flattenVisibleRows } from './flattenRows'

function addTask(project: Project, task: Task, parentId: string | null = null): void {
  project.tasks[task.id] = { ...task, parentId }
  if (parentId) project.tasks[parentId].childIds.push(task.id)
  else project.rootIds.push(task.id)
}

function buildProject() {
  const project = createProject('测试', '2026-03-02')
  const parent = createTask({ name: '阶段一' })
  const c1 = createTask({ name: '子一' })
  const c2 = createTask({ name: '子二' })
  const other = createTask({ name: '独立任务' })

  addTask(project, parent)
  addTask(project, c1, parent.id)
  addTask(project, c2, parent.id)
  addTask(project, other)

  return { project, parent, c1, c2, other }
}

describe('flattenVisibleRows', () => {
  it('把树按前序展开成带层级的扁平行', () => {
    const { project, parent, c1, c2, other } = buildProject()
    const rows = flattenVisibleRows(project, new Set())

    expect(rows.map((r) => r.taskId)).toEqual([parent.id, c1.id, c2.id, other.id])
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 1, 0])
  })

  it('标记哪些行有子任务可以折叠', () => {
    const { project, parent, c1 } = buildProject()
    const byId = new Map(flattenVisibleRows(project, new Set()).map((r) => [r.taskId, r]))

    expect(byId.get(parent.id)!.hasChildren).toBe(true)
    expect(byId.get(c1.id)!.hasChildren).toBe(false)
  })

  it('折叠父任务后其子树整段消失', () => {
    const { project, parent, other } = buildProject()
    const rows = flattenVisibleRows(project, new Set([parent.id]))

    expect(rows.map((r) => r.taskId)).toEqual([parent.id, other.id])
    expect(rows[0].collapsed).toBe(true)
  })

  it('嵌套多层时深层级正确', () => {
    const { project, c1 } = buildProject()
    const grandChild = createTask({ name: '孙' })
    addTask(project, grandChild, c1.id)

    const rows = flattenVisibleRows(project, new Set())
    expect(rows.find((r) => r.taskId === grandChild.id)!.depth).toBe(2)
  })

  it('空项目返回空数组', () => {
    expect(flattenVisibleRows(createProject('空', '2026-03-02'), new Set())).toEqual([])
  })
})
