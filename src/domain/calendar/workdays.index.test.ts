/**
 * 日历例外索引（`WorkdayIndex`）的正确性守卫：
 *
 * 1. **差分模糊测试** —— 随机日历 × 随机区间，逐例比对「带索引的闭式解」与
 *    「逐日实现」（后者 = 改动前的冻结行为，是这里的**对照真值**）。这是本优化的
 *    核心正确性证明：两条路径必须逐位相等（含 `a > b` 的 −0 细节）。
 * 2. **就地改动守卫** —— 仓库的测试会就地写 `cal.exceptions[...]`。任何按日历对象
 *    身份缓存例外表的实现都会读到陈旧值。这里断言：改动后**下一次** `solve()` /
 *    下一次 `buildWorkdayIndex` 如实反映改动（索引是每次 `solve()` 现建的）。
 *
 * 时区无关性：整数民用历算术（`dateUtils` 的 days-from-civil）本就与 TZ / DST 无关，
 * 逐日实现与闭式解都只吃整数天。本文件在仓库固定的 `TZ=America/New_York` 下跑；
 * 证据里另在 `UTC` / `Asia/Shanghai` 下重跑全绿（见提交说明）。
 */
import { describe, it, expect } from 'vitest'
import { createCalendar, createProject, createTask } from '../model/factories'
import type { Calendar, CalendarException, DateStr } from '../model/types'
import { dayToIso, epochDay } from '../dateUtils'
import { buildWorkdayIndex, workdaysBetween, workdaysInclusive } from './workdays'
import { solve } from '../scheduler'

/** 确定性 PRNG（mulberry32）—— 固定种子 → 可复现，CI 与本地同结果 */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const BASE = epochDay('2020-01-01')
const isoAt = (offset: number): DateStr => dayToIso(BASE + offset)

/** 随机工作周（含全周休 / 全周工作 / 任意形态）+ 随机例外（holiday / custom 混合） */
function randomCalendar(rng: () => number): Calendar {
  const cal = createCalendar()
  const weekShape = rng()
  if (weekShape < 0.15) {
    cal.workingDays = [false, false, false, false, false, false, false] // 全休
  } else if (weekShape < 0.3) {
    cal.workingDays = [true, true, true, true, true, true, true] // 全工作
  } else {
    cal.workingDays = [0, 1, 2, 3, 4, 5, 6].map(() => rng() < 0.6) as Calendar['workingDays']
  }

  const n = Math.floor(rng() * 40)
  for (let i = 0; i < n; i += 1) {
    const offset = Math.floor(rng() * 400) - 200 // 集中在 BASE 附近
    const iso = isoAt(offset)
    const exc: CalendarException =
      rng() < 0.5
        ? { kind: 'holiday' }
        : { kind: 'custom', start: `${iso}T09:00`, end: `${iso}T12:00` }
    cal.exceptions[iso] = exc
  }
  return cal
}

/** 随机区间：含空（a===b）、反向（a>b）、跨例外、远离例外集 */
function randomPair(rng: () => number): [DateStr, DateStr] {
  const r = rng()
  if (r < 0.1) {
    const iso = isoAt(Math.floor(rng() * 400) - 200)
    return [iso, iso] // 空区间
  }
  const span = r < 0.3 ? Math.floor(rng() * 4000) - 2000 : Math.floor(rng() * 40) - 20
  const a = Math.floor(rng() * 400) - 200
  const b = a + span
  return [isoAt(a), isoAt(b)]
}

describe('WorkdayIndex —— 语义钉死（带索引的闭式解，与 workdays.test.ts 同口径）', () => {
  const cal = createCalendar() // 2026-03-06 周五 / 03-07 六 / 03-08 日 / 03-09 一
  const index = buildWorkdayIndex(cal)

  it('左闭右开 / 方向 / 例外', () => {
    expect(workdaysBetween('2026-03-06', '2026-03-06', cal, index)).toBe(0) // 空
    expect(workdaysBetween('2026-03-06', '2026-03-09', cal, index)).toBe(1) // 只数周五
    expect(workdaysBetween('2026-03-09', '2026-03-16', cal, index)).toBe(5) // 整周
    expect(workdaysBetween('2026-03-09', '2026-03-06', cal, index)).toBe(-1) // 反向

    const holiday = createCalendar()
    holiday.exceptions['2026-03-09'] = { kind: 'holiday' } // 周一放假
    const holidayIndex = buildWorkdayIndex(holiday)
    expect(workdaysBetween('2026-03-09', '2026-03-16', holiday, holidayIndex)).toBe(4)
    expect(workdaysBetween('2026-03-06', '2026-03-10', holiday, holidayIndex)).toBe(1) // 03-06 五、03-09 假

    const custom = createCalendar()
    custom.exceptions['2026-03-07'] = { kind: 'custom', start: '2026-03-07T09:00', end: '2026-03-07T12:00' }
    const customIndex = buildWorkdayIndex(custom)
    expect(workdaysBetween('2026-03-06', '2026-03-09', custom, customIndex)).toBe(2) // 周五 + 周六补班
  })
})

describe('WorkdayIndex —— 差分模糊测试（闭式解 vs 逐日真值）', () => {
  it('200 组随机日历 × 200 组随机区间，逐例逐位相等', () => {
    const rng = mulberry32(0x5eed)
    let checked = 0
    let mismatches = 0
    const firstMismatch: string[] = []

    for (let c = 0; c < 200; c += 1) {
      const cal = randomCalendar(rng)
      const index = buildWorkdayIndex(cal)
      for (let k = 0; k < 200; k += 1) {
        const [a, b] = randomPair(rng)
        // 不带索引 = 逐日实现（冻结真值）；带索引 = 闭式解。
        const truth = workdaysBetween(a, b, cal)
        const fast = workdaysBetween(a, b, cal, index)
        checked += 1
        if (!Object.is(truth, fast)) {
          mismatches += 1
          if (firstMismatch.length < 5) {
            firstMismatch.push(`cal#${c} [${a}, ${b}) truth=${truth} fast=${fast}`)
          }
        }
      }
    }

    expect(mismatches, `mismatches:\n${firstMismatch.join('\n')}`).toBe(0)
    expect(checked).toBe(200 * 200)
  }, 60_000) // 显式超时：40000 例 × 逐日真值 —— 并行跑套件时别撞缺省 5s 闸门

  it('workdaysInclusive 同样逐位相等（含吸附路径）', () => {
    const rng = mulberry32(0xbeef)
    let mismatches = 0
    const firstMismatch: string[] = []
    for (let c = 0; c < 100; c += 1) {
      const cal = randomCalendar(rng)
      // workdaysInclusive 会先 snapToWorkday —— 「一周里一个工作日都没有」的病态日历
      // 会让它在**两条路径上都抛**（与本次改动无关）。跳过这类日历，只比对有意义者。
      if (!cal.workingDays.some(Boolean)) continue
      const index = buildWorkdayIndex(cal)
      for (let k = 0; k < 100; k += 1) {
        const [a, b] = randomPair(rng)
        const truth = workdaysInclusive(a, b, cal)
        const fast = workdaysInclusive(a, b, cal, index)
        if (!Object.is(truth, fast)) {
          mismatches += 1
          if (firstMismatch.length < 5) {
            firstMismatch.push(`[${a}, ${b}) truth=${truth} fast=${fast}`)
          }
        }
      }
    }
    expect(mismatches, `mismatches:\n${firstMismatch.join('\n')}`).toBe(0)
  }, 60_000)

  it('非规范键（isWorkdayDay 查不中）不改变结果 —— 与逐日实现同口径', () => {
    const cal = createCalendar()
    // '2026-3-9' 非规范：旧实现按规范键 '2026-03-09' 查表 → 查不中 → 忽略。
    cal.exceptions['2026-3-9'] = { kind: 'holiday' }
    const index = buildWorkdayIndex(cal)
    expect(workdaysBetween('2026-03-09', '2026-03-16', cal)).toBe(5)
    expect(workdaysBetween('2026-03-09', '2026-03-16', cal, index)).toBe(5)
    // 同一天的规范键则生效，两条路径一致
    cal.exceptions['2026-03-09'] = { kind: 'holiday' }
    const index2 = buildWorkdayIndex(cal)
    expect(workdaysBetween('2026-03-09', '2026-03-16', cal)).toBe(4)
    expect(workdaysBetween('2026-03-09', '2026-03-16', cal, index2)).toBe(4)
  })

  it('畸形端点（NaN）回退逐日实现 —— 结果一致', () => {
    const cal = createCalendar()
    const index = buildWorkdayIndex(cal)
    expect(workdaysBetween('garbage', '2026-03-16', cal)).toBe(
      workdaysBetween('garbage', '2026-03-16', cal, index),
    )
    expect(workdaysBetween('2026-03-09', 'garbage', cal)).toBe(
      workdaysBetween('2026-03-09', 'garbage', cal, index),
    )
  })
})

describe('就地改动日历 —— 不做按对象身份的缓存（陷阱守卫）', () => {
  it('改动 exceptions 后，新一次 buildWorkdayIndex 如实反映', () => {
    const cal = createCalendar()
    const before = buildWorkdayIndex(cal)
    expect(workdaysBetween('2026-03-09', '2026-03-16', cal, before)).toBe(5)

    // 就地写入（正是仓库测试的写法：同一对象，改字段）
    cal.exceptions['2026-03-10'] = { kind: 'holiday' }

    // 旧索引若被复用会读陈旧 → 这里刻意**重新建**索引，断言新索引看到改动。
    const after = buildWorkdayIndex(cal)
    expect(workdaysBetween('2026-03-09', '2026-03-16', cal, after)).toBe(4)
    // 不带索引的公开路径（逐日）同样看到改动
    expect(workdaysBetween('2026-03-09', '2026-03-16', cal)).toBe(4)
  })

  it('solve() 每次现建索引：日历就地改动后再次 solve 反映新例外', () => {
    const project = createProject('就地改动', '2026-03-02')
    const cal = project.calendars[project.calendarId]
    const t = createTask({ name: 'T', duration: 5 })
    project.tasks[t.id] = t
    project.rootIds.push(t.id)

    const budget = { maxIterations: 1000, maxElapsedMs: Number.POSITIVE_INFINITY }
    // 2026-03-02(一) 起 5 个工作日 = 03-02,03,04,05,06 → 03-06(五)
    const first = solve(project, budget).schedules[t.id].earlyFinish
    expect(first).toBe('2026-03-06')

    cal.exceptions['2026-03-04'] = { kind: 'holiday' } // 就地改动
    // 若索引被跨 solve 按对象身份缓存 → 这里会仍读到 03-06（陈旧）。
    const second = solve(project, budget).schedules[t.id].earlyFinish
    expect(second).toBe('2026-03-09')
  })
})
