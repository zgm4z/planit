import type { ComputedSchedule, DateStr } from '../../domain/model/types'

/**
 * 「用户看到的日期」的**唯一取值口径**：列表单元格与甘特条经这里取同一对字段。
 *
 * 为什么是单参、为什么不做方向分支：v0.2 已把「方向 × 顺序」解析烤进了引擎输出 ——
 * `scheduledStart` / `scheduledFinish` **就是**最终排期（见 ComputedSchedule 的注释）。
 * spec §4.2 的三参签名会让本函数再实现一遍方向判断，那正是 v0.2 偏差 3（`deriveKind`）
 * 刚消灭掉的「同一条规则两份实现」。保留这个名字，是为了让「列表与甘特条同口径」
 * 这条不变量有一个可指认的位置（甘特条侧读的是同一对字段，不需要改）。
 *
 * 为什么在 `shared/` 而不是某个功能区包：它的存在意义**就是**跨视图共用 ——
 * 列表单元格（outline/）、甘特条（gantt/）、检查器（inspector/）都读它。放进任一
 * 功能区包都会让另外两个包反向依赖该包（跨包反向依赖）；放在不依赖任何兄弟包的
 * `shared/` 里，依赖方向才是单向的。**不要再挪回 `outline/`。**
 */
export function resolveScheduleDates(schedule: ComputedSchedule): {
  start: DateStr
  finish: DateStr
} {
  return { start: schedule.scheduledStart, finish: schedule.scheduledFinish }
}
