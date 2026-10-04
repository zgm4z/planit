import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { createScale } from './timeline'
import { useTimelineZoom } from './useTimelineZoom'

/**
 * 手势状态机的回归测试（纯函数之外的部分）。
 *
 * 宿主极小：一个滚动口 + 一个甘特区（时间轴原点）。滚轮监听挂在滚动口上（hook 用的是
 * 原生 addEventListener，不是 React onWheel）。
 */
function Harness({
  dayWidth,
  setDayWidth,
}: {
  dayWidth: number
  setDayWidth: (w: number) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const ganttPaneRef = useRef<HTMLDivElement>(null)
  const scale = createScale('2026-03-02', dayWidth)
  const { beginRulerDrag } = useTimelineZoom({
    dayWidth,
    setDayWidth,
    scale,
    scrollRef,
    ganttPaneRef,
  })
  return (
    <div ref={scrollRef} data-testid="scroll">
      <div ref={ganttPaneRef} data-testid="pane" onPointerDown={beginRulerDrag} />
    </div>
  )
}

/** 等一个 rAF 帧（桩把 rAF 定在 16ms）。 */
const waitFrame = () => new Promise((resolve) => setTimeout(resolve, 25))

beforeEach(() => {
  // rAF 桩必须**异步**：同步执行会让 `rafRef.current = requestAnimationFrame(cb)` 在 cb 之后
  // 才赋值，破坏 hook 的「一帧一次」记账。
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
    window.setTimeout(() => cb(performance.now()), 16),
  )
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useTimelineZoom 手势状态（回归）', () => {
  it('手势之外 store 被改动（点预设）后，下一次滚轮以 store 值为基准 —— 不用陈旧的 pending', async () => {
    const setDayWidth = vi.fn()
    const { rerender } = render(<Harness dayWidth={32} setDayWidth={setDayWidth} />)
    const scroll = screen.getByTestId('scroll')

    // 手势 1：Ctrl+滚轮放大 32 → 32·e^{0.2}
    fireEvent.wheel(scroll, { deltaY: -100, ctrlKey: true })
    await waitFrame()
    expect(setDayWidth).toHaveBeenCalledTimes(1)
    expect(setDayWidth.mock.calls[0][0]).toBeCloseTo(32 * Math.exp(0.2), 6)

    // 手势之外，store 被别的路径改到 4（等价于点「月」预设）
    rerender(<Harness dayWidth={4} setDayWidth={setDayWidth} />)
    await waitFrame()

    // 手势 2：再来一格 —— 基准必须是 4，而不是被消费后仍残留的 32·e^{0.2}
    fireEvent.wheel(scroll, { deltaY: -100, ctrlKey: true })
    await waitFrame()
    expect(setDayWidth).toHaveBeenCalledTimes(2)
    expect(setDayWidth.mock.calls[1][0]).toBeCloseTo(4 * Math.exp(0.2), 6)
  })
})
