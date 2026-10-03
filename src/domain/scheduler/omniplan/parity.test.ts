import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
// 用 Node 的 URL 而非全局 URL：测试跑在 jsdom 环境里，jsdom 会替换全局 `URL`，
// 它会把 `file://` 基准解析成 `http://localhost:3000/...`，导致 fileURLToPath 报
// 「The URL must be of scheme file」。
import { URL as NodeURL, fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { solve } from '..'
import type { Project } from '../../model/types'

/**
 * OmniPlan 真实文件 parity 回归（Task 6）。
 *
 * 每个 fixture = 一个真实 `.oplx` 的导入结果（`project`）+ OmniPlan 自己排出的
 * 开始日（`expected`，取自 `leveled-start`）。断言 `solve(project)` 的
 * `scheduledStart` 与 `expected` 逐任务相等。
 *
 * **断言范围 = fixture `_meta.qualifyingTaskIds`**，该子集用**不依赖本引擎输出**的
 * 判据（P3，见 `_meta.predicate`）在生成时选定：整数天 effort ∧ 有 leveled-start
 * ∧ 该任务任一资源上无其它任务窗口重叠（窗口取自从 `.oplx` 独立重算的**未平衡**
 * 正推 CPM）。只有这种「平衡对该任务无影响」的情况下，OmniPlan 的 `leveled-start`
 * 才应等于纯 CPM 起点，断言才有意义。摘要 / 里程碑天然不在集合内（只收叶子）。
 *
 * **为什么这么薄**：本 corpus 缓存的 `leveled-start` **不可信** —— 数据一致性屏
 * 显示，37 个文件里 7 个含「无分配 / 无依赖 / 无晚于项目起点的约束」的叶子任务，
 * 其中 4 个有 `leveled-start` 可比，而**这 4 个里的每一个可比任务都与本文件
 * `<start-date>` 矛盾**（陈旧缓存或未建模的 OmniPlan 机制）。故只保留「源数据自洽、
 * 且 leveling 不可能介入」的断言（当前共 3 条）。
 * **⚠️ 这张网只覆盖约束下界的处理**：这些任务被预筛到「独立 Python CPM 已一致且
 * leveling 可证不可能介入」，所以它们**不覆盖依赖传播、不覆盖资源平衡，也不会抓到
 * Ruling 6 那类缺陷**。**全量 `leveled-start` parity 明确移交子项目 3（资源平衡）**。
 * 逐条排除原因见各 fixture 的 `_meta.skipped` 与 `_meta.deferredNote`。
 *
 * fixture 进仓库（本仓库即用户私有，任务标题原样保留），故本回归**可复现、无
 * iCloud 依赖**。重新生成用 `scripts/omniplanParity.py`（`_meta.command` 原样可跑；
 * 除 `createdAt` / `updatedAt` 外逐字节可复现）。
 */
const FIXTURES_DIR = fileURLToPath(new NodeURL('./fixtures', import.meta.url))

interface FixtureMeta {
  source: string
  command: string
  predicate: string
  counts: { leafTasks: number; dependencies: number; p1Qualifying: number; p3Qualifying: number }
  qualifyingTaskIds: string[]
}

interface Fixture {
  _meta: FixtureMeta
  project: Project
  expected: Record<string, string>
}

const fixtureFiles = readdirSync(FIXTURES_DIR)
  .filter((f) => f.endsWith('.parity.json'))
  .sort()

describe('OmniPlan parity（真实文件对照）', () => {
  it('至少装载一个 fixture', () => {
    expect(fixtureFiles.length).toBeGreaterThan(0)
  })

  for (const file of fixtureFiles) {
    const fixture: Fixture = JSON.parse(readFileSync(join(FIXTURES_DIR, file), 'utf8'))
    const { qualifyingTaskIds } = fixture._meta

    describe(`${file}（源 ${fixture._meta.source}）`, () => {
      const result = solve(fixture.project)

      it('合格子集非空，且每个合格任务是叶子（摘要 / 里程碑天然排除）', () => {
        expect(qualifyingTaskIds.length).toBeGreaterThan(0)
        for (const id of qualifyingTaskIds) {
          expect(fixture.project.tasks[id]?.kind).toBe('task')
        }
      })

      for (const id of qualifyingTaskIds) {
        it(`${id} scheduledStart === expected（${fixture.expected[id]}）`, () => {
          expect(result.schedules[id]?.scheduledStart).toBe(fixture.expected[id])
        })
      }
    })
  }
})
