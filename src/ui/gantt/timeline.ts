import { differenceInCalendarDays } from 'date-fns'
import type { DateStr } from '../../domain/model/types'
import { parseDate, addDays } from '../../domain/calendar/workdays'
import { ROW_HEIGHT } from '../shared/useSharedVirtualizer'

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

/** 普通任务条高度（§3.2：`--bar-height: 18`） */
export const BAR_HEIGHT = 18

/**
 * 关键任务条高度（§3.2：`--bar-height-critical: 20`）。
 *
 * 关键路径必须有独立身份 —— 只靠颜色不够（密集视图里相邻条几乎贴在一起，
 * 色块扫读不如高度差异明显）。高 2px 让关键链在没有颜色时也能被认出来。
 * 两条都**在行内垂直居中**，所以纵向中心恒为 ROW_HEIGHT / 2，
 * DependencyLayer 的端点（走 y + height/2）对两种高度都落在同一条中线上。
 */
export const BAR_HEIGHT_CRITICAL = 20

/** 里程碑菱形的边长（旋转前那个方块的边长）。渲染与几何都读它，不要再写字面量 */
export const MILESTONE_SIZE = 12

/** 轴对齐矩形 */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

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

/**
 * 里程碑菱形的外接矩形（AABB）。
 *
 * 菱形是 MILESTONE_SIZE 见方的方块绕中心 `rotate(45deg)`（旋转在 SCSS 里），
 * 所以它的包围盒是方块的 √2 倍，且左上角相对 xOf 向左偏移 ——
 * 直接拿 xOf 当连线端点会落到菱形右侧约 32px 处。
 *
 * 垂直方向在行内居中；`y` 即 AABB 顶边，不是方块顶边。
 */
export function milestoneRect(scale: TimelineScale, date: DateStr): Rect {
  const spread = MILESTONE_SIZE * Math.SQRT2

  return {
    // 方块中心保持在「xOf + 半个边长」，AABB 由该中心向两侧各扩 √2/2
    x: scale.xOf(date) + MILESTONE_SIZE / 2 - spread / 2,
    y: (ROW_HEIGHT - spread) / 2,
    width: spread,
    height: spread,
  }
}
