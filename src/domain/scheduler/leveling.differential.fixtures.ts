/**
 * 差分测试的夹具与快照器（**测试支撑**，不进应用包）。
 *
 * 目的：把「改动前 HEAD 的真实输出」冻成 JSON 黄金文件（见同目录
 * `leveling.differential.golden.json`），改动后逐字节复现。**只冻结数据**，
 * 不留第二份源码实现 —— 复制一份 `leveling.ts` 当参照物，两者会各自漂移，
 * 正是要避免的。
 *
 * 快照口径**必须机器无关**：显式传 `maxElapsedMs: Infinity`（缺省是墙钟，
 * 会在慢机器上截断 → 输出随负载变化）。这样 `iterations` / `delays` / `dates`
 * 在任意机器上都是确定值。
 */
import {
  __resetIdCounterForTests,
  createAssignment,
  createDependency,
  createProject,
  createResource,
  createTask,
} from '../model/factories'
import type { Project, ResourceId, Task, TaskId } from '../model/types'
import { solve } from './index'

const START = '2026-03-02'

/** 黄金生成与断言共用的预算：墙钟无穷 → 结果确定、与机器无关 */
export const FIXED_BUDGET = {
  maxIterations: 200_000,
  maxElapsedMs: Number.POSITIVE_INFINITY,
} as const

export interface Fixture {
  readonly name: string
  /** 每次调用前 harness 会重置 id 计数器 → 生成的 id 可复现 */
  readonly build: () => Project
}

/** 快照：只保留与平衡结果相关的确定性字段 */
export interface Snapshot {
  readonly iterations: number
  readonly budgetExhausted: boolean
  readonly delays: Record<TaskId, number>
  readonly unresolved: { readonly resourceId: ResourceId; readonly date: string; readonly load: number }[]
  readonly leaves: Record<TaskId, readonly [string, string]>
}

function sortedRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

export function snapshot(project: Project): Snapshot {
  const result = solve(project, FIXED_BUDGET)
  const leaves: Record<TaskId, [string, string]> = {}
  const leafIds = Object.values(project.tasks)
    .filter((task) => task.childIds.length === 0)
    .map((task) => task.id)
    .sort()
  for (const id of leafIds) {
    const schedule = result.schedules[id]
    leaves[id] = [schedule.scheduledStart, schedule.scheduledFinish]
  }
  return {
    iterations: result.leveling.iterations ?? 0,
    budgetExhausted: result.leveling.budgetExhausted ?? false,
    delays: sortedRecord(result.leveling.delays),
    unresolved: result.leveling.unresolved,
    leaves,
  }
}

// ── 小型手搭夹具（复刻 leveling.test.ts / leveling.golden.test.ts 的场景）─────────

/** A、B 共用资源 R，C 独立且长（撑浮时）。返回 project 与各任务 id */
function sharedResource(build?: (project: Project, ids: { a: Task; b: Task; c: Task; r: string }) => void) {
  return (): Project => {
    const project = createProject('差分', START)
    const a = createTask({ name: 'A', duration: 2 })
    const b = createTask({ name: 'B', duration: 2 })
    const c = createTask({ name: 'C', duration: 6 })
    const r = createResource({ name: 'R' })
    for (const task of [a, b, c]) {
      project.tasks[task.id] = task
      project.rootIds.push(task.id)
    }
    project.resources[r.id] = r
    for (const task of [a, b]) {
      const assignment = createAssignment({ taskId: task.id, resourceId: r.id, units: 1 })
      project.assignments[assignment.id] = assignment
    }
    build?.(project, { a, b, c, r: r.id })
    return project
  }
}

/** manual 单日区间 → slack=0，设计上不可推 */
function pin(task: Task, date: string): Task {
  return { ...task, scheduling: { mode: 'manual', start: date, finish: date } }
}

/** 生成大计划：M 模块 × 25 叶子，资源按轮转分配（高争用）。与 perf 回归同构 */
function generatePlan(M: number, R: number): () => Project {
  const PHASES: string[][][] = [
    [['需求调研'], ['需求分析'], ['需求文档'], ['需求评审', '需求变更确认']],
    [['概要设计'], ['详细设计'], ['数据库设计', '接口设计'], ['设计评审']],
    [['数据模型'], ['后端开发', '前端开发'], ['接口联调'], ['开发自测']],
    [['用例设计'], ['功能测试', '集成测试'], ['性能验证'], ['缺陷修复与回归']],
    [['部署配置'], ['数据迁移'], ['灰度发布'], ['用户验收', '上线归档']],
  ]
  return () => {
    const project = createProject('差分大计划', '2026-10-05')
    const resIds: string[] = []
    for (let i = 0; i < R; i++) {
      const r = createResource({ name: 'R' + i })
      project.resources[r.id] = r
      resIds.push(r.id)
    }
    const add = (name: string, parentId: string | null): Task => {
      const t = createTask({ name, parentId, duration: 1 })
      project.tasks[t.id] = t
      if (parentId) project.tasks[parentId].childIds.push(t.id)
      else project.rootIds.push(t.id)
      return t
    }
    const link = (a: { id: string }, b: { id: string }): void => {
      const d = createDependency(a.id, b.id)
      project.dependencies[d.id] = d
    }
    let seq = 0
    for (let mi = 0; mi < M; mi++) {
      const mod = add('模块' + mi, null)
      let prevStage: Task[] | null = null
      PHASES.forEach((phase, pi) => {
        const g = add('阶段' + pi, mod.id)
        let prev = prevStage
        phase.forEach((stage, si) => {
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
}

export const FIXTURES: readonly Fixture[] = [
  { name: 'shared-resource', build: sharedResource() },
  {
    name: 'priority',
    build: sharedResource((p, { a, b }) => {
      p.tasks[a.id] = { ...a, priority: 5 }
      p.tasks[b.id] = { ...b, priority: 0 }
    }),
  },
  {
    name: 'user-delay',
    build: sharedResource((p, { a }) => {
      p.tasks[a.id] = { ...a, delay: 2 }
    }),
  },
  {
    name: 'dependency-cascade',
    build: (): Project => {
      const project = createProject('依赖', START)
      const a = createTask({ name: 'A', duration: 2 })
      const b = createTask({ name: 'B', duration: 2 })
      const d = createTask({ name: 'D', duration: 2 })
      const c = createTask({ name: 'C', duration: 8 })
      for (const task of [a, b, d, c]) {
        project.tasks[task.id] = task
        project.rootIds.push(task.id)
      }
      const dep = createDependency(a.id, b.id)
      project.dependencies[dep.id] = dep
      const r = createResource({ name: 'R' })
      project.resources[r.id] = r
      for (const task of [a, d]) {
        const assignment = createAssignment({ taskId: task.id, resourceId: r.id, units: 1 })
        project.assignments[assignment.id] = assignment
      }
      return project
    },
  },
  {
    name: 'frozen-regression',
    build: (): Project => {
      const project = createProject('冻结回归', START)
      const r = createResource({ name: 'R' })
      project.resources[r.id] = r
      const m = createTask({ name: 'M', duration: 1 })
      const z0 = pin(createTask({ name: 'Z0', duration: 1 }), '2026-03-02')
      const z1 = pin(createTask({ name: 'Z1', duration: 1 }), '2026-03-03')
      const z2 = pin(createTask({ name: 'Z2', duration: 1 }), '2026-03-04')
      const a = pin(createTask({ name: 'A', duration: 1 }), '2026-03-05')
      const b = pin(createTask({ name: 'B', duration: 1 }), '2026-03-05')
      const s = createTask({ name: 'S', duration: 12 })
      for (const task of [m, z0, z1, z2, a, b, s]) {
        project.tasks[task.id] = task
        project.rootIds.push(task.id)
      }
      const unitsOf: [Task, number][] = [
        [m, 1],
        [z0, 0.5],
        [z1, 0.5],
        [z2, 0.5],
        [a, 1],
        [b, 1],
      ]
      for (const [task, units] of unitsOf) {
        const assignment = createAssignment({ taskId: task.id, resourceId: r.id, units })
        project.assignments[assignment.id] = assignment
      }
      return project
    },
  },
  {
    name: 'mixed-units-resources',
    build: (): Project => {
      const project = createProject('混合单位', START)
      const r1 = createResource({ name: 'R1' })
      const r2 = { ...createResource({ name: 'R2' }), availability: 0.5, efficiency: 2 }
      project.resources[r1.id] = r1
      project.resources[r2.id] = r2
      const tasks = [
        createTask({ name: 'T1', duration: 3 }),
        createTask({ name: 'T2', duration: 4 }),
        createTask({ name: 'T3', duration: 2 }),
      ]
      for (const t of tasks) {
        project.tasks[t.id] = t
        project.rootIds.push(t.id)
      }
      const specs: [Task, string, number][] = [
        [tasks[0], r1.id, 1],
        [tasks[1], r1.id, 0.5],
        [tasks[1], r2.id, 0.5],
        [tasks[2], r2.id, 1],
      ]
      for (const [task, resourceId, units] of specs) {
        const assignment = createAssignment({ taskId: task.id, resourceId, units })
        project.assignments[assignment.id] = assignment
      }
      return project
    },
  },
  {
    name: 'transient-cell-decay',
    build: (): Project => {
      // A(dur3, 03-02..03-04) 与**钉死在 03-04** 的 B 在该日相撞（负载 2，B 用 manual 单日区间
      // 固定在 A 的末日，而非默认的 ASAP 起点）。A 的最早可行槽位只能落在 03-05 之后
      // （03-03/03-04 与旧区间重叠 → 不可行）：旧区间里的 03-02、03-03 上再无他人，
      // **直接归 0**，增量必须删除这两个日键。这正是 `bump` 的 `newValue <= 0` 删除路径
      // （改成 `< 0` 会残留 0 键 → 键集漂移）。**小而可读**，不依赖大生成夹具。
      // S（dur8、无分配）只为撑出 A 的浮时。
      const project = createProject('瞬态归零', START)
      const r = createResource({ name: 'R' })
      project.resources[r.id] = r
      const a = createTask({ name: 'A', duration: 3 })
      const b = pin(createTask({ name: 'B', duration: 1 }), '2026-03-04')
      const s = createTask({ name: 'S', duration: 8 })
      for (const task of [a, b, s]) {
        project.tasks[task.id] = task
        project.rootIds.push(task.id)
      }
      for (const task of [a, b]) {
        const assignment = createAssignment({ taskId: task.id, resourceId: r.id, units: 1 })
        project.assignments[assignment.id] = assignment
      }
      return project
    },
  },
  {
    name: 'fractional-units',
    build: (): Project => {
      // 三个 0.7 单位任务同占一天 → 2.1。推走一个后该格 = 1.4：增量算得
      // 2.1 − 0.7 = 1.3999999999999997，全量重建算得 0.7 + 0.7 = 1.4 —— 二进制不可精确
      // 表示的单位的经典尾差。**永久回归**：不变量测试的值比较用相对容差（见
      // leveling.incremental.test.ts），只做精确相等会在这里假红，而输出其实不变。
      const project = createProject('非二分数单位', START)
      const r = createResource({ name: 'R' })
      project.resources[r.id] = r
      const tasks = [
        createTask({ name: 'A', duration: 1 }),
        createTask({ name: 'B', duration: 1 }),
        createTask({ name: 'C', duration: 1 }),
      ]
      const s = createTask({ name: 'S', duration: 8 })
      for (const task of [...tasks, s]) {
        project.tasks[task.id] = task
        project.rootIds.push(task.id)
      }
      for (const task of tasks) {
        const assignment = createAssignment({ taskId: task.id, resourceId: r.id, units: 0.7 })
        project.assignments[assignment.id] = assignment
      }
      return project
    },
  },
  { name: 'gen-m3-r0', build: generatePlan(3, 0) },
  { name: 'gen-m4-r3', build: generatePlan(4, 3) },
  { name: 'gen-m6-r15', build: generatePlan(6, 15) },
]

/** 逐夹具重置 id 计数器后取快照 → 供生成器与断言共同消费 */
export function runFixtures(): Record<string, Snapshot> {
  const out: Record<string, Snapshot> = {}
  for (const fixture of FIXTURES) {
    __resetIdCounterForTests()
    out[fixture.name] = snapshot(fixture.build())
  }
  return out
}
