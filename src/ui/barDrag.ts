import type { Calendar, DateStr } from '../domain/model/types'
import { addWorkdays, snapToWorkday, taskFinish, workdaysBetween } from '../domain/calendar/workdays'

export type DragMode = 'move' | 'resizeStart' | 'resizeEnd'

export interface DragOrigin {
  startDate: DateStr
  duration: number
}

export interface DragPreview {
  startDate: DateStr
  duration: number
}

/**
 * 位移像素 → 天数，向零截断（避免亚像素抖动导致日期乱跳）。
 *
 * **必须用 `Math.trunc` 而不是 `Math.floor`**：`floor` 对负数是向更负的方向取整，
 * 会使「向左拖」比「向右拖」多跳一天 —— 例如 dayWidth=30 时，向右拖 15px
 * 换算成 0 天（不动），向左拖 15px 却被 `floor` 算成 -1 天（整体左移一天）。
 * 向零截断让左右两个方向严格对称。
 */
export function daysBetweenPixels(deltaPx: number, dayWidth: number): number {
  const days = Math.trunc(deltaPx / dayWidth)
  // `Math.trunc(-0.5)` 返回 `-0`：数值上无害，但它会让 `Object.is(-0, 0)`
  // 为 false，污染下游断言与任何做恒等比较的调用方。归一化成 +0。
  return days === 0 ? 0 : days
}

/**
 * 像素位移所依附的日期锚点。
 *
 * 指针位移必须叠加在**被抓住的那条边**上：
 * - `move` / `resizeStart` 抓的是左缘，锚点即开始日期
 * - `resizeEnd` 抓的是**右缘**，锚点必须是结束日期
 *
 * 若 `resizeEnd` 也锚在开始日期，落点会整体前移 `duration - 1` 个工作日 ——
 * 表现为「右把手拖 N 天，工期几乎不变」，甚至完全拖不动。
 */
export function dragAnchorDate(mode: DragMode, origin: DragOrigin, cal: Calendar): DateStr {
  return mode === 'resizeEnd'
    ? taskFinish(origin.startDate, origin.duration, cal)
    : origin.startDate
}

/**
 * 由拖拽模式、拖拽起点与落点日期算出预览排期。
 *
 * 落点一律先吸附到工作日、再以工作日为单位推演 ——
 * 这样「拖过周末」与「拖过节假日」都能得到符合直觉的结果。
 */
export function computeDragPreview(
  mode: DragMode,
  origin: DragOrigin,
  targetDate: DateStr,
  cal: Calendar,
): DragPreview {
  const snappedTarget = snapToWorkday(targetDate, cal)
  const snappedOriginStart = snapToWorkday(origin.startDate, cal)

  switch (mode) {
    case 'move': {
      const delta = workdaysBetween(snappedOriginStart, snappedTarget, cal)
      return {
        startDate: addWorkdays(snappedOriginStart, delta, cal),
        duration: origin.duration,
      }
    }

    case 'resizeStart': {
      const delta = workdaysBetween(snappedOriginStart, snappedTarget, cal)
      return {
        startDate: addWorkdays(snappedOriginStart, delta, cal),
        duration: Math.max(1, origin.duration - delta),
      }
    }

    case 'resizeEnd': {
      const originalFinish = taskFinish(snappedOriginStart, origin.duration, cal)
      const delta = workdaysBetween(originalFinish, snappedTarget, cal)
      return {
        startDate: origin.startDate,
        duration: Math.max(1, origin.duration + delta),
      }
    }
  }
}
