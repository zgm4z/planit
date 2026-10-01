import { describe, it, expect } from 'vitest'
import type { Project, Task } from '../domain/model/types'
import { reconcileKind } from './reconcileKind'

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    name: id,
    parentId: null,
    childIds: [],
    kind: 'task',
    duration: 1,
    scheduling: { mode: 'auto' },
    progress: 0,
    effortMode: 'fixedDuration',
    ...over,
  }
}

function project(tasks: Task[]): Project {
  return { tasks: Object.fromEntries(tasks.map((t) => [t.id, t])) } as unknown as Project
}

describe('reconcileKind', () => {
  it('有子任务 → group', () => {
    const p = project([task('a'), task('b', { parentId: 'a' })])
    p.tasks.a.childIds = ['b']

    reconcileKind(p, 'a')

    expect(p.tasks.a.kind).toBe('group')
  })

  it('原本是 milestone 的任务得到子任务时，kind 变为 group（清掉 milestone 语义）', () => {
    const p = project([task('a', { kind: 'milestone', duration: 0 }), task('b')])
    p.tasks.a.childIds = ['b']

    reconcileKind(p, 'a')

    expect(p.tasks.a.kind).toBe('group')
  })

  it('childIds 清空后 group 退回 task', () => {
    const p = project([task('a', { kind: 'group' })])
    reconcileKind(p, 'a')
    expect(p.tasks.a.kind).toBe('task')
  })

  it('无子任务的普通任务不动（不会莫名其妙变成 milestone）', () => {
    const p = project([task('a')])
    reconcileKind(p, 'a')
    expect(p.tasks.a.kind).toBe('task')
  })

  it('无子任务的里程碑不动', () => {
    const p = project([task('a', { kind: 'milestone', duration: 0 })])
    reconcileKind(p, 'a')
    expect(p.tasks.a.kind).toBe('milestone')
  })

  it('任务不存在时静默返回', () => {
    const p = project([])
    expect(() => reconcileKind(p, 'ghost')).not.toThrow()
  })
})
