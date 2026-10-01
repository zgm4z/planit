import { useVirtualizer, type VirtualItem } from '@tanstack/react-virtual'
import type { RefObject } from 'react'

/**
 * 行高（像素）。**这是唯一来源** —— 虚拟化器用它做 estimateSize，每行用它作
 * 内联 height，CSS 侧不持有对应的自定义属性（早期那个 `--planit-row-height`
 * 并无任何 CSS 消费方，已删除）。改这里即可，不存在「两处同步」。
 */
export const ROW_HEIGHT = 30

/**
 * 左侧任务表与右侧甘特图共用的虚拟化器。
 *
 * 调用方必须把返回的 scrollRef 挂到**唯一的**外层滚动容器上 ——
 * 两侧列都渲染在同一个滚动容器内（CSS Grid + sticky 固定表头与左列），
 * 因此天然共享 scrollTop，不会出现行错位。
 */
export function useSharedVirtualizer(
  scrollRef: RefObject<HTMLDivElement | null>,
  rowCount: number,
): VirtualItem[] {
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })

  return virtualizer.getVirtualItems()
}
