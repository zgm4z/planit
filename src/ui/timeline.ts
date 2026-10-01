import { differenceInCalendarDays } from 'date-fns'
import type { DateStr } from '../domain/model/types'
import { parseDate, addDays } from '../domain/calendar/workdays'

/**
 * 日期与像素之间的映射。
 *
 * 时间轴按**自然日**铺开 —— 周末照常占位置（只是没有任务条跨越它），
 * 这样时间轴才是连续的日历，符合甘特图的阅读习惯。
 */
export interface TimelineScale {
  startDate: DateStr
  dayWidth: number
  daysFromStart: (date: DateStr) => number
  xOf: (date: DateStr) => number
  /** 从 start 到 finish（含首尾）占用的像素宽度 */
  widthOf: (start: DateStr, finish: DateStr) => number
  /** xOf 的逆运算：像素坐标 → 日期。拖拽落点计算要用 */
  dateAt: (x: number) => DateStr
}

export function createScale(startDate: DateStr, dayWidth: number): TimelineScale {
  const origin = parseDate(startDate)

  const daysFromStart = (date: DateStr): number =>
    differenceInCalendarDays(parseDate(date), origin)

  return {
    startDate,
    dayWidth,
    daysFromStart,
    xOf: (date) => daysFromStart(date) * dayWidth,
    widthOf: (start, finish) => (daysFromStart(finish) - daysFromStart(start) + 1) * dayWidth,
    dateAt: (x) => addDays(startDate, Math.floor(x / dayWidth)),
  }
}

/** 任务条最小宽度占一天的比例 —— 缩放很小或工期极短时，条不能细到看不见 */
export const MIN_BAR_WIDTH_RATIO = 0.6

export interface BarRect {
  x: number
  width: number
}

/**
 * 任务条的横向矩形（不含纵向位置）。
 *
 * **TaskBar 与 DependencyLayer 必须共用这一个函数** —— 连线端点用的坐标
 * 若与任务条各自的算法不一致，连线就会插在任务条外面。
 */
export function barRect(scale: TimelineScale, start: DateStr, finish: DateStr): BarRect {
  return {
    x: scale.xOf(start),
    width: Math.max(scale.dayWidth * MIN_BAR_WIDTH_RATIO, scale.widthOf(start, finish)),
  }
}
