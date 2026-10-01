import { describe, it, expect } from 'vitest'
import type { SchedulingDirection, SchedulingOrder, Task } from '../model/types'
import { usesLateSchedule } from './direction'

function task(order: SchedulingOrder): Task {
  return { schedulingOrder: order } as Task
}

/**
 * spec §4.2 的真值表：
 *   方向 \ 顺序   asap    alap
 *   forward       early   late
 *   backward      early   late
 *
 * 读表可知结果只由任务自己的 schedulingOrder 决定。
 */
const TABLE: Record<SchedulingDirection, Record<SchedulingOrder, boolean>> = {
  forward: { asap: false, alap: true },
  backward: { asap: false, alap: true },
}

describe('usesLateSchedule — spec §4.2 真值表穷举', () => {
  const directions: SchedulingDirection[] = ['forward', 'backward']
  const orders: SchedulingOrder[] = ['asap', 'alap']

  for (const direction of directions) {
    for (const order of orders) {
      it(`${direction} + ${order} → ${TABLE[direction][order] ? 'late' : 'early'}`, () => {
        expect(usesLateSchedule(task(order))).toBe(TABLE[direction][order])
      })
    }
  }

  it('asap 恒取早（含 backward，这是 spec 里加粗强调的那一格）', () => {
    expect(usesLateSchedule(task('asap'))).toBe(false)
  })

  it('alap 恒取晚', () => {
    expect(usesLateSchedule(task('alap'))).toBe(true)
  })
})
