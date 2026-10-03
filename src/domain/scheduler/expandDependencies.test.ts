import { describe, it, expect } from 'vitest'
import { createDependency, createProject, createTask } from '../model/factories'
import type { Dependency, Project, Task } from '../model/types'
import { solve } from './index'
import {
  expandDependencies,
  isPredecessorExpandable,
  isSuccessorExpandable,
} from './expandDependencies'

// 2026-03-02 是周一，默认日历周一至周五上班。
const START = '2026-03-02'

/** 在项目里挂一个摘要（group）+ 若干叶子，返回 { 项目, 摘要, 叶子[] }。 */
function withGroup(
  project: Project,
  groupName: string,
  specs: { name: string; duration: number; snET?: string }[],
): { group: Task; leaves: Task[] } {
  const group = createTask({ name: groupName, kind: 'group' })
  const leaves = specs.map((spec) => {
    const leaf = createTask({ name: spec.name, duration: spec.duration })
    if (spec.snET) {
      leaf.scheduling = { mode: 'auto', startConstraint: { type: 'startNoEarlierThan', date: spec.snET } }
    }
    leaf.parentId = group.id
    project.tasks[leaf.id] = leaf
    return leaf
  })
  group.childIds = leaves.map((leaf) => leaf.id)
  project.tasks[group.id] = group
  project.rootIds.push(group.id)
  return { group, leaves }
}

function addLeaf(project: Project, name: string, duration: number, snET?: string): Task {
  const leaf = createTask({ name, duration })
  if (snET) {
    leaf.scheduling = { mode: 'auto', startConstraint: { type: 'startNoEarlierThan', date: snET } }
  }
  project.tasks[leaf.id] = leaf
  project.rootIds.push(leaf.id)
  return leaf
}

function link(project: Project, from: Task, to: Task, type: Dependency['type']): Dependency {
  const dep = createDependency(from.id, to.id, type)
  project.dependencies[dep.id] = dep
  return dep
}

// ── 单元：展开判据与产物 ─────────────────────────────────

describe('expandDependencies — 精确性判据', () => {
  it('前置是摘要：仅约束落在前置 finish 的类型（FS / FF）可精确展开', () => {
    expect(isPredecessorExpandable('FS')).toBe(true)
    expect(isPredecessorExpandable('FF')).toBe(true)
    expect(isPredecessorExpandable('SS')).toBe(false)
    expect(isPredecessorExpandable('SF')).toBe(false)
  })

  it('后继是摘要：仅约束落在后继 start 的类型（FS / SS）可精确展开', () => {
    expect(isSuccessorExpandable('FS')).toBe(true)
    expect(isSuccessorExpandable('SS')).toBe(true)
    expect(isSuccessorExpandable('FF')).toBe(false)
    expect(isSuccessorExpandable('SF')).toBe(false)
  })
})

describe('expandDependencies — 展开产物', () => {
  function scenario(): { project: Project; group: Task; leaves: Task[]; other: Task } {
    const project = createProject('展开', START)
    const { group, leaves } = withGroup(project, 'G', [
      { name: 'g1', duration: 3 },
      { name: 'g2', duration: 1 },
    ])
    const other = addLeaf(project, 'B', 1)
    return { project, group, leaves, other }
  }

  it('叶子↔叶子依赖**原样透传**（id 不变，避免扰动既有边序 / 归因）', () => {
    const { project, leaves, other } = scenario()
    const dep = link(project, leaves[0], other, 'FS')
    const { dependencies, unsupported } = expandDependencies(project.tasks, [dep])
    expect(dependencies).toEqual([dep])
    expect(dependencies[0].id).toBe(dep.id)
    expect(unsupported).toEqual([])
  })

  it('前置是摘要（FS）→ 展开成「每个叶子前置」一条边', () => {
    const { project, group, leaves, other } = scenario()
    const dep = link(project, group, other, 'FS')
    const { dependencies, unsupported } = expandDependencies(project.tasks, [dep])
    expect(unsupported).toEqual([])
    expect(dependencies).toHaveLength(2)
    expect(dependencies.map((d) => d.fromTaskId).sort()).toEqual(leaves.map((l) => l.id).sort())
    expect(dependencies.every((d) => d.toTaskId === other.id)).toBe(true)
    expect(dependencies.every((d) => d.type === 'FS')).toBe(true)
  })

  it('后继是摘要（FS）→ 展开成「指向每个叶子后继」一条边', () => {
    const { project, group, other } = scenario()
    const dep = link(project, other, group, 'FS')
    const { dependencies } = expandDependencies(project.tasks, [dep])
    expect(dependencies).toHaveLength(2)
    expect(dependencies.every((d) => d.fromTaskId === other.id)).toBe(true)
    expect(dependencies.map((d) => d.toTaskId).sort()).toEqual(group.childIds.slice().sort())
  })

  it('两端都是摘要（FS）→ 交叉展开成全部叶子对', () => {
    const project = createProject('嵌套', START)
    const a = withGroup(project, 'A', [
      { name: 'a1', duration: 1 },
      { name: 'a2', duration: 2 },
    ])
    const b = withGroup(project, 'B', [
      { name: 'b1', duration: 1 },
      { name: 'b2', duration: 1 },
    ])
    const dep = link(project, a.group, b.group, 'FS')
    const { dependencies, unsupported } = expandDependencies(project.tasks, [dep])
    expect(unsupported).toEqual([])
    // 断言**确切的 from→to 配对集合**：只断言条数的话，「4 条错配 / 重复的边」也能蒙混过关
    const pairs = dependencies.map((d) => `${d.fromTaskId}>${d.toTaskId}`).sort()
    const expected = a.leaves
      .flatMap((from) => b.leaves.map((to) => `${from.id}>${to.id}`))
      .sort()
    expect(pairs).toEqual(expected)
    expect(dependencies.every((d) => d.type === 'FS')).toBe(true)
  })

  it.each([
    ['SS', 'predecessor'],
    ['SF', 'predecessor'],
  ] as const)('前置是摘要 + %s → 不展开、列入 unsupported', (type, endpoint) => {
    const { project, group, other } = scenario()
    const dep = link(project, group, other, type)
    const { dependencies, unsupported } = expandDependencies(project.tasks, [dep])
    expect(dependencies).toEqual([])
    expect(unsupported).toHaveLength(1)
    expect(unsupported[0]).toMatchObject({ endpoint })
    expect(unsupported[0].dep.id).toBe(dep.id)
  })

  it.each([
    ['FF', 'successor'],
    ['SF', 'successor'],
  ] as const)('后继是摘要 + %s → 不展开、列入 unsupported', (type, endpoint) => {
    const { project, group, other } = scenario()
    const dep = link(project, other, group, type)
    const { dependencies, unsupported } = expandDependencies(project.tasks, [dep])
    expect(dependencies).toEqual([])
    expect(unsupported).toHaveLength(1)
    expect(unsupported[0]).toMatchObject({ endpoint })
  })

  it('悬空依赖照旧丢弃（不展开、不算 unsupported）', () => {
    const { project, other } = scenario()
    const dep = createDependency('t-does-not-exist', other.id, 'FS')
    const { dependencies, unsupported } = expandDependencies(project.tasks, [dep])
    expect(dependencies).toEqual([])
    expect(unsupported).toEqual([])
  })
})

// ── 行为：精确展开后，摘要端点约束真的生效 ─────────────────

describe('solve — 摘要依赖展开（行为）', () => {
  it('FS + 前置是摘要：后继排在**摘要最晚完成**之后（组 finish = max 叶子）', () => {
    const project = createProject('fs-pred-group', START)
    const { group, leaves } = withGroup(project, 'G', [
      { name: 'g1', duration: 3 }, // 03-02..03-04
      { name: 'g2', duration: 1 }, // 03-02
    ])
    const b = addLeaf(project, 'B', 1)
    link(project, group, b, 'FS')

    const r = solve(project)
    expect(r.schedules[leaves[0].id].scheduledFinish).toBe('2026-03-04')
    expect(r.schedules[group.id].scheduledFinish).toBe('2026-03-04')
    // 组完成后次工作日 → 03-05（修复前该边被静默丢弃，B 会落在 03-02）
    expect(r.schedules[b.id].scheduledStart).toBe('2026-03-05')
  })

  it('FS + 后继是摘要：摘要的**每个叶子**都在前置之后开工（组 start = min 叶子）', () => {
    const project = createProject('fs-succ-group', START)
    const a = addLeaf(project, 'A', 2) // 03-02..03-03
    const { group, leaves } = withGroup(project, 'G', [
      { name: 'g1', duration: 1 },
      { name: 'g2', duration: 1 },
    ])
    link(project, a, group, 'FS')

    const r = solve(project)
    for (const leaf of leaves) expect(r.schedules[leaf.id].scheduledStart).toBe('2026-03-04')
    expect(r.schedules[group.id].scheduledStart).toBe('2026-03-04')
  })

  it('FF + 前置是摘要：后继完成日不早于**摘要最晚完成**', () => {
    const project = createProject('ff-pred-group', START)
    const { group } = withGroup(project, 'G', [
      { name: 'g1', duration: 3 }, // 组 finish = 03-04
      { name: 'g2', duration: 1 },
    ])
    const b = addLeaf(project, 'B', 2)
    link(project, group, b, 'FF')

    const r = solve(project)
    // B.finish ≥ 03-04 → B.start = taskStart(03-04, 2) = 03-03
    expect(r.schedules[b.id].scheduledStart).toBe('2026-03-03')
    expect(r.schedules[b.id].scheduledFinish).toBe('2026-03-04')
  })

  it('SS + 后继是摘要：摘要的**每个叶子**都不早于前置开工', () => {
    const project = createProject('ss-succ-group', START)
    const a = addLeaf(project, 'A', 2, '2026-03-05') // 03-05..03-06
    const { group, leaves } = withGroup(project, 'G', [
      { name: 'g1', duration: 1 },
      { name: 'g2', duration: 1 },
    ])
    link(project, a, group, 'SS')

    const r = solve(project)
    for (const leaf of leaves) expect(r.schedules[leaf.id].scheduledStart).toBe('2026-03-05')
    expect(r.schedules[group.id].scheduledStart).toBe('2026-03-05')
  })

  it('嵌套（两端都是摘要，FS）：后继每个叶子都在前置每个叶子之后', () => {
    const project = createProject('nested', START)
    const a = withGroup(project, 'A', [
      { name: 'a1', duration: 1 }, // 03-02
      { name: 'a2', duration: 3 }, // 03-02..03-04
    ])
    const b = withGroup(project, 'B', [
      { name: 'b1', duration: 1 },
      { name: 'b2', duration: 1 },
    ])
    link(project, a.group, b.group, 'FS')

    const r = solve(project)
    for (const leaf of b.leaves) expect(r.schedules[leaf.id].scheduledStart).toBe('2026-03-05')
  })
})

// ── 边界：不可精确表达的摘要端点**不做近似** ────────────────

describe('solve — 不可展开的摘要依赖（不做近似，如实上报）', () => {
  it('SS + 前置是摘要：不近似展开（不得把后继推到 max 叶子之后）', () => {
    const project = createProject('ss-pred-group', START)
    const { group } = withGroup(project, 'G', [
      { name: 'g1', duration: 1 }, // 03-02
      { name: 'g2', duration: 1, snET: '2026-03-09' }, // 03-09（组 start = min = 03-02）
    ])
    const b = addLeaf(project, 'B', 1)
    const dep = link(project, group, b, 'SS')

    // 判据：该组合**不可**在叶子级精确表达 → 列入 unsupported，且不入图。
    const expanded = expandDependencies(project.tasks, [dep])
    expect(expanded.dependencies).toEqual([])
    expect(expanded.unsupported).toMatchObject([{ endpoint: 'predecessor' }])

    // 行为：不做近似 —— 若错误地按「逐叶子取 max」展开，B 会被推到 03-09。
    const r = solve(project)
    expect(r.schedules[b.id].scheduledStart).not.toBe('2026-03-09')
    expect(r.schedules[b.id].scheduledStart).toBe('2026-03-02')
  })

  it('FF + 后继是摘要：不近似展开（不得要求所有叶子都满足 finish 下界）', () => {
    const project = createProject('ff-succ-group', START)
    const a = addLeaf(project, 'A', 5) // 03-02..03-06
    const { group, leaves } = withGroup(project, 'G', [
      { name: 'g1', duration: 1 },
      { name: 'g2', duration: 1 },
    ])
    const dep = link(project, a, group, 'FF')

    const expanded = expandDependencies(project.tasks, [dep])
    expect(expanded.dependencies).toEqual([])
    expect(expanded.unsupported).toMatchObject([{ endpoint: 'successor' }])

    // 不做近似：叶子不会被推到 03-06。
    const r = solve(project)
    for (const leaf of leaves) expect(r.schedules[leaf.id].scheduledStart).toBe('2026-03-02')
  })
})
