import { describe, it, expect } from 'vitest'
import type { SchedulingDirection, SchedulingOrder, Task } from '../model/types'
import { createTask } from '../model/factories'
import { usesLateSchedule } from './direction'

/** 走真工厂而不是 `as Task` —— 那个 cast 会让「函数将来读了别的字段」这类改动悄悄漏过测试 */
function task(order: SchedulingOrder): Task {
  return { ...createTask({ name: 'X' }), schedulingOrder: order }
}

/**
 * spec §4.2 的真值表：
 *   方向 \ 顺序   asap    alap
 *   forward       early   late
 *   backward      early   late
 *
 * 读表可知结果只由任务自己的 schedulingOrder 决定。
 *
 * 下面的双层循环是**把表抄成可执行的**，不是「方向被覆盖到了」——
 * usesLateSchedule 没有 direction 参数，两行本来就会算出同样结果。
 * 它守的是「表里那四个格子」，将来谁给签名加回 direction 或改了映射，会红。
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
