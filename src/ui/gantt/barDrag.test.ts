import { describe, it, expect, beforeEach } from 'vitest'
import {
  createAssignment,
  createCalendar,
  createDependency,
  createProject,
  createResource,
  createTask,
} from '../../domain/model/factories'
import type { Project, Scheduling, TaskId } from '../../domain/model/types'
import { addDays, taskFinish } from '../../domain/calendar/workdays'
import { solve } from '../../domain/scheduler'
import { __resetRegistryForTests, execute, registerHandler } from '../../commands/registry'
import { taskHandlers } from '../../commands/taskCommands'
import type { CommandType } from '../../commands/types'
import {
  buildHypothetical,
  buildShadowTasks,
  computeDragPreview,
  daysBetweenPixels,
  dragAnchorDate,
  dragCommitCommands,
  dragOrigin,
  type DragMode,
} from './barDrag'

// 2026-03-02 周一，03-06 周五，03-07 周六，03-09 周一
const cal = createCalendar()
const origin = { startDate: '2026-03-02', duration: 3 } // 03-02 → 03-04

describe('daysBetweenPixels', () => {
  it('按每天的像素宽度换算天数', () => {
    expect(daysBetweenPixels(90, 30)).toBe(3)
  })

  it('向零取整，避免亚像素抖动', () => {
    expect(daysBetweenPixels(44, 30)).toBe(1)
    expect(daysBetweenPixels(-44, 30)).toBe(-1)
  })

  it('负数方向同样正确', () => {
    expect(daysBetweenPixels(-90, 30)).toBe(-3)
  })

  it('左右对称：不足一天时两个方向都不进位', () => {
    // 用 floor 会让 -15/30 → -1（整体左移一天），而 +15/30 → 0。
    // 这条断言专门锁住「向零截断」这一对称性。
    expect(daysBetweenPixels(15, 30)).toBe(0)
    expect(daysBetweenPixels(-15, 30)).toBe(0)
    expect(daysBetweenPixels(44, 30)).toBe(daysBetweenPixels(-44, 30) * -1)
  })
})

describe('dragAnchorDate', () => {
  it('move / resizeStart 抓左缘，锚点是开始日', () => {
    expect(dragAnchorDate('move', origin, cal)).toBe('2026-03-02')
    expect(dragAnchorDate('resizeStart', origin, cal)).toBe('2026-03-02')
  })

  it('resizeEnd 抓右缘，锚点是结束日', () => {
    // 工期 3 从 03-02 起 → 结束于 03-04
    expect(dragAnchorDate('resizeEnd', origin, cal)).toBe('2026-03-04')
  })

  it('回归：右把手拖 N 天，工期正好变化 N 天', () => {
    // 若锚点错用开始日，这条会算出 duration 3（拖了等于没拖）。
    const dropDate = addDays(dragAnchorDate('resizeEnd', origin, cal), 2) // 03-04 + 2 = 03-06
    expect(computeDragPreview('resizeEnd', origin, dropDate, cal)).toEqual({
      startDate: '2026-03-02',
      duration: 5,
    })
  })
})

describe('computeDragPreview — move（整体平移）', () => {
  it('工期不变，开始日期按工作日平移', () => {
    // 03-05 是周四；相对 03-02 是 +3 个工作日 → 03-05
    expect(computeDragPreview('move', origin, '2026-03-05', cal)).toEqual({
      startDate: '2026-03-05',
      duration: 3,
    })
  })

  it('落点在周六时吸附到下一个工作日', () => {
    expect(computeDragPreview('move', origin, '2026-03-07', cal).startDate).toBe('2026-03-09')
  })
})

describe('computeDragPreview — resizeEnd（改工期）', () => {
  it('向右拖 2 个工作日使工期 +2', () => {
    const preview = computeDragPreview('resizeEnd', origin, '2026-03-06', cal)
    expect(preview).toEqual({ startDate: '2026-03-02', duration: 5 })
  })

  it('工期不会被拖到 0 以下', () => {
    expect(computeDragPreview('resizeEnd', origin, '2026-02-01', cal).duration).toBe(1)
  })
})

describe('computeDragPreview — resizeStart（改开始）', () => {
  it('向右拖 1 个工作日使开始推后、工期缩短', () => {
    expect(computeDragPreview('resizeStart', origin, '2026-03-03', cal)).toEqual({
      startDate: '2026-03-03',
      duration: 2,
    })
  })

  it('向左拖使开始提前、工期拉长', () => {
    expect(computeDragPreview('resizeStart', origin, '2026-02-27', cal)).toEqual({
      startDate: '2026-02-27',
      duration: 4,
    })
  })
})

// ─────────────────────────────────────────────────────────────
// 不变式：影子 == 提交
//
// 影子预览唯一的职责是「如实预告松手后会发生什么」。一旦 `buildHypothetical`
// 与真正提交的命令（`dragCommitCommands`）对被拖任务的字段描述不一致，用户就会
// 看到一个**从未发生过**的结果 —— 这是本任务最严重的一类 bug。
//
// 这个套件把该不变式变成可执行判据：对每种 scheduling × 每种拖拽模式，
// 分别算出「假设项目的排期」与「真正 dispatch 后的排期」，断言二者逐字段相等。
// 将来谁改了提交路径却忘了同步假设项目，这里立刻变红。
// ─────────────────────────────────────────────────────────────

const SCHEDULINGS: { name: string; scheduling: Scheduling }[] = [
  { name: 'auto', scheduling: { mode: 'auto' } },
  {
    // manual 区间 [03-04, 03-06]（工期 3）。钉死不动。
    name: 'manual 03-04',
    scheduling: { mode: 'manual', start: '2026-03-04', finish: '2026-03-06' },
  },
  {
    // auto + start 约束：开始下界 03-04（宽于项目起点），与 manual 情形可对照。
    name: 'auto + startNoEarlierThan 03-04',
    scheduling: {
      mode: 'auto',
      startConstraint: { type: 'startNoEarlierThan', date: '2026-03-04' },
    },
  },
]

const MODES: DragMode[] = ['move', 'resizeStart', 'resizeEnd']

/** A → B → C 的链条，A 带给定约束 */
function buildProject(scheduling: Scheduling): Project {
  const base = createProject('影子一致性', '2026-03-02')
  const a = createTask({ name: 'A', duration: 3 })
  const b = createTask({ name: 'B', duration: 2 })
  const c = createTask({ name: 'C', duration: 2 })

  const dep1 = createDependency(a.id, b.id)
  const dep2 = createDependency(b.id, c.id)

  return {
    ...base,
    tasks: {
      [a.id]: { ...a, scheduling },
      [b.id]: b,
      [c.id]: c,
    },
    rootIds: [a.id, b.id, c.id],
    dependencies: { [dep1.id]: dep1, [dep2.id]: dep2 },
  }
}

/** 把命令序列依次应用到 project —— 与 ProjectView.onCommit 的落盘方式一致 */
function applyCommands(project: Project, commands: ReturnType<typeof dragCommitCommands>): Project {
  let next = project
  for (const command of commands) {
    next = execute(next, command).project
  }
  return next
}

describe('不变式：影子预览与提交结果一致', () => {
  beforeEach(() => {
    __resetRegistryForTests()
    for (const [type, handler] of Object.entries(taskHandlers)) {
      registerHandler(type as CommandType, handler)
    }
  })

  for (const { name, scheduling } of SCHEDULINGS) {
    for (const mode of MODES) {
      it(`${name} × ${mode}：假设排期 == 实际提交后的排期`, () => {
        const project = buildProject(scheduling)
        const taskId: TaskId = project.rootIds[0]

        const before = solve(project).schedules
        // originTask 描述「用户当前看到的条起点」，必须与 UI 用同一字段
        const originTask = { startDate: before[taskId].scheduledStart, duration: 3 }

        // 拖 N 个自然日；N 由模式自身的锚点推演，与 hook 的算法一致
        const dropDate = addDays(dragAnchorDate(mode, originTask, cal), 2)
        const preview = computeDragPreview(mode, originTask, dropDate, cal)

        const shadow = solve(buildHypothetical(project, taskId, mode, preview)).schedules
        const final = solve(applyCommands(project, dragCommitCommands(mode, taskId, preview)))
          .schedules

        expect(shadow).toEqual(final)
      })
    }
  }

  it('渲染层不变式：每根条画出的影子 == 提交后它真正的位置（含被拖条本身）', () => {
    const mismatches: string[] = []

    for (const { name, scheduling } of SCHEDULINGS) {
      for (const mode of MODES) {
        const project = buildProject(scheduling)
        const taskId = project.rootIds[0]
        const originTask = { startDate: solve(project).schedules[taskId].scheduledStart, duration: 3 }
        const preview = computeDragPreview(
          mode,
          originTask,
          addDays(dragAnchorDate(mode, originTask, cal), 2),
          cal,
        )

        // 渲染用的影子（含被拖任务） vs 实际提交后的 project
        const shadows = buildShadowTasks(project, taskId, mode, preview)
        const finalProject = applyCommands(project, dragCommitCommands(mode, taskId, preview))
        const finalSchedules = solve(finalProject).schedules

        for (const id of Object.keys(finalSchedules)) {
          const where = `${name} × ${mode} × ${id}`
          // 影子画出的位置必须等于提交后该任务的真实位置与工期 ——
          // 这条断言覆盖「被拖条也走 buildShadowTasks」这一要求
          if (shadows[id]?.startDate !== finalSchedules[id].scheduledStart) {
            mismatches.push(
              `${where}: 影子开始 ${shadows[id]?.startDate} ≠ 实际 ${finalSchedules[id].scheduledStart}`,
            )
          }
          if (shadows[id]?.duration !== finalProject.tasks[id].duration) {
            mismatches.push(
              `${where}: 影子工期 ${shadows[id]?.duration} ≠ 实际 ${finalProject.tasks[id].duration}`,
            )
          }
        }
      }
    }

    expect(mismatches).toEqual([])
  })

  it('manual × resizeEnd 的具体数字（拖右把手加宽区间，下游跟着顺移）', () => {
    const project = buildProject({ mode: 'manual', start: '2026-03-04', finish: '2026-03-06' })
    const taskId = project.rootIds[0]

    const originTask = { startDate: '2026-03-04', duration: 3 }
    const dropDate = addDays(dragAnchorDate('resizeEnd', originTask, cal), 2) // 03-06 + 2
    const preview = computeDragPreview('resizeEnd', originTask, dropDate, cal)
    expect(preview).toEqual({ startDate: '2026-03-04', duration: 4 })

    const shadow = solve(buildHypothetical(project, taskId, 'resizeEnd', preview)).schedules

    // 开始日不动、结束日右移到 03-09；影子描述的是「用户看到的排期」，故断言 scheduled*
    expect(shadow[taskId].scheduledStart).toBe('2026-03-04')
    expect(shadow[taskId].scheduledFinish).toBe('2026-03-09')
    // 下游 FS 紧随其后 → 03-10
    expect(shadow[project.rootIds[1]].scheduledStart).toBe('2026-03-10')
  })

  it('假设项目一律改写成 manual（三种模式同形：区间 = 落点 + 工期）', () => {
    const scheduling: Scheduling = { mode: 'manual', start: '2026-03-04', finish: '2026-03-06' }
    const project = buildProject(scheduling)
    const taskId = project.rootIds[0]
    const originTask = { startDate: '2026-03-04', duration: 3 }

    const previewFor = (mode: DragMode) =>
      computeDragPreview(mode, originTask, addDays(dragAnchorDate(mode, originTask, cal), 2), cal)

    for (const mode of MODES) {
      const preview = previewFor(mode)
      const hypothetical = buildHypothetical(project, taskId, mode, preview)
      // 三种模式都落 manual：start 取落点、finish 由工期折算 —— 与 dragCommitCommands 同形
      expect(hypothetical.tasks[taskId].scheduling).toEqual({
        mode: 'manual',
        start: preview.startDate,
        finish: taskFinish(preview.startDate, preview.duration, cal),
      })
      expect(hypothetical.tasks[taskId].duration).toBe(preview.duration)
    }
  })

  it('manual 里程碑 × move：影子与落盘的 duration 都保持 0（零宽区间不算 1 天）', () => {
    const base = createProject('里程碑影子', '2026-03-02')
    const milestone = { ...createTask({ name: 'M', duration: 0 }), kind: 'milestone' as const }
    const project: Project = { ...base, tasks: { [milestone.id]: milestone }, rootIds: [milestone.id] }
    const taskId = milestone.id

    // 起点工期 = task.duration（= 0）—— 与 ProjectView 对里程碑的取法一致
    // （若这里误用 workdaysInclusive 会把零宽区间量成 1）。
    const originTask = { startDate: '2026-03-10', duration: 0 }
    const preview = computeDragPreview('move', originTask, '2026-03-12', cal)
    expect(preview).toEqual({ startDate: '2026-03-12', duration: 0 })

    const hypothetical = buildHypothetical(project, taskId, 'move', preview)
    const finalProject = applyCommands(project, dragCommitCommands('move', taskId, preview))

    expect(hypothetical.tasks[taskId].duration).toBe(0)
    expect(finalProject.tasks[taskId].duration).toBe(0)

    const shadow = solve(hypothetical).schedules
    const final = solve(finalProject).schedules
    expect(shadow[taskId]).toEqual(final[taskId])
    expect(shadow[taskId].scheduledStart).toBe('2026-03-12')
    expect(shadow[taskId].scheduledFinish).toBe('2026-03-12')
  })
})

// ─────────────────────────────────────────────────────────────
// Critical 回归：fixedEffort 任务的**有效工期** ≠ `task.duration`。
// 引擎按 `ceil(effort / Σunits)` 覆盖 duration（`solve` 入口），甘特条按有效工期渲染。
// 拖拽若把宽度钉到 `task.duration` 这个旧值，用户「看到 2 天、拖完变 4 天」，
// 整条下游链跟着被带走 —— 且无任何报错。v5 里同样的拖拽只写 startOn、不动宽度，
// 所以这是 Task 2 引入的回归。
// ─────────────────────────────────────────────────────────────
describe('拖拽保留有效工期（fixedEffort：duration ≠ 视觉宽度）', () => {
  beforeEach(() => {
    __resetRegistryForTests()
    for (const [type, handler] of Object.entries(taskHandlers)) {
      registerHandler(type as CommandType, handler)
    }
  })

  /** fixedEffort：effort 4、Σunits 2 → 有效工期 2；`task.duration` 停在 4 */
  function fixedEffortProject() {
    const base = createProject('有效工期', '2026-03-02')
    const a = createTask({ name: 'A', duration: 4 })
    const b = createTask({ name: 'B', duration: 1 })
    const resource = createResource({ name: 'R' }) // availability 默认 1
    const assignment = createAssignment({ taskId: a.id, resourceId: resource.id, units: 2 })
    const dep = createDependency(a.id, b.id)
    const project: Project = {
      ...base,
      tasks: { [a.id]: { ...a, effortMode: 'fixedEffort', effort: 4 }, [b.id]: b },
      rootIds: [a.id, b.id],
      dependencies: { [dep.id]: dep },
      resources: { [resource.id]: resource },
      assignments: { [assignment.id]: assignment },
    }
    return { project, aId: a.id, bId: b.id }
  }

  it('前提：引擎有效工期为 2，而 task.duration 仍是 4', () => {
    const { project, aId } = fixedEffortProject()
    expect(project.tasks[aId].duration).toBe(4)
    const s = solve(project).schedules[aId]
    expect(s.scheduledStart).toBe('2026-03-02')
    expect(s.scheduledFinish).toBe('2026-03-03') // 2 个工作日 = 视觉宽度
  })

  it('dragOrigin 取排期跨度（有效工期 2），而非 task.duration（4）', () => {
    const { project, aId } = fixedEffortProject()
    const o = dragOrigin(project.tasks[aId], solve(project).schedules[aId], cal)
    expect(o).toEqual({ startDate: '2026-03-02', duration: 2 })
  })

  it('move：影子 == 落盘（假设项目与提交都用视觉宽度）', () => {
    const { project, aId } = fixedEffortProject()
    const o = dragOrigin(project.tasks[aId], solve(project).schedules[aId], cal)
    const preview = computeDragPreview('move', o, '2026-03-05', cal)

    const hypothetical = buildHypothetical(project, aId, 'move', preview)
    const committed = applyCommands(project, dragCommitCommands('move', aId, preview))

    expect(hypothetical.tasks[aId].duration).toBe(committed.tasks[aId].duration)
    expect(solve(hypothetical).schedules[aId]).toEqual(solve(committed).schedules[aId])
  })

  it('resizeEnd：宽度以**视觉宽度**为基准（2 → 3），不是 stale 的 4', () => {
    const { project, aId } = fixedEffortProject()
    const o = dragOrigin(project.tasks[aId], solve(project).schedules[aId], cal)

    // 从视觉右缘（03-03）再往右一天
    const drop = addDays(dragAnchorDate('resizeEnd', o, cal), 1)
    const preview = computeDragPreview('resizeEnd', o, drop, cal)
    expect(preview).toEqual({ startDate: '2026-03-02', duration: 3 })

    const after = applyCommands(project, dragCommitCommands('resizeEnd', aId, preview))
    expect(after.tasks[aId].duration).toBe(3)
    expect(after.tasks[aId].scheduling).toEqual({
      mode: 'manual',
      start: '2026-03-02',
      finish: '2026-03-04',
    })
  })

  it('move：落盘宽度 = 视觉宽度 2（不是 stale 的 4），下游随之', () => {
    const { project, aId, bId } = fixedEffortProject()
    // 视觉宽度 = 排期跨度 = 2（引擎的有效工期）
    const o = { startDate: '2026-03-02', duration: 2 }
    const preview = computeDragPreview('move', o, '2026-03-05', cal)
    expect(preview).toEqual({ startDate: '2026-03-05', duration: 2 })

    const after = applyCommands(project, dragCommitCommands('move', aId, preview))

    expect(after.tasks[aId].duration).toBe(2)
    expect(after.tasks[aId].scheduling).toEqual({
      mode: 'manual',
      start: '2026-03-05',
      finish: '2026-03-06',
    })
    // B 紧随 A 之后（FS）—— 曾因宽度被掰成 4 而被推迟两天
    expect(solve(after).schedules[bId].scheduledStart).toBe('2026-03-09')
  })
})
