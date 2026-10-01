import { describe, it, expect } from 'vitest'
import { createProject, createResource, __resetIdCounterForTests } from '../../domain/model/factories'
import type { Project } from '../../domain/model/types'
import { flattenResourceRows } from './flattenResources'

/** 后端 / 前端 / 测试 三个组，各带人；再加一个顶层「设备」 */
function tree(): Project {
  __resetIdCounterForTests()
  const project = createProject('资源树', '2026-03-02')
  const backend = createResource({ name: '后端', kind: 'group' })
  const frontend = createResource({ name: '前端', kind: 'group' })
  const test = createResource({ name: '测试', kind: 'group' })
  const alice = createResource({ name: '张三', parentId: backend.id })
  const bob = createResource({ name: '李四', parentId: backend.id })
  const carol = createResource({ name: '王五', parentId: frontend.id })
  const rig = createResource({ name: '服务器', kind: 'equipment' })
  for (const r of [backend, frontend, test, alice, bob, carol, rig]) project.resources[r.id] = r
  return project
}

const idsOf = (project: Project, collapsed = new Set<string>()) =>
  flattenResourceRows(project, collapsed).map((row) => project.resources[row.resourceId].name)

describe('flattenResourceRows', () => {
  it('前序展开：组 → 它的成员，组的顺序 = 声明序', () => {
    expect(idsOf(tree())).toEqual(['后端', '张三', '李四', '前端', '王五', '测试', '服务器'])
  })

  it('深度：顶层 0，组内成员 1', () => {
    const project = tree()
    const rows = flattenResourceRows(project, new Set())
    const depth = Object.fromEntries(rows.map((r) => [project.resources[r.resourceId].name, r.depth]))
    expect(depth['后端']).toBe(0)
    expect(depth['张三']).toBe(1)
  })

  it('折叠有子资源的组 → 子树消失；无子资源的行没有折叠语义（hasChildren=false）', () => {
    const project = tree()
    const backend = Object.values(project.resources).find((r) => r.name === '后端')!
    const rows = flattenResourceRows(project, new Set([backend.id]))
    expect(rows.map((r) => project.resources[r.resourceId].name)).toEqual([
      '后端', '前端', '王五', '测试', '服务器',
    ])
    const alice = Object.values(project.resources).find((r) => r.name === '张三')!
    expect(rows.find((r) => r.resourceId === alice.id)).toBeUndefined()
  })

  it('悬空 parentId（指向不存在的资源）当根处理，不静默丢行', () => {
    const project = createProject('悬空', '2026-03-02')
    const ghost = createResource({ name: '幽灵', parentId: 'resource_gone' })
    project.resources[ghost.id] = ghost
    expect(idsOf(project)).toEqual(['幽灵'])
  })

  it('空项目 → 空数组（不抛）', () => {
    expect(flattenResourceRows(createProject('空', '2026-03-02'), new Set())).toEqual([])
  })
})
