import { describe, it, expect } from 'vitest'
import { createCalendar, createTask, createDependency } from '../model/factories'
import type { ConstraintType, Dependency, Lag, SchedulingDirection, Task } from '../model/types'
import { workdaysBetween } from '../calendar/workdays'
import { runCpm, runCpmWithGraph } from './cpm'
import { buildGraph, CycleError } from './graph'
import { backwardBound, forwardBound, asLag, effectiveLagWorkdays } from './constraints'

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
  const r = runCpm({
    tasks,
    dependencies,
    calendar: cal,
    direction: 'forward',
    projectStart: '2026-03-02',
  })

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
      direction: 'forward',
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
      direction: 'forward',
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
      direction: 'forward',
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
      direction: 'forward',
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
      direction: 'forward',
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
      direction: 'forward',
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
      direction: 'forward',
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
        direction: 'forward',
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
      direction: 'forward',
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

// ── 排期方向（spec §4.3 / §4.4）──────────────────────────
//
// 沿用上面的黄金用例：
//   A(3d) ──┬──> B(2d) ──┐
//           │             ├──> D(1d)
//           └──> C(5d) ──┘
// 前推：A 03-02..03-04，B 03-05..03-06，C 03-05..03-11，D 03-12..03-12
// 关键路径 A → C → D，跨度 03-02..03-12（9 个工作日）
function golden(direction: SchedulingDirection, projectEnd?: string) {
  const tasks = [mk('A', 3), mk('B', 2), mk('C', 5), mk('D', 1)]
  const dependencies = [
    createDependency('A', 'B'),
    createDependency('A', 'C'),
    createDependency('B', 'D'),
    createDependency('C', 'D'),
  ]
  return runCpm({
    tasks,
    dependencies,
    calendar: createCalendar(),
    direction,
    projectStart: '2026-03-02',
    projectEnd,
  })
}

describe('runCpm — 排期方向', () => {
  it('forward + asap：排期就是正推值', () => {
    const r = golden('forward')
    for (const id of ['A', 'B', 'C', 'D']) {
      expect(r[id].scheduledStart).toBe(r[id].earlyStart)
      expect(r[id].scheduledFinish).toBe(r[id].earlyFinish)
    }
    expect(r.A.scheduledStart).toBe('2026-03-02')
  })

  it('forward + alap：有浮时的任务被推到最晚，关键任务原地不动', () => {
    const tasks = [mk('A', 3), mk('B', 2), mk('C', 5), mk('D', 1)].map((t) => ({
      ...t,
      schedulingOrder: 'alap' as const,
    }))
    const dependencies = [
      createDependency('A', 'B'),
      createDependency('A', 'C'),
      createDependency('B', 'D'),
      createDependency('C', 'D'),
    ]
    const r = runCpm({
      tasks, dependencies, calendar: createCalendar(),
      direction: 'forward', projectStart: '2026-03-02',
    })

    // A 在关键路径上（A→C→D），浮时 0 —— 取早取晚同值。
    // 手算：A 的 lateFinish 由 C.lateStart(03-05) 往回推一格得到 03-04，
    // 于是 lateStart = taskStart('2026-03-04', 3) = 03-02，与 early 相同。
    expect(r.A.totalSlack).toBe(0)
    expect(r.A.scheduledStart).toBe('2026-03-02')
    expect(r.A.scheduledFinish).toBe('2026-03-04')

    // B 才是 alap 的判别点：浮时 3（early 03-05..03-06，late 03-10..03-11）
    expect(r.B.totalSlack).toBe(3)
    expect(r.B.scheduledStart).toBe('2026-03-10')
    expect(r.B.scheduledFinish).toBe('2026-03-11')

    // 其余关键任务同样不动，且最晚完成日不越过算出的完成日
    expect(r.C.scheduledStart).toBe(r.C.earlyStart)
    expect(r.D.scheduledFinish).toBe('2026-03-12')
  })

  it('backward + asap：日期整体后移，关键路径与跨度不变', () => {
    // 窗口比关键链宽：终点定在 03-20（周五）
    const forward = golden('forward')
    const backward = golden('backward', '2026-03-20')

    // 判据 1 —— 每条任务的排期日期都变了（更晚）
    for (const id of ['A', 'B', 'C', 'D']) {
      expect(backward[id].scheduledStart > forward[id].scheduledStart).toBe(true)
    }

    // 判据 2 —— 关键路径不变
    const criticalOf = (r: Record<string, { isCritical: boolean }>) =>
      Object.keys(r).filter((id) => r[id].isCritical).sort()
    expect(criticalOf(backward)).toEqual(criticalOf(forward))
    expect(criticalOf(backward)).toEqual(['A', 'C', 'D'])

    // 判据 3 —— 项目跨度不变（max(lateFinish) - min(lateStart)）
    const span = (r: Record<string, { lateStart: string; lateFinish: string }>) => {
      const starts = Object.values(r).map((s) => s.lateStart).sort()
      const finishes = Object.values(r).map((s) => s.lateFinish).sort((a, b) => (a < b ? 1 : -1))
      return workdaysBetween(starts[0], finishes[0], createCalendar()) + 1
    }
    expect(span(backward)).toBe(span(forward))
    expect(span(forward)).toBe(9)
  })

  it('backward 未设 endDate 时退回用正推算出的完成日', () => {
    const forward = golden('forward')
    const backward = golden('backward')

    // 排期侧：全 asap ⇒ scheduled* 恒等于 early*，与方向无关
    for (const id of ['A', 'B', 'C', 'D']) {
      expect(backward[id].scheduledStart).toBe(forward[id].scheduledStart)
      expect(backward[id].scheduledFinish).toBe(forward[id].scheduledFinish)
    }

    // late 侧才是这条用例的判别点：兜底锚取「正推算出的完成日」，
    // 于是最晚完成日与最早完成日重合、关键任务浮时为 0。
    // 若兜底锚错写成 projectStart，D.totalSlack 会变成很大的负数，
    // 下面两条立刻变红 —— 只断言 scheduled* 是抓不住的。
    expect(backward.D.lateFinish).toBe('2026-03-12')
    expect(backward.D.totalSlack).toBe(0)
    expect(backward.B.totalSlack).toBe(3) // 与 forward 下的浮时一致
    expect(backward.A.totalSlack).toBe(0)
  })

  it('forward 下 projectEnd 早于算出的完成日 → 浮时变负（期限违约）', () => {
    const r = golden('forward', '2026-03-10') // 实际完成 03-12
    expect(r.D.totalSlack).toBeLessThan(0)
    expect(r.D.isCritical).toBe(false)
  })

  it('backward + alap：排期取逆推值（真值表的第四格）', () => {
    const tasks = [mk('A', 3), mk('B', 2), mk('C', 5), mk('D', 1)].map((t) => ({
      ...t,
      schedulingOrder: 'alap' as const,
    }))
    const r = runCpm({
      tasks,
      dependencies: [
        createDependency('A', 'B'),
        createDependency('A', 'C'),
        createDependency('B', 'D'),
        createDependency('C', 'D'),
      ],
      calendar: createCalendar(),
      direction: 'backward',
      projectStart: '2026-03-02',
      projectEnd: '2026-03-20',
    })

    for (const id of ['A', 'B', 'C', 'D']) {
      expect(r[id].scheduledStart).toBe(r[id].lateStart)
      expect(r[id].scheduledFinish).toBe(r[id].lateFinish)
    }
  })

  it('alap 不会把关键任务推早', () => {
    const tasks = [mk('A', 3), mk('C', 5), mk('D', 1)].map((t) => ({
      ...t,
      schedulingOrder: 'alap' as const,
    }))
    const r = runCpm({
      tasks,
      dependencies: [createDependency('A', 'C'), createDependency('C', 'D')],
      calendar: createCalendar(),
      direction: 'forward',
      projectStart: '2026-03-02',
    })
    // 全链都是关键任务 → 没有任何浮时可挪
    expect(r.A.scheduledStart).toBe('2026-03-02')
    expect(r.D.scheduledFinish).toBe('2026-03-12')
  })
})

// ── 自由宽延（spec §5）──────────────────────────────────
//
// 沿用黄金用例 A(3d) ─┬─> B(2d) ─┐
//                      └─> C(5d) ─┴─> D(1d)
// 手算：
//   A 完成后 B、C 立刻开工（lag 0）→ A.freeSlack = 0
//   B 完成 03-06，D 最早 03-12，但 D 被 C(03-11 完成) 顶着 → B 可推 3 天
//   C 完成 03-11，D 最早 03-12 → C.freeSlack = 0
//   D 无后继 → freeSlack = totalSlack = 0
describe('runCpm — 自由宽延', () => {
  // 注意变量名与上面「排期方向」describe 里的 golden() 函数区分开，
  // 别在同一个文件里重复声明同名标识符。
  const goldenR = runCpm({
    tasks: [mk('A', 3), mk('B', 2), mk('C', 5), mk('D', 1)],
    dependencies: [
      createDependency('A', 'B'),
      createDependency('A', 'C'),
      createDependency('B', 'D'),
      createDependency('C', 'D'),
    ],
    calendar: createCalendar(),
    direction: 'forward',
    projectStart: '2026-03-02',
  })

  it('边界 1：没有后继的任务，自由宽延等于总宽延', () => {
    expect(goldenR.D.totalSlack).toBe(0)
    expect(goldenR.D.freeSlack).toBe(goldenR.D.totalSlack)
  })

  it('边界 2：共同后继的两个任务，较晚结束的那个 freeSlack 为 0', () => {
    expect(goldenR.B.earlyFinish).toBe('2026-03-06')
    expect(goldenR.C.earlyFinish).toBe('2026-03-11')
    expect(goldenR.B.freeSlack).toBe(3)
    expect(goldenR.C.freeSlack).toBe(0)
    // B 的总宽延也是 3 —— 它一推迟就直接顶到 D 的最早开始
    expect(goldenR.B.totalSlack).toBe(3)
  })

  it('边界 3：带正 lag 的依赖链 —— 一推就动后继，自由宽延为 0', () => {
    // A(2d) 03-02..03-03 --FS lag 1--> B(1d) 03-05
    // 推 A 一天 → B 跟着推到 03-06，所以 A 一天都推不得。
    const r = runCpm({
      tasks: [mk('A', 2), mk('B', 1)],
      dependencies: [createDependency('A', 'B', 'FS', 1)],
      calendar: createCalendar(),
      direction: 'forward',
      projectStart: '2026-03-02',
    })
    expect(r.A.earlyFinish).toBe('2026-03-03')
    expect(r.B.earlyStart).toBe('2026-03-05')
    expect(r.A.freeSlack).toBe(0)
    expect(r.B.freeSlack).toBe(r.B.totalSlack)
  })

  it('判别用例：自由宽延可以远小于总宽延', () => {
    //   A(1d) ──FS──> B(1d) ──FS──> C(1d)
    //   X(6d) ──FS───────────────> C(1d)
    //   Z(1d)   孤立任务（无依赖、无后继）
    //
    // 手算（起点 2026-03-02 周一）：
    //   A 03-02..03-02，B 03-03..03-03，X 03-02..03-09
    //   C = max(addWorkdays(B.finish 03-03, 1)=03-04, addWorkdays(X.finish 03-09, 1)=03-10)
    //     = 03-10 → C 03-10..03-10，项目完成 03-10；Z 03-02..03-02
    //   逆推锚 03-10：C.late 03-10；B.lateFinish = 03-09 → B.lateStart 03-09；
    //                 A.lateFinish = 03-06 → A.lateStart 03-06；
    //                 Z.lateFinish = 03-10 → Z.lateStart 03-10
    //   A.totalSlack = workdaysBetween(03-02, 03-06) = 4
    //   A.freeSlack ：A→B 的 forwardBound = addWorkdays(03-02, 1) = 03-03，
    //                 B.earlyStart = 03-03 → workdaysBetween(03-03, 03-03) = 0
    //   B.totalSlack = workdaysBetween(03-03, 03-09) = 4
    //   B.freeSlack ：B→C 的 forwardBound = addWorkdays(03-03, 1) = 03-04，
    //                 C.earlyStart = 03-10 → workdaysBetween(03-04, 03-10) = 4
    //   Z.totalSlack = workdaysBetween(03-02, 03-10) = 6
    //   Z.freeSlack ：无后继 → 直接取 totalSlack = 6
    //
    // A 的总宽延有 4 天（整条 A→B 链能整体后移 4 天），但自由宽延是 0 ——
    // B 紧跟在 A 完成后的下一个工作日开工，A 一天都推不得。
    // 这条断言是整套 freeSlack 测试里唯一能区分「按边松弛算」与
    // 「直接返回 totalSlack」的用例：后者会让 A.freeSlack 也变成 4。
    //
    // Z 则堵上「无后继」那一支 —— 既有用例里无后继的 D/B 总宽延都是 0，
    // 无法区分 `return totalSlack` 与错误的 `return 0`，这里用非零值区分。
    const r = runCpm({
      tasks: [mk('A', 1), mk('B', 1), mk('X', 6), mk('C', 1), mk('Z', 1)],
      dependencies: [createDependency('A', 'B'), createDependency('B', 'C'), createDependency('X', 'C')],
      calendar: createCalendar(),
      direction: 'forward',
      projectStart: '2026-03-02',
    })

    expect(r.C.earlyStart).toBe('2026-03-10')
    expect(r.A.totalSlack).toBe(4)
    expect(r.A.freeSlack).toBe(0)
    expect(r.B.totalSlack).toBe(4)
    expect(r.B.freeSlack).toBe(4)
    expect(r.Z.totalSlack).toBe(6)
    expect(r.Z.freeSlack).toBe(6)
  })

  it('后继被别的依赖推后时，前置任务获得对应的自由宽延', () => {
    // A(1d) ──FS 0──> B(1d)
    // C(3d) ──FS 0──> B(1d)     ← C 把 B 顶到 03-05
    // A 03-02..03-02 结束即可，B 却要等到 03-05 → A 可推 2 天
    const r = runCpm({
      tasks: [mk('A', 1), mk('C', 3), mk('B', 1)],
      dependencies: [createDependency('A', 'B'), createDependency('C', 'B')],
      calendar: createCalendar(),
      direction: 'forward',
      projectStart: '2026-03-02',
    })
    expect(r.C.earlyFinish).toBe('2026-03-04')
    expect(r.B.earlyStart).toBe('2026-03-05')
    expect(r.A.freeSlack).toBe(2)
    expect(r.A.totalSlack).toBe(2)
  })
})

describe('runCpm — 非工作日上界', () => {
  const cal = createCalendar()

  it('forward projectEnd 落在周六时向前归一并保留期限冲突', () => {
    const result = runCpm({
      tasks: [mk('T', 6)],
      dependencies: [],
      calendar: cal,
      direction: 'forward',
      projectStart: '2026-03-02',
      projectEnd: '2026-03-07',
    })

    expect(result.T.lateFinish).toBe('2026-03-06')
    expect(result.T.totalSlack).toBe(-1)
  })

  it('backward projectEnd 落在周六时 ASAP 任务不排到下周一', () => {
    const result = runCpm({
      tasks: [mk('T', 1)],
      dependencies: [],
      calendar: cal,
      direction: 'backward',
      projectStart: '2026-03-02',
      projectEnd: '2026-03-07',
    })

    expect(result.T.scheduledFinish).toBe('2026-03-06')
  })

  it('finishNoLaterThan 周六与 ALAP 不会被推到周一', () => {
    const task = {
      ...mk('T', 1),
      schedulingOrder: 'alap' as const,
      scheduling: { mode: 'constraint' as const, type: 'finishNoLaterThan' as const, date: '2026-03-07' },
    }
    const result = runCpm({
      tasks: [task],
      dependencies: [],
      calendar: cal,
      direction: 'forward',
      projectStart: '2026-03-02',
    })

    expect(result.T.scheduledFinish).toBe('2026-03-06')
  })

  it('startNoLaterThan 周六先归一开始上界再推导最晚完成', () => {
    const task = {
      ...mk('T', 2),
      schedulingOrder: 'alap' as const,
      scheduling: { mode: 'constraint' as const, type: 'startNoLaterThan' as const, date: '2026-03-07' },
    }
    const result = runCpm({
      tasks: [task],
      dependencies: [],
      calendar: cal,
      direction: 'forward',
      projectStart: '2026-03-02',
    })

    expect(result.T.scheduledStart).toBe('2026-03-06')
    expect(result.T.scheduledFinish).toBe('2026-03-09')
  })

  it('自定义周六工作日可作为 backward projectEnd', () => {
    const customCalendar = createCalendar()
    customCalendar.exceptions['2026-03-07'] = {
      kind: 'custom',
      start: '2026-03-07T09:00',
      end: '2026-03-07T18:00',
    }
    const result = runCpm({
      tasks: [mk('T', 1)],
      dependencies: [],
      calendar: customCalendar,
      direction: 'backward',
      projectStart: '2026-03-02',
      projectEnd: '2026-03-07',
    })

    expect(result.T.scheduledFinish).toBe('2026-03-07')
  })

  it('startOn 与 finishOn 周末仍按既有规则向前吸附', () => {
    const startOn = {
      ...mk('S', 1),
      scheduling: { mode: 'constraint' as const, type: 'startOn' as const, date: '2026-03-07' },
    }
    const finishOn = {
      ...mk('F', 1),
      scheduling: { mode: 'constraint' as const, type: 'finishOn' as const, date: '2026-03-07' },
    }
    const result = runCpm({
      tasks: [startOn, finishOn],
      dependencies: [],
      calendar: cal,
      direction: 'forward',
      projectStart: '2026-03-02',
    })

    expect(result.S.earlyStart).toBe('2026-03-09')
    expect(result.F.earlyFinish).toBe('2026-03-09')
  })
})

describe('runCpm — 复用预构建图', () => {
  it('四种依赖与 ALAP 排期复用同一 TaskGraph 时结果不变', () => {
    const tasks = [mk('A', 3), mk('B', 2), mk('C', 5), mk('D', 1)].map((task) => ({
      ...task,
      schedulingOrder: 'alap' as const,
    }))
    const dependencies = [
      createDependency('A', 'B', 'FS', 0),
      createDependency('A', 'C', 'SS', 1),
      createDependency('B', 'D', 'FF', 0),
      createDependency('C', 'D', 'SF', -1),
    ]
    const input = {
      tasks,
      dependencies,
      calendar: createCalendar(),
      direction: 'backward' as const,
      projectStart: '2026-03-02',
      projectEnd: '2026-03-20',
    }

    expect(runCpmWithGraph(input, buildGraph(tasks, dependencies))).toEqual(runCpm(input))
  })
})

// ── Lag 三单位换算 ──────────────────────────────────────
// 默认日历周一至周五；跨周末用例锚定 2026-03-06（周五）。
describe('forwardBound / backwardBound — Lag 单位换算', () => {
  const cal = createCalendar()

  function dep(type: Dependency['type'], lag: Lag | number): Dependency {
    return { id: 'd', fromTaskId: 'A', toTaskId: 'B', type, lag: lag as Lag }
  }

  describe('workdays', () => {
    it('FS lag=1：A 3 天 03-02→03-04，B 最早开始 = 03-06 周五', () => {
      expect(
        forwardBound({
          dep: dep('FS', { kind: 'workdays', days: 1 }),
          fromStart: '2026-03-02',
          fromFinish: '2026-03-04',
          toDuration: 2,
          fromDuration: 3,
          cal,
        }),
      ).toBe('2026-03-06')
    })

    it('SS lag=2：从 A 开始再推 2 个工作日', () => {
      expect(
        forwardBound({
          dep: dep('SS', { kind: 'workdays', days: 2 }),
          fromStart: '2026-03-02',
          fromFinish: '2026-03-04',
          toDuration: 2,
          fromDuration: 3,
          cal,
        }),
      ).toBe('2026-03-04')
    })

    it('FF lag=0：B 结束不早于 A 结束，toDuration=2 → B 从 03-03 开始', () => {
      expect(
        forwardBound({
          dep: dep('FF', { kind: 'workdays', days: 0 }),
          fromStart: '2026-03-02',
          fromFinish: '2026-03-04',
          toDuration: 2,
          fromDuration: 3,
          cal,
        }),
      ).toBe('2026-03-03')
    })

    it('SF lag=1：从 A 开始推 1 工作日，toDuration=2 → B 从 03-02 开始（03-02 开工、03-03 完工）', () => {
      expect(
        forwardBound({
          dep: dep('SF', { kind: 'workdays', days: 1 }),
          fromStart: '2026-03-02',
          fromFinish: '2026-03-04',
          toDuration: 2,
          fromDuration: 3,
          cal,
        }),
      ).toBe('2026-03-02')
    })

    it('逆推 FS lag=1：B 03-06 开始 → A 最晚 03-04 结束', () => {
      expect(
        backwardBound({
          dep: dep('FS', { kind: 'workdays', days: 1 }),
          toStart: '2026-03-06',
          toFinish: '2026-03-10',
          fromDuration: 3,
          cal,
        }),
      ).toBe('2026-03-04')
    })
  })

  describe('elapsedDays', () => {
    it('FS + 0 自然日：周五完成 → 次工作日周一', () => {
      expect(
        forwardBound({
          dep: dep('FS', { kind: 'elapsedDays', days: 0 }),
          fromStart: '2026-03-04',
          fromFinish: '2026-03-06',
          toDuration: 2,
          fromDuration: 3,
          cal,
        }),
      ).toBe('2026-03-09')
    })

    it('FS + 2 自然日：周五+2=周日 → 次工作日周一', () => {
      expect(
        forwardBound({
          dep: dep('FS', { kind: 'elapsedDays', days: 2 }),
          fromStart: '2026-03-04',
          fromFinish: '2026-03-06',
          toDuration: 2,
          fromDuration: 3,
          cal,
        }),
      ).toBe('2026-03-09')
    })

    it('FF + 0 自然日：同日相接允许', () => {
      expect(
        forwardBound({
          dep: dep('FF', { kind: 'elapsedDays', days: 0 }),
          fromStart: '2026-03-04',
          fromFinish: '2026-03-06',
          toDuration: 1,
          fromDuration: 3,
          cal,
        }),
      ).toBe('2026-03-06')
    })

    it('SS + 1 自然日：周六开始 → 下周一', () => {
      expect(
        forwardBound({
          dep: dep('SS', { kind: 'elapsedDays', days: 1 }),
          fromStart: '2026-03-07',
          fromFinish: '2026-03-06',
          toDuration: 2,
          fromDuration: 3,
          cal,
        }),
      ).toBe('2026-03-09')
    })

    it('逆推 FS + 0 自然日：B 03-09 开始 → A 最晚 03-06 结束', () => {
      expect(
        backwardBound({
          dep: dep('FS', { kind: 'elapsedDays', days: 0 }),
          toStart: '2026-03-09',
          toFinish: '2026-03-10',
          fromDuration: 3,
          cal,
        }),
      ).toBe('2026-03-06')
    })
  })

  describe('percent', () => {
    it('前置工期 5、+50% → ceil(2.5)=3 工作日', () => {
      expect(
        forwardBound({
          dep: dep('FS', { kind: 'percent', value: 50 }),
          fromStart: '2026-03-02',
          fromFinish: '2026-03-04',
          toDuration: 2,
          fromDuration: 5,
          cal,
        }),
      ).toBe('2026-03-10')
    })

    it('−50% → ceil(−2.5)=−2（宁晚勿早）', () => {
      expect(
        forwardBound({
          dep: dep('FS', { kind: 'percent', value: -50 }),
          fromStart: '2026-03-02',
          fromFinish: '2026-03-04',
          toDuration: 2,
          fromDuration: 5,
          cal,
        }),
      ).toBe('2026-03-03')
    })

    it('前置工期 0（里程碑）→ 0', () => {
      expect(
        forwardBound({
          dep: dep('FS', { kind: 'percent', value: 50 }),
          fromStart: '2026-03-02',
          fromFinish: '2026-03-04',
          toDuration: 2,
          fromDuration: 0,
          cal,
        }),
      ).toBe('2026-03-05')
    })

    it('effectiveLagWorkdays 对 elapsedDays 返回 NaN（防御）', () => {
      expect(Number.isNaN(effectiveLagWorkdays({ kind: 'elapsedDays', days: 1 }, 5))).toBe(true)
    })
  })

  describe('裸数字兼容', () => {
    it('asLag(1) 等价 { kind: "workdays", days: 1 }', () => {
      expect(asLag(1)).toEqual({ kind: 'workdays', days: 1 })
    })

    it('forwardBound 容忍 lag 传裸数字', () => {
      expect(
        forwardBound({
          dep: dep('FS', 1 as unknown as Lag),
          fromStart: '2026-03-02',
          fromFinish: '2026-03-04',
          toDuration: 2,
          fromDuration: 3,
          cal,
        }),
      ).toBe('2026-03-06')
    })
  })
})
