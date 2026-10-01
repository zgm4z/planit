import type { DependencyType } from '../../domain/model/types'
import type { Rect } from './timeline'

export interface Anchor {
  x: number
  y: number
}

/**
 * 按依赖类型决定连线从任务条的哪一端出发、落到哪一端。
 * 这是四种依赖类型在视觉上唯一的区别。
 *
 * `from` / `to` 必须是与任务条渲染**同源**的矩形：普通任务用 `barRect` 推出的条，
 * 里程碑用 `milestoneRect` 推出的菱形外接盒。用错函数端点会偏到条外几十像素。
 */
export function anchorsFor(
  type: DependencyType,
  from: Rect,
  to: Rect,
): { start: Anchor; end: Anchor } {
  const fromMidY = from.y + from.height / 2
  const toMidY = to.y + to.height / 2

  const fromLeft: Anchor = { x: from.x, y: fromMidY }
  const fromRight: Anchor = { x: from.x + from.width, y: fromMidY }
  const toLeft: Anchor = { x: to.x, y: toMidY }
  const toRight: Anchor = { x: to.x + to.width, y: toMidY }

  switch (type) {
    case 'FS':
      return { start: fromRight, end: toLeft }
    case 'SS':
      return { start: fromLeft, end: toLeft }
    case 'FF':
      return { start: fromRight, end: toRight }
    case 'SF':
      return { start: fromLeft, end: toRight }
  }
}

/** 两锚点间仍需走折线的最小水平间距。窄于此值就改为「先向右出线再折回」 */
export const MIN_HORIZONTAL_GAP = 20
/** 空间不足时向右探出的短线段长度 */
export const STUB = 10

/**
 * 生成 SVG path 的 `d` 属性：优先走 Z 形折线，空间不足时先出线再折回。
 *
 * 「折回」这一支是必须的 —— 后续任务被排到前置任务左侧（负 lag、约束挤压）时，
 * 若还是取中点，连线会反着压在任务条上。
 */
export function routePath(start: Anchor, end: Anchor): string {
  if (end.x - start.x >= MIN_HORIZONTAL_GAP) {
    const midX = start.x + (end.x - start.x) / 2
    return `M ${start.x} ${start.y} H ${midX} V ${end.y} H ${end.x}`
  }

  const midX = start.x + STUB
  return `M ${start.x} ${start.y} H ${midX} V ${end.y} H ${end.x}`
}
