import { describe, it, expect, beforeEach } from 'vitest'
import { createProject, createTask, createResource, createAssignment, __resetIdCounterForTests } from '../../domain/model/factories'
import { buildAssignmentTree } from './assignmentGroups'

beforeEach(() => __resetIdCounterForTests())

function fixture() {
  const project = createProject('测试', '2026-03-02')
  const t1 = createTask({ name: 'T1' })
  const t2 = createTask({ name: 'T2' })
  const parent = createTask({ name: '父任务' })
  parent.kind = 'group'
  parent.childIds = [t1.id, t2.id]
  t1.parentId = parent.id
  t2.parentId = parent.id
  project.tasks = { [parent.id]: parent, [t1.id]: t1, [t2.id]: t2 }
  project.rootIds = [parent.id]

  const group = createResource({ name: '施工组' })
  group.kind = 'group'
  const alice = createResource({ name: '张三', parentId: group.id })
  const bob = createResource({ name: '李四', parentId: group.id })
  const crane = createResource({ name: '吊车' })
  project.resources = { [group.id]: group, [alice.id]: alice, [bob.id]: bob, [crane.id]: crane }

  // t1 分配给张三；t2 也分配给张三 → 张三 assignedCount = 2
  const a1 = createAssignment({ taskId: t1.id, resourceId: alice.id })
  const a2 = createAssignment({ taskId: t2.id, resourceId: alice.id })
  project.assignments = { [a1.id]: a1, [a2.id]: a2 }

  return { project, t1, t2, parent, group, alice, bob, crane }
}

describe('buildAssignmentTree', () => {
  it('顶层 group 变成可折叠组，成员是全部后代；其余顶层资源进 ungrouped', () => {
    const { project, t1, t2, group, alice, bob, crane } = fixture()
    const tree = buildAssignmentTree(project, [t1.id, t2.id])

    expect(tree.groups).toHaveLength(1)
    expect(tree.groups[0].id).toBe(group.id)
    expect(tree.groups[0].members.map((m) => m.id)).toEqual([alice.id, bob.id])
    expect(tree.ungrouped.map((m) => m.id)).toEqual([crane.id])
  })

  it('assignedCount = 该资源被多少个**选中叶子任务**分配；组头 assignedCount = Σ 成员', () => {
    const { project, t1, t2, alice, bob } = fixture()
    const tree = buildAssignmentTree(project, [t1.id, t2.id])
    expect(tree.groups[0].members.find((m) => m.id === alice.id)!.assignedCount).toBe(2)
    expect(tree.groups[0].members.find((m) => m.id === bob.id)!.assignedCount).toBe(0)
    expect(tree.groups[0].assignedCount).toBe(2)
  })

  it('只选一个任务时，assignedCount 随选中集合收缩', () => {
    const { project, t1, alice } = fixture()
    const tree = buildAssignmentTree(project, [t1.id])
    expect(tree.groups[0].members.find((m) => m.id === alice.id)!.assignedCount).toBe(1)
  })

  it('摘要任务被忽略：选中集合里只有摘要 → 所有 assignedCount 为 0', () => {
    const { project, parent, alice } = fixture()
    const tree = buildAssignmentTree(project, [parent.id])
    expect(tree.groups[0].members.find((m) => m.id === alice.id)!.assignedCount).toBe(0)
  })

  it('资源为空 → 两个桶都空', () => {
    const { project, t1 } = fixture()
    project.resources = {}
    project.assignments = {}
    expect(buildAssignmentTree(project, [t1.id])).toEqual({ groups: [], ungrouped: [] })
  })
})
