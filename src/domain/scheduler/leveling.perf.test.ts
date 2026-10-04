/**
 * 资源平衡的性能回归（v0.7 修复的护栏）。
 *
 * 背景：旧实现「每轮推 1 个工作日 + 每轮全量重算负载与正推」，迭代数 ∝ 需推迟的
 * **任务-日**总数，总代价 ≈ n³ —— 500 叶子 / 15 资源 / 高争用要**数分钟**同步阻塞
 * 主线程，浏览器假死。纯 CPM 近线性（400 叶子 ~80ms），瓶颈全在平衡。
 *
 * ── 为什么主断言是**迭代次数**而不是墙钟 ────────────────────────────────
 * 第一版用墙钟（`elapsed < 8000ms`）做主断言，结果**在并行跑的全量套件里偶发变红**：
 * vitest 同时跑多个测试文件，CPU 争用会把墙钟抬高数倍。靠墙钟做回归，等于训练人忽略红色。
 * 改成断言 `iterations`：与机器无关、确定、且**直指病根** —— 旧实现的迭代数 ∝ 任务-日
 * 总数（~10⁵），新实现 O(叶子数)（500 叶子实测 806）。退回 n³ 必然先在这里爆掉。
 * 墙钟只留作「没有卡死」的粗筛，界放得很宽，只抓灾难性退化。
 *
 * 复刻线上大计划的结构：M 个模块 × 5 阶段 × 每阶段 1~2 个并行段 = 25 叶子/模块，
 * 资源按轮转分配（高争用密度）。
 */
import { describe, it, expect } from 'vitest'
import {
  createAssignment,
  createDependency,
  createProject,
  createResource,
  createTask,
} from '../model/factories'
import type { Project } from '../model/types'
import { solve } from './index'

const PHASES: { stages: string[][] }[] = [
  { stages: [['需求调研'], ['需求分析'], ['需求文档'], ['需求评审', '需求变更确认']] },
  { stages: [['概要设计'], ['详细设计'], ['数据库设计', '接口设计'], ['设计评审']] },
  { stages: [['数据模型'], ['后端开发', '前端开发'], ['接口联调'], ['开发自测']] },
  { stages: [['用例设计'], ['功能测试', '集成测试'], ['性能验证'], ['缺陷修复与回归']] },
  { stages: [['部署配置'], ['数据迁移'], ['灰度发布'], ['用户验收', '上线归档']] },
]

/** M 个模块（每个 25 个叶子任务）、R 个资源（R=0 表示不分配资源 = 纯 CPM 基线） */
function build(M: number, R: number): Project {
  const project = createProject('perf', '2026-10-05')
  const resIds: string[] = []
  for (let i = 0; i < R; i++) {
    const r = createResource({ name: 'R' + i })
    project.resources[r.id] = r
    resIds.push(r.id)
  }

  const add = (name: string, parentId: string | null): ReturnType<typeof createTask> => {
    const t = createTask({ name, parentId, duration: 1 })
    project.tasks[t.id] = t
    if (parentId) project.tasks[parentId].childIds.push(t.id)
    else project.rootIds.push(t.id)
    return t
  }
  const link = (a: { id: string }, b: { id: string }) => {
    const d = createDependency(a.id, b.id)
    project.dependencies[d.id] = d
  }

  let seq = 0
  for (let mi = 0; mi < M; mi++) {
    const mod = add('模块' + mi, null)
    let prevStage: ReturnType<typeof createTask>[] | null = null
    PHASES.forEach((phase, pi) => {
      const g = add('阶段' + pi, mod.id)
      let prev = prevStage
      phase.stages.forEach((stage, si) => {
        const made = stage.map((n, bi) => {
          const t = add(n, g.id)
          t.duration = 1 + ((pi * 2 + si + bi) % 4) + (mi % 5)
          if (R > 0) {
            const a = createAssignment({ taskId: t.id, resourceId: resIds[seq % R], units: 1 })
            project.assignments[a.id] = a
          }
          seq++
          return t
        })
        if (prev) prev.forEach((p) => made.forEach((m) => link(p, m)))
        prev = made
      })
      prevStage = prev
    })
  }
  return project
}

/**
 * 迭代次数的上限，按**叶子数**表达（与规模成比例，不写死魔数）。
 * 修复后 500 叶子实测 **806** 次；旧实现是 ~10⁵ 量级（∝ 任务-日总数）。
 * 取 4× 叶子数 = 2000：比实测宽 2.5 倍（给启发式顺序的合理波动），
 * 但比旧实现小 ~50 倍 —— n³ 一退回来就必然变红。
 */
const MAX_ITERATIONS_PER_LEAF = 4

/** 墙钟粗筛（毫秒）：只抓「又变成分钟级」的灾难性退化，不参与精细判定 */
const SMOKE_BOUND_MS = 60_000

describe('资源平衡性能回归（500 叶子 × 15 资源 高争用）', () => {
  it('迭代数保持与叶子数同阶（旧实现 ∝ 任务-日 → 会红）', () => {
    const project = build(20, 15) // 20 模块 × 25 = 500 叶子
    const leaves = Object.values(project.tasks).filter((t) => t.childIds.length === 0)
    expect(leaves.length).toBe(500)

    // **显式给预算**：缺省预算的 `maxElapsedMs` 是墙钟（4s），而 vitest 并行跑多个文件时
    // CPU 争用会把 solve() 拖过 4s → 预算触发 → 结果随负载变化（第一版就是这么偶发红的）。
    // 这里把墙钟放到无穷、只留一个**宽松的迭代上限**：收敛路径（实测 806 次）远在其内，
    // 而退回 n³（~10⁵ 次）会先撞上限并置 budgetExhausted=true —— 两条断言同时变红。
    const started = Date.now()
    const result = solve(project, { maxIterations: 5000, maxElapsedMs: Number.POSITIVE_INFINITY })
    const elapsed = Date.now() - started

    // 主断言：确定性、与机器无关，直接锁住「不能再退回逐日推进」
    const iterations = result.leveling.iterations ?? 0
    expect(iterations, '迭代数为 0 说明根本没在平衡（空跑/退化成恒等）').toBeGreaterThan(0)
    expect(
      iterations,
      `迭代数 ${iterations} 超过 ${MAX_ITERATIONS_PER_LEAF}×叶子数 —— 疑似退回「逐日推进」（旧实现 ∝ 任务-日总数）`,
    ).toBeLessThanOrEqual(MAX_ITERATIONS_PER_LEAF * leaves.length)
    // 预算已显式给定（墙钟 = 无穷），所以这一条**与机器速度无关**：收敛就该是 false。
    expect(result.leveling.budgetExhausted, '本规模应在给定的迭代预算内收敛，不该截断').toBeFalsy()

    // 粗筛：没有卡死
    expect(elapsed).toBeLessThan(SMOKE_BOUND_MS)
    expect(Object.keys(result.schedules).length).toBeGreaterThanOrEqual(500)
    // **显式超时**：本用例是整个套件里最重的一个（500 叶子 × 15 资源）。
    // vitest 默认的 5s 超时是一道**墙钟闸门**，与上面声明的 `SMOKE_BOUND_MS = 60s`
    // 直接矛盾 —— 并行跑套件时 CPU 争用会把单次 solve 拖到 5s 以上，于是测试以
    // 「Test timed out in 5000ms」偶发变红（1/3 量级），而断言本身全是确定性的。
    // 放宽到比粗筛界更宽，让真正的判据是断言而非默认超时。
  }, SMOKE_BOUND_MS + 30_000)
})
