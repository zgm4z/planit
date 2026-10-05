import { describe, it, expect, beforeEach } from 'vitest'
import { createProject, createTask, __resetIdCounterForTests } from '../../domain/model/factories'
import type { Project } from '../../domain/model/types'
import type { Command } from '../../commands/types'
import { buildTaskActions } from './taskActions'

const t = ((k: string) => k) as never
let project: Project
let root1: string, root2: string, child: string

beforeEach(() => {
  __resetIdCounterForTests()
  project = createProject('测试', '2026-03-02')
  const a = createTask({ name: '一' })
  const b = createTask({ name: '二' })
  const c = createTask({ name: '子', parentId: a.id })
  project.tasks[a.id] = { ...a, childIds: [c.id], kind: 'group' }
  project.tasks[b.id] = b
  project.tasks[c.id] = c
  project.rootIds = [a.id, b.id]
  root1 = a.id; root2 = b.id; child = c.id
})

const ctx = (taskIds: string[], anchorId: string | null) => ({
  taskIds, anchorId, project,
  dispatch: (() => {}) as (c: Command) => void,
  breakCoalescing: () => {},
  beginTitleEdit: () => {},
})

describe('buildTaskActions', () => {
  it('7 项，顺序固定', () => {
    expect(buildTaskActions(t).map((a) => a.id)).toEqual([
      'new-task', 'new-child', 'indent', 'outdent', 'toggle-milestone', 'rename', 'delete-task',
    ])
  })

  it('缩进：第一条同级禁用并给原因；第二条可用', () => {
    const indent = buildTaskActions(t).find((a) => a.id === 'indent')!
    expect(indent.disabledReason(ctx([root1], root1))).toBe('menu.reason.indent')
    expect(indent.disabledReason(ctx([root2], root2))).toBeNull()
  })

  it('反缩进：顶层禁用；子任务可用', () => {
    const outdent = buildTaskActions(t).find((a) => a.id === 'outdent')!
    expect(outdent.disabledReason(ctx([root1], root1))).toBe('menu.reason.outdent')
    expect(outdent.disabledReason(ctx([child], child))).toBeNull()
  })

  it('设为里程碑：摘要任务禁用（原因 summary）；叶子可用', () => {
    const m = buildTaskActions(t).find((a) => a.id === 'toggle-milestone')!
    expect(m.disabledReason(ctx([root1], root1))).toBe('menu.reason.summary')
    expect(m.disabledReason(ctx([root2], root2))).toBeNull()
  })

  it('空选中：结构类禁用且原因是未选中', () => {
    const acts = buildTaskActions(t)
    for (const id of ['indent', 'outdent', 'toggle-milestone', 'delete-task'] as const) {
      expect(acts.find((a) => a.id === id)!.disabledReason(ctx([], null)), id).toBe('menu.reason.noSelection')
    }
  })

  it('新建子任务：无锚点或锚点是里程碑时禁用', () => {
    const nc = buildTaskActions(t).find((a) => a.id === 'new-child')!
    expect(nc.disabledReason(ctx([], null))).toBe('menu.reason.noSelection')
    const ms = { ...project, tasks: { ...project.tasks, [root2]: { ...project.tasks[root2], kind: 'milestone' as const } } }
    expect(nc.disabledReason({ ...ctx([root2], root2), project: ms })).toBe('menu.reason.summary')
  })

  it('新建任务：有锚点 → create 带 afterId；无锚点 → 追加根层', () => {
    const seen: Command[] = []
    const nc = buildTaskActions(t).find((a) => a.id === 'new-task')!
    nc.run({ ...ctx([root2], root2), dispatch: (c) => seen.push(c) })
    // 默认任务名沿用菜单栏的 toolbar.newTask（e2e 按「新建任务」过滤断言，不能是 outline.newTaskName）
    expect(seen[0]).toMatchObject({ type: 'task.create', payload: { name: 'toolbar.newTask', afterId: root2 } })
    seen.length = 0
    nc.run({ ...ctx([], null), dispatch: (c) => seen.push(c) })
    expect(seen[0]).toMatchObject({ type: 'task.create', payload: {} })
    expect((seen[0].payload as { afterId?: string }).afterId).toBeUndefined()
  })

  it('批量删除：逐条 dispatch 且共用同一个 coalesceKey', () => {
    const seen: Command[] = []
    buildTaskActions(t).find((a) => a.id === 'delete-task')!
      .run({ ...ctx([root1, root2], root1), dispatch: (c) => seen.push(c) })
    expect(seen.map((c) => c.type)).toEqual(['task.delete', 'task.delete'])
    expect(seen[0].coalesceKey).toBe(seen[1].coalesceKey)
    expect(seen[0].coalesceKey).toBe(`task.delete:${[root1, root2].sort().join(',')}`)
  })

  it('批量派发：先 breakCoalescing，再逐条 dispatch', () => {
    const order: string[] = []
    buildTaskActions(t).find((a) => a.id === 'indent')!
      .run({
        ...ctx([root2], root2),
        breakCoalescing: () => order.push('break'),
        dispatch: () => order.push('dispatch'),
      })
    expect(order).toEqual(['break', 'dispatch'])
  })

  it('重命名：run 用锚点进入标题编辑态', () => {
    const edited: string[] = []
    buildTaskActions(t).find((a) => a.id === 'rename')!
      .run({ ...ctx([root2], root2), beginTitleEdit: (taskId) => edited.push(taskId) })
    expect(edited).toEqual([root2])
  })

  it('新建子任务：run 派发 task.create 带 parentId=锚点', () => {
    const seen: Command[] = []
    buildTaskActions(t).find((a) => a.id === 'new-child')!
      .run({ ...ctx([root1], root1), dispatch: (c) => seen.push(c) })
    expect(seen[0]).toMatchObject({ type: 'task.create', payload: { parentId: root1 } })
  })

  it('设为里程碑：文案按锚点判（已里程碑→取消；否则→设为）', () => {
    const ms = { ...project, tasks: { ...project.tasks, [root2]: { ...project.tasks[root2], kind: 'milestone' as const } } }
    const labelOf = buildTaskActions(t).find((a) => a.id === 'toggle-milestone')!.label
    expect(labelOf({ ...ctx([root2], root2), project: ms })).toBe('menu.unsetMilestone')
    expect(labelOf(ctx([root2], root2))).toBe('menu.setMilestone')
  })
})
