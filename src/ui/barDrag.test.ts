import { describe, it, expect } from 'vitest'
import { createCalendar } from '../domain/model/factories'
import { addDays } from '../domain/calendar/workdays'
import { computeDragPreview, daysBetweenPixels, dragAnchorDate } from './barDrag'

// 2026-03-02 周一，03-06 周五，03-07 周六，03-09 周一
const cal = createCalendar()
const origin = { startDate: '2026-03-02', duration: 3 } // 03-02 → 03-04

describe('daysBetweenPixels', () => {
  it('按每天的像素宽度换算天数', () => {
    expect(daysBetweenPixels(90, 30)).toBe(3)
  })

  it('向下取整，避免亚像素抖动', () => {
    expect(daysBetweenPixels(44, 30)).toBe(1)
  })

  it('负数方向同样正确', () => {
    expect(daysBetweenPixels(-90, 30)).toBe(-3)
  })

  it('左右对称：不足一天时两个方向都不进位', () => {
    // 用 floor 会让 -15/30 → -1（整体左移一天），而 +15/30 → 0。
    // 这条断言专门锁住「向零截断」这一对称性。
    expect(daysBetweenPixels(15, 30)).toBe(0)
    expect(daysBetweenPixels(-15, 30)).toBe(0)
    expect(daysBetweenPixels(44, 30)).toBe(daysBetweenPixels(-44, 30) * -1)
  })
})

describe('dragAnchorDate', () => {
  it('move / resizeStart 抓左缘，锚点是开始日', () => {
    expect(dragAnchorDate('move', origin, cal)).toBe('2026-03-02')
    expect(dragAnchorDate('resizeStart', origin, cal)).toBe('2026-03-02')
  })

  it('resizeEnd 抓右缘，锚点是结束日', () => {
    // 工期 3 从 03-02 起 → 结束于 03-04
    expect(dragAnchorDate('resizeEnd', origin, cal)).toBe('2026-03-04')
  })

  it('回归：右把手拖 N 天，工期正好变化 N 天', () => {
    // 若锚点错用开始日，这条会算出 duration 3（拖了等于没拖）。
    const dropDate = addDays(dragAnchorDate('resizeEnd', origin, cal), 2) // 03-04 + 2 = 03-06
    expect(computeDragPreview('resizeEnd', origin, dropDate, cal)).toEqual({
      startDate: '2026-03-02',
      duration: 5,
    })
  })
})

describe('computeDragPreview — move（整体平移）', () => {
  it('工期不变，开始日期按工作日平移', () => {
    // 03-05 是周四；相对 03-02 是 +3 个工作日 → 03-05
    expect(computeDragPreview('move', origin, '2026-03-05', cal)).toEqual({
      startDate: '2026-03-05',
      duration: 3,
    })
  })

  it('落点在周六时吸附到下一个工作日', () => {
    expect(computeDragPreview('move', origin, '2026-03-07', cal).startDate).toBe('2026-03-09')
  })
})

describe('computeDragPreview — resizeEnd（改工期）', () => {
  it('向右拖 2 个工作日使工期 +2', () => {
    const preview = computeDragPreview('resizeEnd', origin, '2026-03-06', cal)
    expect(preview).toEqual({ startDate: '2026-03-02', duration: 5 })
  })

  it('工期不会被拖到 0 以下', () => {
    expect(computeDragPreview('resizeEnd', origin, '2026-02-01', cal).duration).toBe(1)
  })
})

describe('computeDragPreview — resizeStart（改开始）', () => {
  it('向右拖 1 个工作日使开始推后、工期缩短', () => {
    expect(computeDragPreview('resizeStart', origin, '2026-03-03', cal)).toEqual({
      startDate: '2026-03-03',
      duration: 2,
    })
  })

  it('向左拖使开始提前、工期拉长', () => {
    expect(computeDragPreview('resizeStart', origin, '2026-02-27', cal)).toEqual({
      startDate: '2026-02-27',
      duration: 4,
    })
  })
})
