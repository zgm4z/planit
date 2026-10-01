import { describe, it, expect } from 'vitest'
import { createCalendar, createTask, createDependency } from '../model/factories'
import type { ConstraintType, Dependency, Task } from '../model/types'
import { runCpm } from './cpm'
import { CycleError } from './graph'

const mk = (name: string, duration: number): Task => ({
  ...createTask({ name, duration }),
  id: name,
})

// ── 黄金用例 ────────────────────────────────────────────
// 项目开始 2026-03-02（周一），标准日历（周一至周五）
//
//   A(3d) ──┬──> B(2d) ──┐
//           │             ├──> D(1d)
//           └──> C(5d) ──┘
//
// 手算：
//   A: 03-02 → 03-04
//   B: 03-05 → 03-06   （浮时 3）
//   C: 03-05 → 03-11
//   D: 03-12 → 03-12
//   关键路径 = A → C → D
describe('runCpm — 黄金用例', () => {
  const cal = createCalendar()
  const tasks = [mk('A', 3), mk('B', 2), mk('C', 5), mk('D', 1)]
  const dependencies = [
    createDependency('A', 'B'),
    createDependency('A', 'C'),
    createDependency('B', 'D'),
    createDependency('C', 'D'),
  ]
  const r = runCpm({ tasks, dependencies, calendar: cal, projectStart: '2026-03-02' })

  it('正推得到各任务的最早排期', () => {
    expect(r.A.earlyStart).toBe('2026-03-02')
    expect(r.A.earlyFinish).toBe('2026-03-04')
    expect(r.B.earlyStart).toBe('2026-03-05')
    expect(r.B.earlyFinish).toBe('2026-03-06')
    expect(r.C.earlyStart).toBe('2026-03-05')
    expect(r.C.earlyFinish).toBe('2026-03-11')
    expect(r.D.earlyStart).toBe('2026-03-12')
    expect(r.D.earlyFinish).toBe('2026-03-12')
  })

  it('识别出关键路径 A → C → D', () => {
    expect(r.A.isCritical).toBe(true)
    expect(r.C.isCritical).toBe(true)
    expect(r.D.isCritical).toBe(true)
    expect(r.B.isCritical).toBe(false)
  })

  it('非关键任务 B 有 3 个工作日浮时', () => {
    expect(r.B.totalSlack).toBe(3)
    expect(r.A.totalSlack).toBe(0)
  })

  it('逆推日期自洽：lateFinish = lateStart + duration - 1', () => {
    expect(r.B.lateStart).toBe('2026-03-10')
    expect(r.B.lateFinish).toBe('2026-03-11')
  })
})

// ── 依赖类型与 lag ──────────────────────────────────────
describe('runCpm — 依赖类型与 lag', () => {
  const cal = createCalendar()
  const run = (deps: Dependency[]) =>
    runCpm({
      tasks: [mk('A', 3), mk('B', 2)],
      dependencies: deps,
      calendar: cal,
      projectStart: '2026-03-02',
    })

  it('FS + lag 3：A 完成后再等 3 个工作日', () => {
    // A 完成于 03-04；其后第 4 个工作日 = 03-05(1) 03-06(2) 03-09(3) 03-10(4)
    expect(run([createDependency('A', 'B', 'FS', 3)]).B.earlyStart).toBe('2026-03-10')
  })

  it('SS + lag 2：B 与 A 同日开工再推 2 个工作日', () => {
    expect(run([createDependency('A', 'B', 'SS', 2)]).B.earlyStart).toBe('2026-03-04')
  })

  it('FF：B 的结束不早于 A 的结束，工期 2 天 → B 从 03-03 开始', () => {
    const r = run([createDependency('A', 'B', 'FF', 0)])
    expect(r.B.earlyFinish).toBe('2026-03-04')
    expect(r.B.earlyStart).toBe('2026-03-03')
  })

  it('负 lag（提前量）让 B 提前到 A 完成当天开工', () => {
    // FS 的偏移量是 lag + 1：lag=0 时 B 在 A 完成后的第 1 个工作日开工（03-05），
    // lag=-1 少等一个工作日，提前到 A 完成当天（03-04）。
    //
    // 注意 lag=-1 得到的是「完成当天」而非「完成前一天」—— 因为 addWorkdays(x, 0) 返回 x 本身。
    // 想真正提前到完成之前，需要 lag <= -2（例如 lag=-2 → 03-03）。
    expect(run([createDependency('A', 'B', 'FS', -1)]).B.earlyStart).toBe('2026-03-04')
  })

  it('lag 为 -2 时才真正提前到 A 完成之前', () => {
    // offset = -2 + 1 = -1 → 03-04 的前一个工作日 = 03-03
    expect(run([createDependency('A', 'B', 'FS', -2)]).B.earlyStart).toBe('2026-03-03')
  })
})

// ── 调度约束 ────────────────────────────────────────────
describe('runCpm — 调度约束', () => {
  const cal = createCalendar()

  it('startOn 把任务钉在指定日期', () => {
    const a = mk('A', 2)
    const b: Task = {
      ...mk('B', 2),
      scheduling: { mode: 'constraint', type: 'startOn', date: '2026-03-16' },
    }
    const r = runCpm({
      tasks: [a, b],
      dependencies: [createDependency('A', 'B')],
      calendar: cal,
      projectStart: '2026-03-02',
    })
    expect(r.B.earlyStart).toBe('2026-03-16')
  })

  it('startNoEarlierThan 只设下界，任务仍可被依赖推后', () => {
    const a = mk('A', 5)
    const b: Task = {
      ...mk('B', 1),
      scheduling: { mode: 'constraint', type: 'startNoEarlierThan', date: '2026-03-03' },
    }
    const r = runCpm({
      tasks: [a, b],
      dependencies: [createDependency('A', 'B')],
      calendar: cal,
      projectStart: '2026-03-02',
    })
    // 下界 03-03 弱于依赖要求的 03-09，取较晚者
    expect(r.B.earlyStart).toBe('2026-03-09')
  })

  it('约束与依赖矛盾时浮时为负（冲突信号）', () => {
    const a = mk('A', 5)
    const b: Task = {
      ...mk('B', 1),
      scheduling: { mode: 'constraint', type: 'startOn', date: '2026-03-04' },
    }
    const r = runCpm({
      tasks: [a, b],
      dependencies: [createDependency('A', 'B')],
      calendar: cal,
      projectStart: '2026-03-02',
    })
    // A 正推 03-02→03-06，B 最早只能 03-09；但 B 被钉在 03-04
    expect(r.B.earlyStart).toBe('2026-03-09')
    expect(r.B.totalSlack).toBeLessThan(0)
  })
})

// ── 边界 ────────────────────────────────────────────────
describe('runCpm — 边界情况', () => {
  it('空项目返回空结果', () => {
    const r = runCpm({
      tasks: [],
      dependencies: [],
      calendar: createCalendar(),
      projectStart: '2026-03-02',
    })
    expect(r).toEqual({})
  })

  it('工期为 0 的里程碑起止同日', () => {
    const m: Task = { ...mk('M', 0), kind: 'milestone' }
    const r = runCpm({
      tasks: [mk('A', 2), m],
      dependencies: [createDependency('A', 'M')],
      calendar: createCalendar(),
      projectStart: '2026-03-02',
    })
    expect(r.M.earlyStart).toBe('2026-03-04')
    expect(r.M.earlyFinish).toBe('2026-03-04')
  })

  it('排期自动跳过周末', () => {
    // A 从周四 03-05 开始，工期 3 天 → 03-05, 03-06, 03-09
    const r = runCpm({
      tasks: [mk('A', 3)],
      dependencies: [],
      calendar: createCalendar(),
      projectStart: '2026-03-05',
    })
    expect(r.A.earlyFinish).toBe('2026-03-09')
  })

  it('依赖成环时向上抛出 CycleError', () => {
    expect(() =>
      runCpm({
        tasks: [mk('A', 1), mk('B', 1)],
        dependencies: [createDependency('A', 'B'), createDependency('B', 'A')],
        calendar: createCalendar(),
        projectStart: '2026-03-02',
      }),
    ).toThrow(CycleError)
  })
})

// ── 六种约束类型 ────────────────────────────────────────
describe('runCpm — 六种约束类型的上下界', () => {
  // 单个工期 2 天的任务，约束日期 2026-03-16，项目起点 2026-03-02（周一）
  // 2 天工期的任务若结束于 03-16，则开始于 03-13
  const cal = createCalendar()
  const run = (type: ConstraintType) =>
    runCpm({
      tasks: [
        { ...mk('A', 2), scheduling: { mode: 'constraint', type, date: '2026-03-16' } },
      ],
      dependencies: [],
      calendar: cal,
      projectStart: '2026-03-02',
    })

  it('startOn：钉住开始日期', () => {
    expect(run('startOn').A.earlyStart).toBe('2026-03-16')
    expect(run('startOn').A.earlyFinish).toBe('2026-03-17')
  })

  it('finishOn：钉住结束日期，开始由工期反推', () => {
    expect(run('finishOn').A.earlyStart).toBe('2026-03-13')
    expect(run('finishOn').A.earlyFinish).toBe('2026-03-16')
  })

  it('startNoEarlierThan：只设开始下界', () => {
    expect(run('startNoEarlierThan').A.earlyStart).toBe('2026-03-16')
  })

  it('startNoLaterThan：只设开始上界，最早排期不受影响', () => {
    expect(run('startNoLaterThan').A.earlyStart).toBe('2026-03-02')
    expect(run('startNoLaterThan').A.lateStart).toBe('2026-03-16')
  })

  it('finishNoEarlierThan：只设结束下界', () => {
    expect(run('finishNoEarlierThan').A.earlyStart).toBe('2026-03-13')
    expect(run('finishNoEarlierThan').A.earlyFinish).toBe('2026-03-16')
  })

  it('finishNoLaterThan：只设结束上界，最早排期不受影响', () => {
    expect(run('finishNoLaterThan').A.earlyStart).toBe('2026-03-02')
    expect(run('finishNoLaterThan').A.lateFinish).toBe('2026-03-16')
  })
})
