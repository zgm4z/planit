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
 *
 * 与 Task.scheduling 的分工（两者不冲突，别在别处再定义一遍）：
 *   Task.scheduling   定义**可行窗口** —— constraintLowerBound / constraintUpperBound
 *                     给出 [下界, 上界]，硬日期约束把窗口夹紧
 *   schedulingOrder   在窗口**之内**选端点 —— early 取早端，late 取晚端
 *
 * 极端组合（例如 startNoEarlierThan + alap）不需要特判：如果晚端落在
 * 约束下界之前，lateStart < earlyStart，totalSlack 变负，
 * detectConflicts 会如实报告负浮时，不推断矛盾成因。
 */
export function usesLateSchedule(task: Task): boolean {
  return task.schedulingOrder === 'alap'
}
