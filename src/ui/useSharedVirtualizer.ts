import { useVirtualizer, type VirtualItem } from '@tanstack/react-virtual'
import type { RefObject } from 'react'

/** 行高。JS 与 CSS（--planit-row-height）必须保持一致，改动时两处同步 */
export const ROW_HEIGHT = 28

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
