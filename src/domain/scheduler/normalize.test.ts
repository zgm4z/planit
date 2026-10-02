import { describe, it, expect } from 'vitest'

import { createProject, createTask, __resetIdCounterForTests } from '../model/factories'
import { solve } from './index'

/**
 * 判据 4：承载字段带时刻 vs 纯日期，**排期结果逐字段相同**。
 *
 * 这不是「排期算法」的黄金测试（算法本版未改），而是**边界归一化**的黄金测试：
 * 它证明 `toDateStr` 在每条引擎边界上都把时刻抹掉了 —— 若某处漏叫，`parseDate`
 * 会得到 Invalid Date、排期整体变 NaN，这里立刻红。
 */
function buildProject(startDate: string, constraintDate?: string) {
  __resetIdCounterForTests()
  const p = createProject('边界', startDate)
  p.tasks = {}
  p.rootIds = []
  const t1 = createTask({ name: 'A', duration: 2 })
  const t2 = createTask({ name: 'B', duration: 3 })
  if (constraintDate) t1.scheduling = { mode: 'constraint', type: 'startOn', date: constraintDate }
  p.tasks = { [t1.id]: t1, [t2.id]: t2 }
  p.rootIds = [t1.id, t2.id]
  p.dependencies = {}
  return p
}

describe('引擎边界归一化：带时刻与纯日期等价', () => {
  it('project.startDate：09:00 与纯日期得到相同的 schedules', () => {
    const withTime = solve(buildProject('2026-03-02T09:00'))
    const plain = solve(buildProject('2026-03-02'))
    expect(withTime.schedules).toEqual(plain.schedules)
  })

  it('scheduledStart 仍是纯日期（派生量不带时刻）', () => {
    const { schedules } = solve(buildProject('2026-03-02T09:00'))
    const first = schedules[Object.keys(schedules)[0]]
    expect(first.scheduledStart).toBe('2026-03-02')
    expect(first.scheduledStart).not.toContain('T')
  })

  it('任务约束日期：带时刻的 14:30 与纯日期排期相同（时刻被抹掉）', () => {
    const withTime = solve(buildProject('2026-03-02', '2026-03-05T14:30'))
    const plain = solve(buildProject('2026-03-02', '2026-03-05'))
    expect(withTime.schedules).toEqual(plain.schedules)
  })
})
