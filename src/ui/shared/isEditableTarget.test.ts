import { describe, it, expect } from 'vitest'
import { isEditableTarget } from './isEditableTarget'

describe('isEditableTarget', () => {
  it('INPUT / TEXTAREA / SELECT 都算可编辑', () => {
    for (const tag of ['input', 'textarea', 'select'] as const) {
      expect(isEditableTarget(document.createElement(tag))).toBe(true)
    }
  })

  it('contenteditable 元素算可编辑', () => {
    const div = document.createElement('div')
    div.contentEditable = 'true'
    // jsdom 不同版本对 isContentEditable 的支持不一致 —— 测试以显式赋值的属性为准
    Object.defineProperty(div, 'isContentEditable', { value: true })
    expect(isEditableTarget(div)).toBe(true)
  })

  it('普通元素 / 非 HTMLElement / null 都不算可编辑', () => {
    expect(isEditableTarget(document.createElement('div'))).toBe(false)
    expect(isEditableTarget(document.createElement('button'))).toBe(false)
    expect(isEditableTarget(null)).toBe(false)
    expect(isEditableTarget(new EventTarget())).toBe(false)
  })
})
