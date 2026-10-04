import { describe, it, expect } from 'vitest'
import { extendRange, resolveClickSelection, selectionFingerprint, selectionRange, toggleId } from './selectionRange'

const order = ['a', 'b', 'c', 'd', 'e']
const none = { ctrlKey: false, metaKey: false, shiftKey: false }

describe('selectionRange', () => {
  it('取 order 中的闭区间（与端点先后无关）', () => {
    expect(selectionRange(order, 'b', 'd')).toEqual(['b', 'c', 'd'])
    expect(selectionRange(order, 'd', 'b')).toEqual(['b', 'c', 'd'])
    expect(selectionRange(order, 'c', 'c')).toEqual(['c'])
  })

  it('端点在 order 里缺失 → 空数组（折叠后旧端点失效时不误选）', () => {
    expect(selectionRange(order, 'x', 'c')).toEqual([])
    expect(selectionRange(['a', 'c'], 'a', 'c')).toEqual(['a', 'c'])
  })
})

describe('toggleId', () => {
  it('保序增 / 删', () => {
    expect(toggleId(['a', 'c'], 'b')).toEqual(['a', 'c', 'b'])
    expect(toggleId(['a', 'b', 'c'], 'b')).toEqual(['a', 'c'])
  })
})

describe('resolveClickSelection', () => {
  it('普通点击 → 收敛为单选', () => {
    expect(resolveClickSelection(order, ['a', 'b'], 'b', 'd', none)).toEqual({ ids: ['d'], anchor: 'd' })
  })

  it('Ctrl/Cmd 点击 → 切换该行，锚点跟随：加入时锚点=被点项', () => {
    expect(resolveClickSelection(order, ['a'], 'a', 'c', { ctrlKey: true, metaKey: false, shiftKey: false }))
      .toEqual({ ids: ['a', 'c'], anchor: 'c' })
    expect(resolveClickSelection(order, ['a'], 'a', 'c', { ctrlKey: false, metaKey: true, shiftKey: false }))
      .toEqual({ ids: ['a', 'c'], anchor: 'c' })
  })

  it('Ctrl 点击移除非锚点 → 锚点不变', () => {
    expect(resolveClickSelection(order, ['a', 'b'], 'a', 'b', { ctrlKey: true, metaKey: false, shiftKey: false }))
      .toEqual({ ids: ['a'], anchor: 'a' })
  })

  it('Ctrl 点击移除锚点 → 锚点落到剩余集合的末元素；清空 → null', () => {
    expect(resolveClickSelection(order, ['a', 'b'], 'a', 'a', { ctrlKey: true, metaKey: false, shiftKey: false }))
      .toEqual({ ids: ['b'], anchor: 'b' })
    expect(resolveClickSelection(order, ['a'], 'a', 'a', { ctrlKey: true, metaKey: false, shiftKey: false }))
      .toEqual({ ids: [], anchor: null })
  })

  it('Shift 选一段后再 Ctrl 移除中间的非锚点 → 锚点仍是原锚点（不被末元素顶替）', () => {
    // 先 Shift a→d：范围 [a,b,c,d]，锚点 a
    const shifted = resolveClickSelection(order, [], 'a', 'd', { ctrlKey: false, metaKey: false, shiftKey: true })
    expect(shifted).toEqual({ ids: ['a', 'b', 'c', 'd'], anchor: 'a' })

    // 再 Ctrl 点 c（中间的非锚点项）→ 只移除 c，锚点必须仍是 a（此前会错成末元素 d）
    expect(
      resolveClickSelection(order, shifted.ids, shifted.anchor, 'c', {
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
      }),
    ).toEqual({ ids: ['a', 'b', 'd'], anchor: 'a' })
  })

  it('Shift 点击 → 以锚点为起点选范围；锚点保留', () => {
    expect(resolveClickSelection(order, ['a', 'b'], 'a', 'd', { ctrlKey: false, metaKey: false, shiftKey: true }))
      .toEqual({ ids: ['a', 'b', 'c', 'd'], anchor: 'a' })
  })

  it('Shift 点击但无锚点 → 退化成普通点击', () => {
    expect(resolveClickSelection(order, [], null, 'c', { ctrlKey: false, metaKey: false, shiftKey: true }))
      .toEqual({ ids: ['c'], anchor: 'c' })
  })
})

describe('extendRange', () => {
  it('从锚点向下 / 向上扩一格', () => {
    expect(extendRange(order, 'b', ['b'], 1)).toEqual(['b', 'c'])
    expect(extendRange(order, 'b', ['b'], -1)).toEqual(['a', 'b'])
  })

  it('以当前焦点（离锚点最远的一端）为起点继续扩', () => {
    expect(extendRange(order, 'b', ['b', 'c'], 1)).toEqual(['b', 'c', 'd'])
    expect(extendRange(order, 'd', ['c', 'd'], -1)).toEqual(['b', 'c', 'd'])
  })

  it('到边界后不再越界', () => {
    expect(extendRange(order, 'a', ['a'], -1)).toEqual(['a'])
    expect(extendRange(order, 'e', ['e'], 1)).toEqual(['e'])
  })
})

describe('selectionFingerprint', () => {
  it('与输入顺序无关（排序后连接）—— 批量动作才能塌成同一条撤销记录', () => {
    expect(selectionFingerprint(['b', 'a', 'c'])).toBe('a,b,c')
    expect(selectionFingerprint(['c', 'b', 'a'])).toBe('a,b,c')
    expect(selectionFingerprint([])).toBe('')
  })
})
