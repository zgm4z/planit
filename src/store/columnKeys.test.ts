import { describe, it, expect } from 'vitest'
import {
  COLUMN_WIDTH_MAX,
  COLUMN_WIDTH_MIN,
  TITLE_COLUMN_WIDTH_MIN,
  clampColumnWidth,
} from './columnKeys'

describe('clampColumnWidth — 列宽的唯一 clamp 实现', () => {
  it('title 的下限是 160，不是通用的 40', () => {
    expect(clampColumnWidth('title', 100)).toBe(TITLE_COLUMN_WIDTH_MIN)
    expect(clampColumnWidth('title', 160)).toBe(160)
    expect(clampColumnWidth('title', 200)).toBe(200)
  })

  it('其余列的下限是 40', () => {
    expect(clampColumnWidth('start', 10)).toBe(COLUMN_WIDTH_MIN)
    expect(clampColumnWidth('start', 40)).toBe(40)
    expect(clampColumnWidth('start', 140)).toBe(140)
  })

  it('上限对所有列一致', () => {
    expect(clampColumnWidth('title', 99999)).toBe(COLUMN_WIDTH_MAX)
    expect(clampColumnWidth('start', 99999)).toBe(COLUMN_WIDTH_MAX)
  })

  it('小数四舍五入 —— HiDPI 下拖拽会算出小数宽', () => {
    expect(clampColumnWidth('start', 123.4)).toBe(123)
    expect(clampColumnWidth('start', 123.6)).toBe(124)
  })

  it('title 的下限必须与 CSS 的 min-width 一致', () => {
    // CSS `.outlineHeaderCellSticky { min-width: 160px }`。若这里放宽，拖动
    // title 到 100 时 JS 存 100、CSS 渲染 160，每帧算出的宽度与实际渲染宽度
    // 对不上，手感表现为「拖不动」。这条断言是那个数字的守卫。
    expect(TITLE_COLUMN_WIDTH_MIN).toBe(160)
  })
})
