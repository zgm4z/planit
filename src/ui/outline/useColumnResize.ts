import { useCallback, useEffect, useRef } from 'react'
import { clampColumnWidth, type OutlineColumnKey } from '../../store/columnKeys'

/**
 * 拖拽期间挂在 `document.body` 上的类名 —— 强制 `col-resize` 光标并禁掉文本选择。
 *
 * 为什么需要它：指针短暂移出手柄那 6px 时，浏览器会把光标换回默认箭头、
 * 并开始选择表头文字。挂一个全局类，整个拖拽期间光标都不闪。
 */
export const COLUMN_RESIZING_CLASS = 'planit-column-resizing'

interface UseColumnResizeOptions {
  /** 宽度变化时调用。**拖拽中每帧都会调** —— 调用方直接写 store */
  onResize: (key: OutlineColumnKey, width: number) => void
  /** 双击复位。调用方从 store 里**删除**该列的覆盖 */
  onReset: (key: OutlineColumnKey) => void
}

export interface ColumnResizeApi {
  /**
   * 手柄的 `pointerdown` 里调用。
   * `startWidth` 传**当前**列宽（`column.width` —— 那是已合并用户覆盖值的宽度）。
   */
  begin: (event: React.PointerEvent, key: OutlineColumnKey, startWidth: number) => void
  /** 手柄的 `dblclick` 里调用 */
  reset: (key: OutlineColumnKey) => void
}

/**
 * 表头分隔线的拖拽 / 双击复位。
 *
 * 与 `useBarDrag` 同一手法：**window 监听 + try/catch 包住 setPointerCapture**，
 * 而不是 React 合成事件 + 指针捕获 —— jsdom 不实现 `setPointerCapture`，
 * 而 window 监听在真实浏览器里还多一层保险（在窗口外松开也能收尾）。
 *
 * 与 `useBarDrag` 的四处**刻意不同**：
 *
 *   1. **不做 3px 点击阈值。** 那条阈值是为了区分「单击选中任务」与「拖拽任务条」；
 *      手柄上没有「单击」语义（双击是复位），阈值只会让手感发黏。
 *   2. **不 preventDefault。** `pointerdown` 上的 `preventDefault` 会抑制后续的
 *      兼容性鼠标事件，**双击复位就再也收不到了**。防文本选择交给 CSS
 *      （表头本就有 `user-select: none`），防触摸端滚动交给手柄的 `touch-action: none`。
 *   3. **不做影子预览。** 影子必须同时喂给表头和单元格，否则逐列对齐当场破掉 ——
 *      那就还是得走 columns 这条链、还得多维护一份状态。既然重渲染躲不开，
 *      就直接写 store：唯一真相，且不存在「预览与落盘不一致」。
 *   4. **不 stopPropagation。** useBarDrag 需要它（任务条上叠着「单击选中」的语义、
 *      行上还有 onClick）。表头单元格没有左键处理器、列菜单走右键 ContextMenu，
 *      让 pointerdown 冒泡上去没有任何东西会接 —— 没有理由多写一行。
 */
export function useColumnResize({ onResize, onReset }: UseColumnResizeOptions): ColumnResizeApi {
  // onResize 每次渲染都可能是新函数，用 ref 兜住，免得把 begin 的依赖搞脏
  const onResizeRef = useRef(onResize)
  onResizeRef.current = onResize

  /**
   * 当前拖拽会话的收尾函数。**唯一用途是卸载时兜底** —— listeners 挂在 window、
   * 全局类挂在 document.body，两者都在组件之外；组件若在拖拽中途卸载（切视图、
   * 项目置空、该列被响应式隐藏），就没有任何路径能把它们摘掉，症状是全局的
   * col-resize 光标与「不能选中文字」一直粘着，且 pointermove 还会继续写 store。
   */
  const stopRef = useRef<(() => void) | null>(null)

  useEffect(
    () => () => {
      stopRef.current?.()
    },
    [],
  )

  const begin = useCallback(
    (event: React.PointerEvent, key: OutlineColumnKey, startWidth: number) => {
      // 只响应主键（左键 / 触摸 / 笔）—— 右键与中键会顺带触发右键菜单或中键
      // 滚动，与拖拽叠加后行为不可预期。与 useBarDrag 同一条规则。
      if (event.button !== 0) return

      const pointerId = event.pointerId
      const startClientX = event.clientX
      const captureTarget = event.currentTarget as HTMLElement | null

      // 三条收尾路径（pointerup / pointercancel / lostpointercapture）可能先后
      // 触发，用这个闸门保证只收一次。
      let finished = false

      const stop = (): void => {
        // 先清引用再摘监听，避免重入时重复摘
        stopRef.current = null
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
        window.removeEventListener('pointercancel', handleCancel)
        captureTarget?.removeEventListener('lostpointercapture', handleCancel)
        document.body.classList.remove(COLUMN_RESIZING_CLASS)
      }
      stopRef.current = stop

      const handleMove = (moveEvent: PointerEvent): void => {
        // 多指触摸时，只有启动拖拽的那根指针能驱动它
        if (moveEvent.pointerId !== pointerId) return
        // 每帧都按「起始宽 + 累计位移」算 —— 不是把增量累加进当前宽。
        // 后者在 store 每帧重算的场景下会越滚越偏。
        onResizeRef.current(
          key,
          clampColumnWidth(key, startWidth + (moveEvent.clientX - startClientX)),
        )
      }

      const handleUp = (upEvent: PointerEvent): void => {
        // 只有启动拖拽的那根指针能结束它 —— 否则触摸设备上另一根手指（或手掌）
        // 的抬起会打断进行中的拖拽。useDependencyLink 有同样的守卫。
        if (upEvent.pointerId !== pointerId) return
        if (finished) return
        finished = true
        stop()
      }

      // 指针被系统取消（触摸打断、浏览器抢占手势），或捕获丢失（在浏览器窗口
      // 外松开 —— 此时既没有 pointerup 也没有 pointercancel）时收尾，
      // 否则全局类与 window 监听会一直挂到下一次拖拽。
      //
      // **刻意不加 pointerId 守卫**：它同时是 pointercancel 与 lostpointercapture
      // 的处理器，且这两个事件不一定带得动 pointerId。「多收尾一次」是幂等的、
      // 可接受；「漏收尾」会让全局类永远粘在 body 上。宁可能多收，不可漏收。
      // 因此它**自成一体的收尾**，不委托给带守卫的 handleUp（useDependencyLink 同形）。
      const handleCancel = (): void => {
        if (finished) return
        finished = true
        stop()
      }

      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleUp)
      window.addEventListener('pointercancel', handleCancel)
      document.body.classList.add(COLUMN_RESIZING_CLASS)

      // 指针捕获让窗口外松开也能收到 lostpointercapture 兜底。捕获不可用
      // （jsdom 无此 API）时退化为纯 window 监听，不影响正确性。
      if (captureTarget) {
        try {
          captureTarget.setPointerCapture(pointerId)
          captureTarget.addEventListener('lostpointercapture', handleCancel)
        } catch {
          /* 捕获不可用时忽略 */
        }
      }
    },
    [],
  )

  const reset = useCallback(
    (key: OutlineColumnKey) => {
      onReset(key)
    },
    [onReset],
  )

  return { begin, reset }
}
