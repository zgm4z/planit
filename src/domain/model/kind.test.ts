import { describe, it, expect } from 'vitest'
import { deriveKind } from './kind'

describe('deriveKind', () => {
  it('有子任务即 group —— 即便标了里程碑', () => {
    expect(deriveKind({ childIds: ['a'], isMilestone: true })).toBe('group')
    expect(deriveKind({ childIds: ['a'], isMilestone: false })).toBe('group')
    expect(deriveKind({ childIds: ['a'] })).toBe('group')
  })

  it('无子任务时看 isMilestone', () => {
    expect(deriveKind({ childIds: [], isMilestone: true })).toBe('milestone')
    expect(deriveKind({ childIds: [], isMilestone: false })).toBe('task')
    expect(deriveKind({ childIds: [] })).toBe('task')
  })

  it('是不变式 2 的实现：结果永远满足 group ⟺ 有子任务', () => {
    for (const childIds of [[], ['a'], ['a', 'b']]) {
      for (const isMilestone of [true, false, undefined]) {
        const kind = deriveKind({ childIds, isMilestone })
        expect(kind === 'group').toBe(childIds.length > 0)
      }
    }
  })
})
