import type { Task } from '../model/types'

/**
 * 决定一个任务的最终排期取 early 还是 late 值。
 *
 * 真值表（spec §4.2）：
 *   方向 \ 顺序   asap    alap
 *   forward       early   late
 *   backward      early   late
 *
 * 注意真值表里方向两行完全相同 —— 决定权只在这个任务自己的
 * schedulingOrder 上。项目方向影响的是**锚点**（从起点正推还是
 * 从终点逆推，见 cpm.ts），不是单个任务取早取晚。
 *
 * spec §4.2 的代码块把 backward 那两格写反了（把它算成
 * backward+asap → late、backward+alap → early），与它自己的表和
 * 解释文字都矛盾；此处按表实现。
 */
export function usesLateSchedule(task: Task): boolean {
  return task.schedulingOrder === 'alap'
}
