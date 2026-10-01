import { describe, it, expect } from 'vitest'
import { groupExceptions } from './groupExceptions'

describe('groupExceptions', () => {
  it('空表 → 空数组', () => {
    expect(groupExceptions({})).toEqual([])
  })

  it('连续同 kind 的逐日条目合并成一个区间', () => {
    expect(
      groupExceptions({
        '2026-03-16': { kind: 'holiday' },
        '2026-03-17': { kind: 'holiday' },
        '2026-03-18': { kind: 'holiday' },
      }),
    ).toEqual([{ start: '2026-03-16', end: '2026-03-18', kind: 'holiday' }])
  })

  it('不连续的两段拆成两条', () => {
    expect(
      groupExceptions({
        '2026-03-16': { kind: 'holiday' },
        '2026-03-20': { kind: 'holiday' },
      }),
    ).toEqual([
      { start: '2026-03-16', end: '2026-03-16', kind: 'holiday' },
      { start: '2026-03-20', end: '2026-03-20', kind: 'holiday' },
    ])
  })

  it('相邻但 kind 不同 → 拆开（不能把假日和工作日并成一段）', () => {
    expect(
      groupExceptions({
        '2026-03-16': { kind: 'holiday' },
        '2026-03-17': { kind: 'custom', start: '2026-03-17', end: '2026-03-17' },
      }),
    ).toEqual([
      { start: '2026-03-16', end: '2026-03-16', kind: 'holiday' },
      { start: '2026-03-17', end: '2026-03-17', kind: 'custom' },
    ])
  })

  it('与插入顺序无关（按日期排序）', () => {
    expect(
      groupExceptions({
        '2026-03-17': { kind: 'holiday' },
        '2026-03-16': { kind: 'holiday' },
      }),
    ).toEqual([{ start: '2026-03-16', end: '2026-03-17', kind: 'holiday' }])
  })
})
