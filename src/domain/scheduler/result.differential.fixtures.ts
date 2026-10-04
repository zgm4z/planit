/**
 * 全量 `ScheduleResult` 差分测试的夹具与快照器（**测试支撑**，不进应用包）。
 *
 * 目的：把「本改动之前 HEAD 的真实 `solve()` 输出」冻成 JSON 黄金文件
 * （见同目录 `result.differential.golden.json`），改动后逐字节复现**每一个字段**
 * —— schedules（含每叶子的 early/late/scheduled/slack/conflictBinding）、
 * conflicts、leveling（delays/unresolved/iterations）、efforts、costs、
 * resourceTotals、earnedValues、baselineDiffs。
 *
 * 与 `leveling.differential.fixtures.ts` 的关系：那份是「资源平衡增量」那一版的守卫，
 * 只冻结平衡相关的五个量；本份把**同一个思路**（只冻数据、不留第二份实现）扩展到
 * 整个 `ScheduleResult`，并复用它的 11 个夹具 + 追加更多形状（链 / 并行分支 /
 * 里程碑 / manual / 各约束 / 各依赖类型与 lag / 资源可用期 / backward / alap /
 * fixedEffort / 基线 + 挣值）。
 *
 * 快照口径**必须机器无关**：显式传 `maxElapsedMs: Infinity`（缺省是墙钟，会在慢机器上
 * 截断 → 输出随负载变化）。这样 iterations / 日期 / delays 在任意机器上都是确定值。
 */
import {
  __resetIdCounterForTests,
  createAssignment,
  createDependency,
  createProject,
  createResource,
  createTask,
} from '../model/factories'
import type { Calendar, Project, Task } from '../model/types'
import { solve } from './index'
import { FIXTURES as LEVELING_FIXTURES } from './leveling.differential.fixtures'

const START = '2026-03-02'

/** 墙钟无穷 → 结果确定、与机器无关（与 leveling 差分同口径） */
export const FIXED_BUDGET = {
  maxIterations: 200_000,
  maxElapsedMs: Number.POSITIVE_INFINITY,
} as const

export interface Fixture {
  readonly name: string
  /** 每次调用前 harness 会重置 id 计数器 → 生成的 id 可复现 */
  readonly build: () => Project
}

/**
 * 递归规范化：普通对象的键按字典序排序后重建，数组保持原序。
 * 目的只是让 JSON 黄金稳定（对象键序无语义）；语义敏感的**数组**（conflicts、
 * unresolved）顺序原样保留 —— 那才是行为的一部分。
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key])
    }
    return out
  }
  return value
}

/** 整个 `ScheduleResult` 的确定性快照（全字段，键序规范） */
export function snapshotFull(project: Project): unknown {
  const result = solve(project, FIXED_BUDGET)
  return canonicalize({
    schedules: result.schedules,
    conflicts: result.conflicts,
    efforts: result.efforts,
    costs: result.costs,
    resourceTotals: result.resourceTotals,
    leveling: result.leveling,
    earnedValues: result.earnedValues,
    baselineDiffs: result.baselineDiffs,
  })
}

// ── 小型手搭工具 ────────────────────────────────────────────────────────────

function addTasks(project: Project, tasks: Task[]): void {
  for (const task of tasks) {
    project.tasks[task.id] = task
    project.rootIds.push(task.id)
  }
}

function link(
  project: Project,
  from: string,
  to: string,
  type: 'FS' | 'SS' | 'FF' | 'SF' = 'FS',
  lag?: Parameters<typeof createDependency>[3],
): void {
  const dep = createDependency(from, to, type, lag)
  project.dependencies[dep.id] = dep
}

function assign(project: Project, taskId: string, resourceId: string, units: number): void {
  const a = createAssignment({ taskId, resourceId, units })
  project.assignments[a.id] = a
}

function auto(name: string, duration: number): Task {
  return createTask({ name, duration })
}

/** 给项目挂一条基线（覆盖部分叶子）并设基准日 */
function withBaseline(
  project: Project,
  entryFor: (task: Task, index: number) => { start: string; finish: string } | null,
  statusDate: string,
): void {
  const entries: Record<string, { name: string; start: string; finish: string }> = {}
  const leaves = Object.values(project.tasks).filter((t) => t.childIds.length === 0)
  leaves.forEach((task, i) => {
    const e = entryFor(task, i)
    if (e) entries[task.id] = { name: task.name, start: e.start, finish: e.finish }
  })
  project.baselines = [{ id: 'baseline_1', name: '基线', createdAt: '2026-03-01T00:00', entries }]
  project.activeBaselineId = 'baseline_1'
  project.statusDate = statusDate
}

// ── 追加夹具 ────────────────────────────────────────────────────────────────

/** 长链：A→B→C→D→E（FS），工期递增 */
function fsChain(): () => Project {
  return () => {
    const project = createProject('链', START)
    const tasks = [2, 3, 1, 4, 2].map((d, i) => auto('T' + i, d))
    addTasks(project, tasks)
    for (let i = 0; i + 1 < tasks.length; i++) link(project, tasks[i].id, tasks[i + 1].id)
    return project
  }
}

/** 并行分支汇入 join，外加里程碑 */
function parallelJoin(): () => Project {
  return () => {
    const project = createProject('并行', START)
    const root = auto('开始', 1)
    const a = auto('分支A', 3)
    const b = auto('分支B', 5)
    const c = auto('分支C', 2)
    const join = auto('汇合', 4)
    const m = createTask({ name: '里程碑', kind: 'milestone' })
    addTasks(project, [root, a, b, c, join, m])
    for (const branch of [a, b, c]) {
      link(project, root.id, branch.id)
      link(project, branch.id, join.id)
    }
    link(project, join.id, m.id)
    return project
  }
}

/** 四种依赖类型 + 三种 lag 单位 */
function depTypesLags(): () => Project {
  return () => {
    const project = createProject('依赖类型', START)
    const a = auto('A', 4)
    const b = auto('B', 3)
    const c = auto('C', 2)
    const d = auto('D', 5)
    const e = auto('E', 2)
    addTasks(project, [a, b, c, d, e])
    link(project, a.id, b.id, 'FS', { kind: 'workdays', days: 2 })
    link(project, a.id, c.id, 'SS', { kind: 'percent', value: 50 })
    link(project, b.id, d.id, 'FF', { kind: 'elapsedDays', days: 3 })
    link(project, c.id, e.id, 'SF', { kind: 'workdays', days: 1 })
    return project
  }
}

/** 四种排期约束 */
function constraints(): () => Project {
  return () => {
    const project = createProject('约束', START)
    const a = auto('A', 3)
    const b = auto('B', 2)
    const c = auto('C', 4)
    const d = auto('D', 2)
    addTasks(project, [a, b, c, d])
    project.tasks[a.id] = {
      ...a,
      scheduling: { mode: 'auto', startConstraint: { type: 'startNoEarlierThan', date: '2026-03-10T09:00' } },
    }
    project.tasks[b.id] = {
      ...b,
      scheduling: { mode: 'auto', finishConstraint: { type: 'finishNoLaterThan', date: '2026-03-06T18:00' } },
    }
    project.tasks[c.id] = {
      ...c,
      scheduling: { mode: 'auto', startConstraint: { type: 'startNoLaterThan', date: '2026-03-05T09:00' } },
    }
    project.tasks[d.id] = {
      ...d,
      scheduling: { mode: 'auto', finishConstraint: { type: 'finishNoEarlierThan', date: '2026-03-04T18:00' } },
    }
    // 让 b 的 finishNoLaterThan 与 c 的下界冲突 → 负浮时 / conflict
    link(project, c.id, b.id)
    return project
  }
}

/** 里程碑 + manual 钉死 + 顶住前驱 → conflictBinding（dependencyViolation） */
function manualConflict(): () => Project {
  return () => {
    const project = createProject('manual冲突', START)
    const a = auto('A', 4)
    const b = auto('B', 3)
    const pinned = createTask({ name: 'P', duration: 1 })
    addTasks(project, [a, b, pinned])
    project.tasks[pinned.id] = {
      ...pinned,
      scheduling: { mode: 'manual', start: '2026-03-03T09:00', finish: '2026-03-03T18:00' },
    }
    // A(4天，从 03-02 起最早 03-05 完成) 被钉在 03-03 的 P 顶住 → 负浮时
    link(project, a.id, pinned.id, 'FS')
    link(project, a.id, b.id, 'FS')
    return project
  }
}

/** 资源争用 + 优先级 + 用户 delay */
function resourceContention(): () => Project {
  return () => {
    const project = createProject('争用', START)
    const r = createResource({ name: 'R' })
    project.resources[r.id] = r
    const a = auto('A', 3)
    const b = auto('B', 4)
    const c = auto('C', 2)
    const s = auto('S', 10) // 撑浮时
    addTasks(project, [a, b, c, s])
    assign(project, a.id, r.id, 1)
    assign(project, b.id, r.id, 1)
    assign(project, c.id, r.id, 0.5)
    project.tasks[a.id] = { ...a, priority: 7 }
    project.tasks[b.id] = { ...b, priority: 1, delay: 1 }
    return project
  }
}

/** 资源可用期窗口（availableFrom / availableUntil）+ 资源日历字段 */
function resourceWindows(): () => Project {
  return () => {
    const project = createProject('可用期', START)
    const r = createResource({ name: 'R' })
    r.availableFrom = '2026-03-05T00:00'
    r.availableUntil = '2026-03-20T23:59'
    r.efficiency = 1.5
    project.resources[r.id] = r
    const a = auto('A', 2)
    const b = auto('B', 6)
    addTasks(project, [a, b])
    assign(project, a.id, r.id, 1)
    assign(project, b.id, r.id, 1)
    return project
  }
}

/** backward 方向 + endDate 锚点 */
function backwardDirection(): () => Project {
  return () => {
    const project = createProject('逆推', START)
    project.schedulingDirection = 'backward'
    project.endDate = '2026-03-20T18:00'
    const a = auto('A', 3)
    const b = auto('B', 5)
    const c = auto('C', 2)
    addTasks(project, [a, b, c])
    link(project, a.id, b.id)
    link(project, b.id, c.id)
    return project
  }
}

/** alap（尽量晚做）+ 关键路径 */
function alapOrder(): () => Project {
  return () => {
    const project = createProject('alap', START)
    project.endDate = '2026-03-16T18:00'
    const a = auto('A', 2)
    const b = auto('B', 3)
    const c = auto('C', 2)
    addTasks(project, [a, b, c])
    link(project, a.id, b.id)
    link(project, b.id, c.id)
    project.tasks[b.id] = { ...b, schedulingOrder: 'alap' }
    return project
  }
}

/** fixedEffort：工期由 effort / Σunits 反解 */
function fixedEffort(): () => Project {
  return () => {
    const project = createProject('fixedEffort', START)
    const r = createResource({ name: 'R' })
    project.resources[r.id] = r
    const a = createTask({ name: 'A', effortMode: 'fixedEffort', effort: 10 })
    const b = createTask({ name: 'B', effortMode: 'fixedEffort', effort: 7 })
    const c = auto('C', 3)
    addTasks(project, [a, b, c])
    assign(project, a.id, r.id, 1)
    assign(project, b.id, r.id, 0.5)
    return project
  }
}

/** 嵌套分组树 + 资源成本（usage/hourly）+ 基线 + 基准日 + progress → 全派生字段非平凡 */
function baselineEarned(): () => Project {
  return () => {
    const project = createProject('挣值', START)
    const r1 = createResource({ name: 'R1' })
    r1.cost = { currency: 'CNY', usage: 100, hourly: 50 }
    const r2 = createResource({ name: 'R2' })
    r2.cost = { currency: 'CNY', usage: 0, hourly: 80 }
    project.resources[r1.id] = r1
    project.resources[r2.id] = r2

    const group = createTask({ name: '分组', kind: 'group' })
    project.tasks[group.id] = group
    project.rootIds.push(group.id)

    const a = createTask({ name: 'A', parentId: group.id, duration: 3, effortMode: 'fixedEffort', effort: 6 })
    const b = createTask({ name: 'B', parentId: group.id, duration: 4 })
    const c = createTask({ name: 'C', duration: 2 })
    for (const t of [a, b, c]) project.tasks[t.id] = t
    group.childIds.push(a.id, b.id)
    project.rootIds.push(c.id)

    assign(project, a.id, r1.id, 1)
    assign(project, b.id, r2.id, 1)
    assign(project, c.id, r1.id, 0.5)

    project.tasks[a.id] = { ...a, progress: 40 }
    project.tasks[b.id] = { ...b, progress: 75 }
    project.tasks[c.id] = { ...c, progress: 10 }

    link(project, a.id, b.id)
    link(project, b.id, c.id)

    withBaseline(
      project,
      (task, i) =>
        task.id === c.id ? null : { start: '2026-03-02', finish: i % 2 === 0 ? '2026-03-04' : '2026-03-05' },
      '2026-03-06T18:00',
    )
    return project
  }
}

/** 自定义日历例外（holiday）+ 非默认工作周 */
function calendarExceptions(): () => Project {
  return () => {
    const project = createProject('日历', START)
    const cal: Calendar = project.calendars[project.calendarId]
    cal.exceptions['2026-03-04'] = { kind: 'holiday' }
    cal.exceptions['2026-03-07'] = { kind: 'custom', start: '2026-03-07T09:00', end: '2026-03-07T12:00' }
    const a = auto('A', 5)
    const b = auto('B', 3)
    addTasks(project, [a, b])
    link(project, a.id, b.id)
    const r = createResource({ name: 'R' })
    project.resources[r.id] = r
    assign(project, a.id, r.id, 1)
    assign(project, b.id, r.id, 1)
    return project
  }
}

/** 大而扁平：200 个并行叶子共用一个资源（高密度争用，触发多轮平衡） */
function wideContention(): () => Project {
  return () => {
    const project = createProject('宽争用', START)
    const r = createResource({ name: 'R' })
    project.resources[r.id] = r
    for (let i = 0; i < 200; i++) {
      const t = auto('T' + i, 1 + (i % 4))
      project.tasks[t.id] = t
      project.rootIds.push(t.id)
      assign(project, t.id, r.id, 1)
    }
    return project
  }
}

const NEW_FIXTURES: readonly Fixture[] = [
  { name: 'r-fs-chain', build: fsChain() },
  { name: 'r-parallel-join', build: parallelJoin() },
  { name: 'r-dep-types-lags', build: depTypesLags() },
  { name: 'r-constraints', build: constraints() },
  { name: 'r-manual-conflict', build: manualConflict() },
  { name: 'r-resource-contention', build: resourceContention() },
  { name: 'r-resource-windows', build: resourceWindows() },
  { name: 'r-backward', build: backwardDirection() },
  { name: 'r-alap', build: alapOrder() },
  { name: 'r-fixed-effort', build: fixedEffort() },
  { name: 'r-baseline-earned', build: baselineEarned() },
  { name: 'r-calendar-exceptions', build: calendarExceptions() },
  { name: 'r-wide-contention', build: wideContention() },
]

export const FIXTURES: readonly Fixture[] = [...NEW_FIXTURES, ...LEVELING_FIXTURES]

/** 逐夹具重置 id 计数器后取快照 → 供生成器与断言共同消费 */
export function runFixtures(): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const fixture of FIXTURES) {
    __resetIdCounterForTests()
    out[fixture.name] = snapshotFull(fixture.build())
  }
  return out
}
