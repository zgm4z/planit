import type { Baseline, Project } from './types'

/**
 * 项目当前**活动基线**（没有则 undefined）。
 *
 * 这是「哪条基线在用 / 有没有基线可用」的**唯一一处**判定。此前它散在两处
 * （菜单「项目 > 删除当前基线」的启用判定、任务面板基线组的对比基线），
 * 各写一遍 `baselines.find(b => b.id === activeBaselineId)` —— 正是本项目最
 * 忌讳的「同一规则两份实现」，任一处将来放宽/收紧，另一处会静默漂移。
 *
 * 真源永远是 `project.baselines` + `project.activeBaselineId`：这里不引入任何
 * 派生缓存，只是把那条查询收成一个有名字的函数。activeBaselineId 为 null
 * （用户选了「不对比」）时直接返回 undefined，不做多余的数组扫描。
 */
export function findActiveBaseline(project: Project): Baseline | undefined {
  if (project.activeBaselineId === null) return undefined
  return project.baselines.find((baseline) => baseline.id === project.activeBaselineId)
}
