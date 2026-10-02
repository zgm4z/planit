import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { OutlineColumnKey } from '../../store/columnKeys'
import { COLUMN_RESIZING_CLASS, useColumnResize } from './useColumnResize'

/**
 * 最小宿主：一个 100px 宽、名为 start 的列。
 * hook 的手势逻辑与渲染无关，用不着真表格。
 */
function Harness({
  onResize,
  onReset,
}: {
  onResize: (key: OutlineColumnKey, width: number) => void
  onReset: (key: OutlineColumnKey) => void
}) {
  const { begin, reset } = useColumnResize({ onResize, onReset })
  return (
    <div
      data-testid="handle"
      onPointerDown={(event) => begin(event, 'start', 100)}
      onDoubleClick={() => reset('start')}
    />
  )
}

function moveTo(clientX: number, pointerId = 1): void {
  // 与 hook 的真实事件模型一致：它监听的是 window（不是元素），
  // 因为指针捕获可能把事件派发到别处。jsdom 30 支持 PointerEvent 构造。
  window.dispatchEvent(new PointerEvent('pointermove', { pointerId, clientX }))
}

function up(pointerId = 1): void {
  window.dispatchEvent(new PointerEvent('pointerup', { pointerId, clientX: 0 }))
}

beforeEach(() => {
  document.body.classList.remove(COLUMN_RESIZING_CLASS)
})

describe('useColumnResize', () => {
  it('按下后横向移动 => 按位移改宽（起始宽 + delta）', () => {
    const onResize = vi.fn()
    render(<Harness onResize={onResize} onReset={vi.fn()} />)

    fireEvent.pointerDown(screen.getByTestId('handle'), {
      button: 0,
      pointerId: 1,
      clientX: 200,
    })

    moveTo(260)
    expect(onResize).toHaveBeenCalledWith('start', 160)

    moveTo(180)
    expect(onResize).toHaveBeenLastCalledWith('start', 80)
  })

  it('每帧都按**起始宽 + 累计位移**算，不是累加增量', () => {
    // 这条防的是「把 delta 累加进当前宽」的实现 —— 那种写法下
    // move(260) 之后再 move(180) 会算出 40（100+60-80）而不是 80。
    const onResize = vi.fn()
    render(<Harness onResize={onResize} onReset={vi.fn()} />)

    fireEvent.pointerDown(screen.getByTestId('handle'), { button: 0, pointerId: 1, clientX: 200 })
    moveTo(260)
    moveTo(180)

    expect(onResize).toHaveBeenLastCalledWith('start', 80)
  })

  it('右移时被上限 clamp（不产生超过区间宽的调用）', () => {
    const onResize = vi.fn()
    render(<Harness onResize={onResize} onReset={vi.fn()} />)

    fireEvent.pointerDown(screen.getByTestId('handle'), { button: 0, pointerId: 1, clientX: 0 })
    moveTo(99999)

    expect(onResize).toHaveBeenLastCalledWith('start', 1000)
  })

  it('松手后不再响应移动', () => {
    const onResize = vi.fn()
    render(<Harness onResize={onResize} onReset={vi.fn()} />)

    fireEvent.pointerDown(screen.getByTestId('handle'), { button: 0, pointerId: 1, clientX: 200 })
    moveTo(260)
    expect(onResize).toHaveBeenCalledTimes(1)

    up()
    moveTo(400)
    expect(onResize).toHaveBeenCalledTimes(1)
  })

  it('非主键（右键 / 中键）不启动拖拽', () => {
    const onResize = vi.fn()
    render(<Harness onResize={onResize} onReset={vi.fn()} />)

    fireEvent.pointerDown(screen.getByTestId('handle'), { button: 2, pointerId: 9, clientX: 200 })
    moveTo(300, 9)

    expect(onResize).not.toHaveBeenCalled()
  })

  it('多指触摸时只有启动拖拽的那根指针能驱动它', () => {
    const onResize = vi.fn()
    render(<Harness onResize={onResize} onReset={vi.fn()} />)

    fireEvent.pointerDown(screen.getByTestId('handle'), { button: 0, pointerId: 1, clientX: 200 })
    moveTo(300, 2) // 另一根手指

    expect(onResize).not.toHaveBeenCalled()
    moveTo(260, 1)
    expect(onResize).toHaveBeenCalledWith('start', 160)
  })

  it('拖拽中给 body 挂全局类，结束后摘掉 —— 指针移出手柄时光标不闪', () => {
    render(<Harness onResize={vi.fn()} onReset={vi.fn()} />)

    fireEvent.pointerDown(screen.getByTestId('handle'), { button: 0, pointerId: 1, clientX: 200 })
    expect(document.body.classList.contains(COLUMN_RESIZING_CLASS)).toBe(true)

    up()
    expect(document.body.classList.contains(COLUMN_RESIZING_CLASS)).toBe(false)
  })

  it('pointercancel 也收尾（触摸被打断时不留下全局类）', () => {
    render(<Harness onResize={vi.fn()} onReset={vi.fn()} />)

    fireEvent.pointerDown(screen.getByTestId('handle'), { button: 0, pointerId: 1, clientX: 200 })
    window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 }))

    expect(document.body.classList.contains(COLUMN_RESIZING_CLASS)).toBe(false)
  })

  it('双击调用 reset（复位）', () => {
    const onReset = vi.fn()
    render(<Harness onResize={vi.fn()} onReset={onReset} />)

    fireEvent.dblClick(screen.getByTestId('handle'))

    expect(onReset).toHaveBeenCalledWith('start')
  })

  it('pointerdown 不调用 preventDefault —— 否则兼容性鼠标事件被抑制、双击复位收不到', () => {
    const onResize = vi.fn()
    render(<Harness onResize={onResize} onReset={vi.fn()} />)

    // fireEvent 返回 false 表示 defaultPrevented
    const notPrevented = fireEvent.pointerDown(screen.getByTestId('handle'), {
      button: 0,
      pointerId: 1,
      clientX: 200,
    })

    expect(notPrevented).toBe(true)
  })
})
