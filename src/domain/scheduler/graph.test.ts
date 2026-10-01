import { describe, it, expect } from 'vitest'
import { createTask, createDependency } from '../model/factories'
import type { Task } from '../model/types'
import { buildGraph, CycleError } from './graph'

const t = (name: string): Task => ({ ...createTask({ name }), id: name })

describe('buildGraph', () => {
  it('无依赖时保持输入顺序', () => {
    const g = buildGraph([t('a'), t('b'), t('c')], [])
    expect(g.order).toEqual(['a', 'b', 'c'])
  })

  it('线性链 A→B→C 输出拓扑序', () => {
    const g = buildGraph([t('a'), t('b'), t('c')], [
      createDependency('a', 'b'),
      createDependency('b', 'c'),
    ])
    expect(g.order).toEqual(['a', 'b', 'c'])
  })

  it('菱形依赖中 A 在最前、D 在最后', () => {
    const g = buildGraph([t('a'), t('b'), t('c'), t('d')], [
      createDependency('a', 'b'),
      createDependency('a', 'c'),
      createDependency('b', 'd'),
      createDependency('c', 'd'),
    ])
    expect(g.order[0]).toBe('a')
    expect(g.order[3]).toBe('d')
  })

  it('入边与出边被正确索引', () => {
    const g = buildGraph([t('a'), t('b')], [createDependency('a', 'b')])
    expect(g.outgoing.get('a')).toHaveLength(1)
    expect(g.incoming.get('b')).toHaveLength(1)
    expect(g.incoming.get('a')).toEqual([])
  })

  it('忽略指向不存在任务的悬空依赖', () => {
    const g = buildGraph([t('a')], [createDependency('a', 'ghost')])
    expect(g.order).toEqual(['a'])
    expect(g.outgoing.get('a')).toEqual([])
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
})
