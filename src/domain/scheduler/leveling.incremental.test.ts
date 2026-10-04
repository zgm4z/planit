/**
 * 不变量测试：增量维护的负载表必须与 `resourceDayLoad` 的全量重建一致
 * （键集严格相等、逐格数值在相对容差内）。
 *
 * 这是本次「负载增量化」最危险的一面 —— 增量状态一旦漂移（少加/多加、0 键残留、
 * 空资源表未删），输出会**静默**改变，而黄金夹具可能恰好没覆盖到那条路径。
 * 因此这里不满足于「收敛后对一次」：借 `LevelingHooks.onIteration` 钩子，在
 * `levelLeaves` 的**每一轮**开始处把当前增量表与 `resourceDayLoad(context, dates)`
 * 的重建结果对拍（键集 + 逐格数值）。任一格不一致立即变红，并定位到 资源@日期。
 *
 * 数值用**相对容差**（`expectCloseValue`）而非精确相等；键集（资源 / 日期）仍**严格**。
 */
import { describe, expect, it } from 'vitest'
import type { DateStr, Project, ResourceId } from '../model/types'
import { __resetIdCounterForTests } from '../model/factories'
import { buildScheduleContext } from './context'
import { runCpmWithGraph } from './cpm'
import { toDateStr } from '../calendar/dateTime'
import { levelLeaves, resourceDayLoad } from './leveling'
import { FIXED_BUDGET, FIXTURES } from './leveling.differential.fixtures'

/** 跑一遍 CPM，拿到 `levelLeaves` 需要的基线排期（与 leveling.test.ts 的 solveCpm 同口径） */
function baseline(project: Project) {
  const context = buildScheduleContext(project)
  const durations = new Map(context.leaves.map((task) => [task.id, task.duration]))
  const schedules = runCpmWithGraph(
    {
      tasks: [...context.leaves],
      dependencies: [...context.dependencies],
      calendar: context.calendar,
      direction: project.schedulingDirection,
      projectStart: toDateStr(project.startDate),
      projectEnd: project.endDate ? toDateStr(project.endDate) : undefined,
      resourceBounds: Object.fromEntries(context.resourceBoundsByTask),
    },
    context.graph,
  )
  return { context, durations, schedules }
}

type LoadMap = ReadonlyMap<ResourceId, ReadonlyMap<DateStr, number>>

/**
 * 数值比较用**相对容差**，不用精确相等。
 *
 * 为什么不能精确相等：增量维护的 `+` / `−` 与全量重建的**一次性求和**在 IEEE-754 下
 * 不保证逐位相同 —— 只要单位不是可精确表示的二进制分数（如 0.7），
 * `2.1 − 0.7 = 1.3999999999999997`，而重建的 `0.7 + 0.7 = 1.4`（见 `fractional-units`
 * 夹具）。这类尾差在 ~1e-16 量级，**不可能影响行为**：所有决策（是否超载）都用
 * `1e-9` 阈值（`OVERLOAD_EPSILON`），`fitsAt` 亦然。用精确相等会在任何分数单位夹具上
 * **假红**，把守卫变成「谁加分数单位谁踩坑」的陷阱 —— 正是要避免的。
 */
function expectCloseValue(actual: number, expected: number, where: string): void {
  const tolerance = 1e-9 * Math.max(1, Math.abs(expected))
  expect(
    Math.abs(actual - expected),
    `${where}（增量 ${actual} vs 重建 ${expected}，容差 ${tolerance}）`,
  ).toBeLessThanOrEqual(tolerance)
}

/**
 * 键集（资源、日期）**严格**相等，逐格数值**容差**相等。
 * 键集严格是有意的：增量少删/多建（残留 0 键、空资源表未删）行为上无害但结构上
 * 不该漂移，值得继续抓 —— 这是删除路径（`bump` 的 `<= 0` 分支）的守卫。
 */
function expectLoadMapEqual(actual: LoadMap, expected: LoadMap, where: string): void {
  expect([...actual.keys()].sort(), `${where}: 资源键集`).toEqual([...expected.keys()].sort())
  for (const [resourceId, byDay] of actual) {
    const expectedByDay = expected.get(resourceId)!
    expect([...byDay.keys()].sort(), `${where}: ${resourceId} 的日期键集`).toEqual(
      [...expectedByDay.keys()].sort(),
    )
    for (const [date, value] of byDay) {
      expectCloseValue(value, expectedByDay.get(date)!, `${where}: ${resourceId}@${date}`)
    }
  }
}

describe('增量负载 == 全量重建（每一轮）', () => {
  for (const fixture of FIXTURES) {
    // 显式超时：本文件在并行套件里跑，vitest 缺省 5s 闸门曾在 CPU 争用下把确定性
    // 用例判红（见 leveling.perf.test.ts 的教训）。这里给足余量，让真正的判据是断言。
    it(
      fixture.name,
      () => {
        __resetIdCounterForTests()
        const project = fixture.build()
        const { context, durations, schedules } = baseline(project)

        let checkedIterations = 0
        const { result } = levelLeaves(context, durations, schedules, FIXED_BUDGET, {
          onIteration: (load, dates) => {
            checkedIterations += 1
            expectLoadMapEqual(load, resourceDayLoad(context, dates), `${fixture.name} 第 ${checkedIterations} 轮`)
          },
        })

        // 钩子在每轮开头触发，收敛判定（worst === undefined → break）之前也已触发过一轮：
        // 故即便 0 迭代的夹具也至少对拍 1 次；有迭代的更不止。
        expect(checkedIterations, '钩子一次都没触发 —— 不变量没被真正验证').toBeGreaterThanOrEqual(1)
        expect(checkedIterations).toBeGreaterThanOrEqual((result.iterations ?? 0))
      },
      30_000,
    )
  }
})
