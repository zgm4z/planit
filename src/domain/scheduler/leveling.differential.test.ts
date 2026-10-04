/**
 * 差分测试：改动后的实现必须**逐字节复现**改动前 HEAD 在夹具上的真实输出。
 *
 * 黄金数据 `leveling.differential.golden.json` 是在本次改动**之前**、由 HEAD 的真实
 * `solve()` 跑出来的（生成脚本一次性地把结果冻成 JSON，用完即弃）。这里**只读数据**，
 * 不留第二份源码实现 —— 复制一份 `leveling.ts` 当参照物，两份会各自漂移，正是要避免的。
 *
 * 覆盖 `dates` / `delays` / `unresolved` / `iterations` / `budgetExhausted` 五项。
 * 预算固定（`FIXED_BUDGET`：墙钟 = 无穷）→ 结果与机器、与 CPU 争用无关，可安全断言。
 */
import { readFileSync } from 'node:fs'
import { URL as NodeURL, fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FIXTURES, runFixtures, type Snapshot } from './leveling.differential.fixtures'

const GOLDEN_PATH = fileURLToPath(
  new NodeURL('./leveling.differential.golden.json', import.meta.url),
)
const GOLDEN = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as Record<string, Snapshot>

// 夹具只跑一次，各用例共享同一份实际输出。
const ACTUAL = runFixtures()

describe('差分：逐字节复现 HEAD 冻结输出（结果不许变）', () => {
  for (const fixture of FIXTURES) {
    // 显式超时：同 leveling.incremental.test.ts，规避并行套件下的缺省 5s 闸门误红。
    it(
      fixture.name,
      () => {
        expect(ACTUAL[fixture.name]).toEqual(GOLDEN[fixture.name])
      },
      30_000,
    )
  }

  it('黄金文件覆盖全部夹具（防止新增夹具未冻结、静默漏测）', () => {
    expect(Object.keys(GOLDEN).sort()).toEqual(FIXTURES.map((f) => f.name).sort())
  })
})
