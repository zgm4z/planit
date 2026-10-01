import { useCallback, useState } from 'react'
import type { TaskId } from '../domain/model/types'

export interface LinkDraft {
  fromTaskId: TaskId
  /** 起点，视口坐标（固定定位的幽灵线用它） */
  fromX: number
  fromY: number
  /** 当前指针位置，视口坐标 */
  toX: number
  toY: number
}

/**
 * 依赖连线拖拽。从任务条右端的连接柄按下，拖到另一个任务条上松手即成边。
 *
 * 命中判定用 `elementFromPoint` 找带 `data-task-id` 的元素 ——
 * 比维护一份坐标索引简单，且对虚拟滚动天然免疫（滚出视口的行本就不该被命中）。
 *
 * 收线有三条路径，缺一不可：
 * - `pointerup`：正常松手
 * - `pointercancel`：触摸/笔被系统打断、浏览器抢占手势
 * - `lostpointercapture`：**鼠标在浏览器窗口外松开**。这种情况下浏览器既不派发
 *   `pointerup` 也不派发 `pointercancel`，只有指针捕获的丢失事件会到。
 *   （捕获本身也是必需的，否则窗口外松开连 `lostpointercapture` 都不会发给页面。）
 */
export function useDependencyLink(onLink: (fromTaskId: TaskId, toTaskId: TaskId) => void) {
  const [draft, setDraft] = useState<LinkDraft | null>(null)

  const begin = useCallback(
    (event: React.PointerEvent, fromTaskId: TaskId, fromX: number, fromY: number) => {
      event.preventDefault()
      event.stopPropagation()

      setDraft({ fromTaskId, fromX, fromY, toX: fromX, toY: fromY })

      const pointerId = event.pointerId
      const captureTarget = event.currentTarget as HTMLElement

      // 三条收线路径可能先后触发（例如 pointerup 之后浏览器隐式释放捕获，
      // 再补一个 lostpointercapture），用这个闸门保证只收一次线、只成一条边。
      let finished = false

      const stop = (): void => {
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
        window.removeEventListener('pointercancel', handleCancel)
        captureTarget.removeEventListener('lostpointercapture', handleCancel)
      }

      const handleMove = (moveEvent: PointerEvent): void => {
        // 多指触摸时，只有启动连线的这根指针能拖动幽灵线
        if (moveEvent.pointerId !== pointerId) return
        setDraft((current) =>
          current ? { ...current, toX: moveEvent.clientX, toY: moveEvent.clientY } : null,
        )
      }

      const handleUp = (upEvent: PointerEvent): void => {
        if (finished) return
        if (upEvent.pointerId !== pointerId) return
        finished = true
        stop()

        const element = document.elementFromPoint(upEvent.clientX, upEvent.clientY)
        const target = element?.closest<HTMLElement>('[data-task-id]')
        const toTaskId = target?.dataset.taskId

        // 落点是自己（或空白处）就不成边；成环/重复等业务拒绝由命令层负责
        if (toTaskId && toTaskId !== fromTaskId) {
          onLink(fromTaskId, toTaskId)
        }
        setDraft(null)
      }

      // 指针被系统取消（触摸被打断、浏览器抢占），或捕获丢失（窗口外松开）时收线，
      // 否则幽灵线与窗口监听器会一直挂到下一次拖拽
      const handleCancel = (): void => {
        if (finished) return
        finished = true
        stop()
        setDraft(null)
      }

      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleUp)
      window.addEventListener('pointercancel', handleCancel)

      // 捕获生效后 move/up 被定向到 captureTarget，但它们仍会冒泡到 window，
      // 所以上面的 window 监听照常工作；这里只要一个「捕获丢失」的兜底。
      // 捕获失败（元素已卸载等）不影响正确性 —— 退化为纯 window 监听。
      try {
        captureTarget.setPointerCapture(pointerId)
        captureTarget.addEventListener('lostpointercapture', handleCancel)
      } catch {
        /* 捕获不可用时忽略：pointerup / pointercancel 两条路径仍然覆盖常规场景 */
      }
    },
    [onLink],
  )

  return { draft, begin }
}
