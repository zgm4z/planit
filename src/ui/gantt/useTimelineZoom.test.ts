import { describe, it, expect } from 'vitest'
import {
  dayWidthFromDrag,
  dayWidthFromWheel,
  normalizeWheelDelta,
  scaleXFor,
  timelineOriginX,
  DRAG_ZOOM_SENSITIVITY_PX,
  WHEEL_ZOOM_SENSITIVITY,
  KEYBOARD_ZOOM_FACTOR,
} from './useTimelineZoom'

describe('dayWidthFromDrag（尺上拖拽）', () => {
  it('左拖（deltaPx<0）变宽、右拖（deltaPx>0）变窄、零位移不变', () => {
    expect(dayWidthFromDrag(32, -200)).toBeCloseTo(32 * Math.E, 6)
    expect(dayWidthFromDrag(32, 200)).toBeCloseTo(32 / Math.E, 6)
    expect(dayWidthFromDrag(32, 0)).toBe(32)
  })

  it('灵敏度是 200px ≈ ×e', () => {
    expect(DRAG_ZOOM_SENSITIVITY_PX).toBe(200)
    expect(dayWidthFromDrag(1, -DRAG_ZOOM_SENSITIVITY_PX)).toBeCloseTo(Math.E, 6)
  })

  it('可逆：以起点为基准的累计位移，拖回起点即回到起始值（不是增量累加）', () => {
    const start = 32
    const widened = dayWidthFromDrag(start, -87)
    expect(widened).toBeGreaterThan(start)
    // 累计位移口径（handleMove 用的就是这个）：deltaPx 归零（拖回起点）⇒ 精确回到起始值，不漂
    expect(dayWidthFromDrag(start, 0)).toBeCloseTo(start, 6)
    // 越过起点右拖同样距离 ≠ 回到起点 —— 起点-累计位移只认「相对起点的位移」，不是往返抵消
    expect(dayWidthFromDrag(start, 87)).toBeLessThan(start)
  })
})

describe('normalizeWheelDelta（三种 deltaMode）', () => {
  it('像素 / 行 / 页分别归一', () => {
    expect(normalizeWheelDelta({ deltaMode: 0, deltaY: 100 })).toBe(100)
    expect(normalizeWheelDelta({ deltaMode: 1, deltaY: 3 })).toBe(48)
    expect(normalizeWheelDelta({ deltaMode: 2, deltaY: 1 })).toBe(400)
  })
})

describe('dayWidthFromWheel（Ctrl/Cmd+滚轮）', () => {
  it('上滚（deltaY<0）变宽、下滚（deltaY>0）变窄、零不变', () => {
    expect(dayWidthFromWheel(32, -100)).toBeCloseTo(32 * Math.exp(0.2), 6)
    expect(dayWidthFromWheel(32, 100)).toBeCloseTo(32 * Math.exp(-0.2), 6)
    expect(dayWidthFromWheel(32, 0)).toBe(32)
    expect(WHEEL_ZOOM_SENSITIVITY).toBe(0.002)
  })
})

describe('键盘缩放因子', () => {
  it('每次 ×1.25 / ÷1.25', () => {
    expect(KEYBOARD_ZOOM_FACTOR).toBe(1.25)
    expect(32 * KEYBOARD_ZOOM_FACTOR).toBe(40)
    expect(40 / KEYBOARD_ZOOM_FACTOR).toBe(32)
  })
})

describe('scaleXFor（依赖层手势拉伸）', () => {
  it('k = dayWidth / gestureStartDayWidth', () => {
    expect(scaleXFor(48, 32)).toBeCloseTo(1.5, 9)
    expect(scaleXFor(32, 32)).toBe(1)
  })

  it('起点为 0 / 非有限数时退化为 1（防御，不产出 NaN 变换）', () => {
    expect(scaleXFor(32, 0)).toBe(1)
    expect(scaleXFor(NaN, 32)).toBe(1)
  })
})

describe('timelineOriginX', () => {
  it('两个元素都为 null 时退化为 0（jsdom 无布局）', () => {
    expect(timelineOriginX(null, null)).toBe(0)
  })
})
