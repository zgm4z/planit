import { describe, it, expect } from 'vitest'
import { anchorsFor, routePath } from './dependencyRouting'
import { createScale, milestoneRect } from './timeline'

const rect = (x: number, y: number, w: number, h: number) => ({ x, y, width: w, height: h })

describe('anchorsFor', () => {
  const from = rect(100, 20, 60, 16) // 右端 x=160，中线 y=28
  const to = rect(300, 60, 60, 16) // 左端 x=300，右端 x=360，中线 y=68

  it('FS：从前置右端到后续左端', () => {
    expect(anchorsFor('FS', from, to)).toEqual({ start: { x: 160, y: 28 }, end: { x: 300, y: 68 } })
  })

  it('SS：从前置左端到后续左端', () => {
    expect(anchorsFor('SS', from, to)).toEqual({ start: { x: 100, y: 28 }, end: { x: 300, y: 68 } })
  })

  it('FF：从前置右端到后续右端', () => {
    expect(anchorsFor('FF', from, to)).toEqual({ start: { x: 160, y: 28 }, end: { x: 360, y: 68 } })
  })

  it('SF：从前置左端到后续右端', () => {
    expect(anchorsFor('SF', from, to)).toEqual({ start: { x: 100, y: 28 }, end: { x: 360, y: 68 } })
  })

  it('端点永远落在矩形边缘，不会跑到矩形内部或外面', () => {
    const { start, end } = anchorsFor('FS', from, to)
    // 起点贴在 from 的右缘；终点贴在 to 的左缘
    expect(start.x).toBe(from.x + from.width)
    expect(end.x).toBe(to.x)
    // 垂直方向都在各自矩形的中线上
    expect(start.y).toBe(from.y + from.height / 2)
    expect(end.y).toBe(to.y + to.height / 2)
  })
})

describe('anchorsFor × milestoneRect', () => {
  // 里程碑的矩形是菱形外接盒 —— 端点必须落在盒子的边缘，
  // 而不是 barRect 那种「xOf 起、宽 dayWidth」的条。这是 Task 17 最易踩的坑。
  const scale = createScale('2026-03-02', 40)
  const milestone = milestoneRect(scale, '2026-03-04')
  const bar = rect(300, 60, 60, 16)

  it('里程碑作为前置任务时，FS 起点落在外接盒右缘', () => {
    const { start } = anchorsFor('FS', milestone, bar)
    expect(start.x).toBeCloseTo(milestone.x + milestone.width, 6)
    expect(start.y).toBeCloseTo(milestone.y + milestone.height / 2, 6)
  })

  it('里程碑作为后续任务时，FS 终点落在外接盒左缘', () => {
    const { end } = anchorsFor('FS', bar, milestone)
    expect(end.x).toBeCloseTo(milestone.x, 6)
  })

  it('里程碑外接盒比 barRect 窄得多 —— 用错函数端点会差约 40px', () => {
    // barRect(x = xOf, width = max(dayWidth*0.6, dayWidth)) —— 单日任务宽 ≈ dayWidth = 40
    const xOf = scale.xOf('2026-03-04')
    const wrongRightEdge = xOf + 40
    const rightEdge = milestoneRect(scale, '2026-03-04')
    // 正确的右缘 ≈ xOf + 14.49，差 > 25px
    expect(Math.abs(wrongRightEdge - (rightEdge.x + rightEdge.width))).toBeGreaterThan(25)
  })
})

describe('routePath', () => {
  it('水平空间充足时走 Z 形四段折线', () => {
    expect(routePath({ x: 160, y: 28 }, { x: 300, y: 68 })).toBe('M 160 28 H 230 V 68 H 300')
  })

  it('水平空间不足时先向右出线再折回', () => {
    expect(routePath({ x: 160, y: 28 }, { x: 165, y: 68 })).toBe('M 160 28 H 170 V 68 H 165')
  })

  it('同一水平线上仍是一条可渲染的折线', () => {
    const path = routePath({ x: 0, y: 28 }, { x: 200, y: 28 })
    expect(path.startsWith('M 0 28 H')).toBe(true)
    expect(path.endsWith('H 200')).toBe(true)
  })

  it('终点在前置任务左侧（后续排到了前面）也不会画反 —— 先出线再折回', () => {
    const path = routePath({ x: 200, y: 14 }, { x: 40, y: 42 })
    // 第一段必须是向右（+H），否则会压在任务条上反着走
    expect(path).toBe('M 200 14 H 210 V 42 H 40')
  })
})
