import { describe, it, expect, beforeEach } from 'vitest'
import { createCalendar, createDependency, createProject, createTask } from '../domain/model/factories'
import type { Project, Scheduling, TaskId } from '../domain/model/types'
import { addDays } from '../domain/calendar/workdays'
import { solve } from '../domain/scheduler'
import { __resetRegistryForTests, execute, registerHandler } from '../commands/registry'
import { taskHandlers } from '../commands/taskCommands'
import type { CommandType } from '../commands/types'
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
    name: 'startOn 03-04',
    scheduling: { mode: 'constraint', type: 'startOn', date: '2026-03-04' },
  },
  {
    // 关键用例：完成日被钉住、开始日由工期**反推**。
    // 影子若把 scheduling 改写成 startOn，开始日就不再随工期移动 —— 影子会骗人。
    name: 'finishOn 03-04',
    scheduling: { mode: 'constraint', type: 'finishOn', date: '2026-03-04' },
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
        const originTask = { startDate: before[taskId].earlyStart, duration: 3 }

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
        const originTask = { startDate: solve(project).schedules[taskId].earlyStart, duration: 3 }
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
          if (shadows[id]?.startDate !== finalSchedules[id].earlyStart) {
            mismatches.push(
              `${where}: 影子开始 ${shadows[id]?.startDate} ≠ 实际 ${finalSchedules[id].earlyStart}`,
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

  it('锁定 finishOn × resizeEnd 的具体数字（回归：影子曾经显示 03-02→03-06，实际是 02-26→03-04）', () => {
    const project = buildProject({ mode: 'constraint', type: 'finishOn', date: '2026-03-04' })
    const taskId = project.rootIds[0]

    const originTask = { startDate: '2026-03-02', duration: 3 }
    const dropDate = addDays(dragAnchorDate('resizeEnd', originTask, cal), 2) // 03-04 + 2
    const preview = computeDragPreview('resizeEnd', originTask, dropDate, cal)

    const shadow = solve(buildHypothetical(project, taskId, 'resizeEnd', preview)).schedules

    // finishOn 被保留：结束日仍是 03-04，工期 5 → 开始日反推到 02-26
    expect(shadow[taskId].earlyStart).toBe('2026-02-26')
    expect(shadow[taskId].earlyFinish).toBe('2026-03-04')
    // 下游跟着回退 —— 而不是被错误地推到 03-09
    expect(shadow[project.rootIds[1]].earlyStart).toBe('2026-03-05')
  })

  it('假设项目按模式改写字段：move/resizeStart 钉 startOn，resizeEnd 保留原 scheduling', () => {
    const finishOn: Scheduling = { mode: 'constraint', type: 'finishOn', date: '2026-03-04' }
    const project = buildProject(finishOn)
    const taskId = project.rootIds[0]
    const originTask = { startDate: '2026-03-02', duration: 3 }

    const previewFor = (mode: DragMode) =>
      computeDragPreview(mode, originTask, addDays(dragAnchorDate(mode, originTask, cal), 2), cal)

    // move：提交 task.moveTo（= startOn），假设项目同样钉 startOn
    const moved = buildHypothetical(project, taskId, 'move', previewFor('move'))
    expect(moved.tasks[taskId].scheduling).toEqual({
      mode: 'constraint',
      type: 'startOn',
      date: previewFor('move').startDate,
    })
    expect(moved.tasks[taskId].duration).toBe(3) // move 不改工期

    // resizeStart：提交 task.resize（= startOn + 工期）
    const resizedStart = buildHypothetical(project, taskId, 'resizeStart', previewFor('resizeStart'))
    expect(resizedStart.tasks[taskId].scheduling).toEqual({
      mode: 'constraint',
      type: 'startOn',
      date: previewFor('resizeStart').startDate,
    })
    expect(resizedStart.tasks[taskId].duration).toBe(previewFor('resizeStart').duration)

    // resizeEnd：提交 task.setDuration —— scheduling 必须原样保留
    const resizedEnd = buildHypothetical(project, taskId, 'resizeEnd', previewFor('resizeEnd'))
    expect(resizedEnd.tasks[taskId].scheduling).toEqual(finishOn)
    expect(resizedEnd.tasks[taskId].duration).toBe(previewFor('resizeEnd').duration)
  })
})
