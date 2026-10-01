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
 */
export function useDependencyLink(onLink: (fromTaskId: TaskId, toTaskId: TaskId) => void) {
  const [draft, setDraft] = useState<LinkDraft | null>(null)

  const begin = useCallback(
    (event: React.PointerEvent, fromTaskId: TaskId, fromX: number, fromY: number) => {
      event.preventDefault()
      event.stopPropagation()

      setDraft({ fromTaskId, fromX, fromY, toX: fromX, toY: fromY })

      const stop = (): void => {
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
        window.removeEventListener('pointercancel', handleCancel)
      }

      const handleMove = (moveEvent: PointerEvent): void => {
        setDraft((current) =>
          current ? { ...current, toX: moveEvent.clientX, toY: moveEvent.clientY } : null,
        )
      }

      const handleUp = (upEvent: PointerEvent): void => {
        stop()

        const element = document.elementFromPoint(upEvent.clientX, upEvent.clientY)
        const target = element?.closest<HTMLElement>('[data-task-id]')
        const toTaskId = target?.dataset.taskId

        // 落点是自己（或空白处）就不成边；成环等业务拒绝由命令层负责
        if (toTaskId && toTaskId !== fromTaskId) {
          onLink(fromTaskId, toTaskId)
        }
        setDraft(null)
      }

      // 指针被系统取消（触摸被打断、浏览器抢占）时也要收线，否则幽灵线会一直挂着
      const handleCancel = (): void => {
        stop()
        setDraft(null)
      }

      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleUp)
      window.addEventListener('pointercancel', handleCancel)
    },
    [onLink],
  )

  return { draft, begin }
}
