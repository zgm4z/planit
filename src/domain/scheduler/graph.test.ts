import { describe, it, expect } from 'vitest'
import { createTask, createDependency } from '../model/factories'
import type { Dependency, Task } from '../model/types'
import { buildGraph, CycleError, type TaskGraph } from './graph'

const t = (name: string): Task => ({ ...createTask({ name }), id: name })

// 图现在是下标化的 CSR（见 graph.ts）。测试用下面两个小助手把下标换回可读的 id
// —— 断言的**语义**（拓扑序、邻接、悬空忽略、环路）与改造前完全一致，只是换了一层表示。
function orderIds(g: TaskGraph, tasks: readonly Task[]): string[] {
  return g.order.map((i) => tasks[i].id)
}
function outDeps(g: TaskGraph, tasks: readonly Task[], id: string): Dependency[] {
  const i = tasks.findIndex((task) => task.id === id)
  const out: Dependency[] = []
  for (let e = g.outStart[i]; e < g.outStart[i + 1]; e += 1) out.push(g.outDep[e])
  return out
}
function inDeps(g: TaskGraph, tasks: readonly Task[], id: string): Dependency[] {
  const i = tasks.findIndex((task) => task.id === id)
  const out: Dependency[] = []
  for (let e = g.inStart[i]; e < g.inStart[i + 1]; e += 1) out.push(g.inDep[e])
  return out
}

describe('buildGraph', () => {
  it('无依赖时保持输入顺序', () => {
    const tasks = [t('a'), t('b'), t('c')]
    const g = buildGraph(tasks, [])
    expect(orderIds(g, tasks)).toEqual(['a', 'b', 'c'])
  })

  it('线性链 A→B→C 输出拓扑序', () => {
    const tasks = [t('a'), t('b'), t('c')]
    const g = buildGraph(tasks, [createDependency('a', 'b'), createDependency('b', 'c')])
    expect(orderIds(g, tasks)).toEqual(['a', 'b', 'c'])
  })

  it('菱形依赖中 A 在最前、D 在最后', () => {
    const tasks = [t('a'), t('b'), t('c'), t('d')]
    const g = buildGraph(tasks, [
      createDependency('a', 'b'),
      createDependency('a', 'c'),
      createDependency('b', 'd'),
      createDependency('c', 'd'),
    ])
    expect(tasks[g.order[0]].id).toBe('a')
    expect(tasks[g.order[3]].id).toBe('d')
  })

  it('入边与出边被正确索引', () => {
    const tasks = [t('a'), t('b')]
    const g = buildGraph(tasks, [createDependency('a', 'b')])
    expect(outDeps(g, tasks, 'a')).toHaveLength(1)
    expect(inDeps(g, tasks, 'b')).toHaveLength(1)
    expect(inDeps(g, tasks, 'a')).toEqual([])
  })

  it('忽略指向不存在任务的悬空依赖', () => {
    const tasks = [t('a')]
    const g = buildGraph(tasks, [createDependency('a', 'ghost')])
    expect(orderIds(g, tasks)).toEqual(['a'])
    expect(outDeps(g, tasks, 'a')).toEqual([])
  })

  it('自环抛出 CycleError，环路为 [a, a]', () => {
    try {
      buildGraph([t('a')], [createDependency('a', 'a')])
      throw new Error('应当抛出 CycleError')
    } catch (e) {
      expect(e).toBeInstanceOf(CycleError)
      expect((e as CycleError).cycle).toEqual(['a', 'a'])
    }
  })

  it('三元环 A→B→C→A 抛出并给出完整环路', () => {
    try {
      buildGraph([t('a'), t('b'), t('c')], [
        createDependency('a', 'b'),
        createDependency('b', 'c'),
        createDependency('c', 'a'),
      ])
      throw new Error('应当抛出 CycleError')
    } catch (e) {
      expect(e).toBeInstanceOf(CycleError)
      expect((e as CycleError).cycle).toEqual(['a', 'b', 'c', 'a'])
    }
  })

  it('忽略 fromTaskId 不存在于任务列表的悬空依赖', () => {
    const tasks = [t('a')]
    const g = buildGraph(tasks, [createDependency('ghost', 'a')])
    expect(orderIds(g, tasks)).toEqual(['a'])
    expect(inDeps(g, tasks, 'a')).toEqual([])
  })

  it('环路只包含环上的节点，不含通往环的前缀路径', () => {
    // s → t → u → v → t：s 通向环，但 s 本身不在环上
    try {
      buildGraph([t('s'), t('t'), t('u'), t('v')], [
        createDependency('s', 't'),
        createDependency('t', 'u'),
        createDependency('u', 'v'),
        createDependency('v', 't'),
      ])
      throw new Error('应当抛出 CycleError')
    } catch (e) {
      expect(e).toBeInstanceOf(CycleError)
      expect((e as CycleError).cycle).toEqual(['t', 'u', 'v', 't'])
    }
  })
})
