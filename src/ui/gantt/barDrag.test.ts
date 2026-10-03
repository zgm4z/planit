import { describe, it, expect, beforeEach } from 'vitest'
import { createCalendar, createDependency, createProject, createTask } from '../../domain/model/factories'
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
})
