import { describe, it, expect, beforeEach } from 'vitest'
import { createProject, createTask, __resetIdCounterForTests } from './factories'
import { siblingIdsOf } from './tree'
import type { Project } from './types'

function seed(): { project: Project; root1: string; root2: string; child: string } {
  const project = createProject('测试', '2026-03-02')
  const root1 = createTask({ name: 'A' })
  const root2 = createTask({ name: 'B' })
  project.tasks[root1.id] = root1
  project.tasks[root2.id] = root2
  project.rootIds.push(root1.id, root2.id)

  const child = createTask({ name: 'A1', parentId: root1.id })
  project.tasks[child.id] = child
  root1.childIds.push(child.id)
  root1.kind = 'group'

  return { project, root1: root1.id, root2: root2.id, child: child.id }
}

describe('siblingIdsOf', () => {
  beforeEach(() => __resetIdCounterForTests())

  it('根层任务返回 rootIds（是树里那个数组本身，不是副本）', () => {
    const { project, root1, root2 } = seed()
    const list = siblingIdsOf(project, root1)
    expect(list).toEqual([root1, root2])
    expect(list).toBe(project.rootIds) // 身份：命令层要 splice 它
  })

  it('子任务返回其父的 childIds', () => {
    const { project, child } = seed()
    expect(siblingIdsOf(project, child)).toEqual([child])
  })

  it('任务不存在 → null', () => {
    const { project } = seed()
    expect(siblingIdsOf(project, 'ghost')).toBeNull()
  })

  it('父任务不存在（数据损坏）→ null', () => {
    const { project, child } = seed()
    project.tasks[child].parentId = 'missing-parent'
    expect(siblingIdsOf(project, child)).toBeNull()
  })
})
