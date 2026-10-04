/**
 * 全量差分测试：本次「字符串键 → 整数索引」表示改造必须**逐字节复现** HEAD 的真实
 * `solve()` 输出（整个 `ScheduleResult`，不只平衡那五项）。
 *
 * 黄金数据 `result.differential.golden.json` 由**改动前的 HEAD worktree**
 * （`git worktree add --detach /tmp/planit-head HEAD`）里的真实 `solve()` 跑出
 * （生成脚本一次性地把结果冻成 JSON，用完即弃，**不留第二份源码实现**）。这里只读数据。
 *
 * 覆盖：schedules（每叶子的 earlyStart/Finish、lateStart/Finish、scheduledStart/Finish、
 * totalSlack、freeSlack、isCritical、conflictBinding）、conflicts、efforts、costs、
 * resourceTotals、leveling（delays/unresolved/iterations/budgetExhausted）、
 * earnedValues、baselineDiffs —— 每个字段都断言。
 *
 * 预算固定（`FIXED_BUDGET`：墙钟 = 无穷）→ 结果与机器、与 CPU 争用无关，可安全断言。
 * 夹具含既有 11 个平衡夹具 + 13 个追加形状（链 / 并行 / 里程碑 / manual / 约束 /
 * 各依赖类型与 lag / 资源可用期 / backward / alap / fixedEffort / 基线挣值 / 日历例外 /
 * 宽争用）。
 */
import { readFileSync } from 'node:fs'
import { URL as NodeURL, fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FIXTURES, runFixtures } from './result.differential.fixtures'

const GOLDEN_PATH = fileURLToPath(
  new NodeURL('./result.differential.golden.json', import.meta.url),
)
const GOLDEN = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as Record<string, unknown>

// 夹具只跑一次，各用例共享同一份实际输出。
const ACTUAL = runFixtures()

describe('全量差分：逐字节复现 HEAD 冻结输出（整份 ScheduleResult 不许变）', () => {
  for (const fixture of FIXTURES) {
    // 显式超时：同 leveling.differential.test.ts，规避并行套件下的缺省 5s 闸门误红。
    it(
      fixture.name,
      () => {
        expect(ACTUAL[fixture.name]).toEqual(GOLDEN[fixture.name])
      },
      60_000,
    )
  }

  it('黄金文件覆盖全部夹具（防止新增夹具未冻结、静默漏测）', () => {
    expect(Object.keys(GOLDEN).sort()).toEqual(FIXTURES.map((f) => f.name).sort())
  })
})
