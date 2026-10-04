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
import {
  addWorkdays,
  buildWorkdayIndex,
  isWorkday,
  nextWorkday,
  prevWorkday,
  snapToWorkday,
  snapToWorkdayOrPrevious,
  taskFinish,
  taskStart,
  workdaysBetween,
  workdaysInclusive,
  workdaysInRange,
} from './workdays'
import { solve } from '../scheduler'

/** == workdays.ts 的 `MAX_SCAN_DAYS` == calendarCommands.ts 的 `MAX_RANGE_DAYS`（两者同值，
 *  这正是「一条最大长度 addExceptionRange 即触发扫描窗溢出」的原因）。 */
const SCAN_LIMIT = 3660

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

/**
 * ── advance/search 家族：rank/select 闭环 vs 逐日扫描（差分模糊测试）───────────
 *
 * `nextWorkday` / `prevWorkday` / `snapToWorkday(OrPrevious)` / `addWorkdays` /
 * `taskFinish` / `taskStart` 此前逐日扫描；现在带索引走 `firstWorkdayIn` /
 * `lastWorkdayIn` / `selectByRank`（O(log k)）。这里对每个函数逐例比对
 * 「带索引」与「逐日实现」（后者是**改动前的冻结真值**）—— **逐字节相等**，
 * 且**抛错的场合也必须一致**（全休日历 / 超出 MAX_SCAN_DAYS 扫描窗）。
 *
 * 维度：任意 7 位 `workingDays` 形态（含全休 / 全工作日）、0–40 条 holiday/custom
 * 混合例外、随机天（含远离例外集）、`n ∈ {0, ±1, ±2, ±7, 大值, 小数}`。
 */
type Outcome = { ok: true; value: unknown } | { ok: false; msg: string }
function catchOutcome(fn: () => unknown): Outcome {
  try {
    return { ok: true, value: fn() }
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : String(e) }
  }
}
function outcomesEqual(a: Outcome, b: Outcome): boolean {
  if (a.ok !== b.ok) return false
  if (a.ok && b.ok) return JSON.stringify(a.value) === JSON.stringify(b.value)
  return !a.ok && !b.ok && a.msg === b.msg
}
function describeOutcome(o: Outcome): string {
  return o.ok ? JSON.stringify(o.value) : `THROW(${o.msg})`
}

function randomDay(rng: () => number): DateStr {
  return isoAt(Math.floor(rng() * 6000) - 3000)
}

describe('advance/search 家族 —— 差分模糊测试（带索引 vs 逐日真值）', () => {
  it('6 个函数 × 随机日历 × 随机输入，逐例逐位相等（含抛错一致）', () => {
    const rng = mulberry32(0xa11ce)
    const nValues = [0, 1, -1, 2, -2, 7, -7, 40, -40, 400, -400, 1.5, -2.5]
    let checked = 0
    let mismatches = 0
    const firstMismatch: string[] = []

    const check = (fn: string, truth: Outcome, fast: Outcome, ctx: string): void => {
      checked += 1
      if (!outcomesEqual(truth, fast)) {
        mismatches += 1
        if (firstMismatch.length < 8) {
          firstMismatch.push(`${fn} ${ctx}: truth=${describeOutcome(truth)} fast=${describeOutcome(fast)}`)
        }
      }
    }

    for (let c = 0; c < 300; c += 1) {
      const cal = randomCalendar(rng)
      const index = buildWorkdayIndex(cal)
      for (let k = 0; k < 120; k += 1) {
        const day = randomDay(rng)
        const ctx = `cal#${c} day=${day}`
        check('nextWorkday', catchOutcome(() => nextWorkday(day, cal)), catchOutcome(() => nextWorkday(day, cal, index)), ctx)
        check('prevWorkday', catchOutcome(() => prevWorkday(day, cal)), catchOutcome(() => prevWorkday(day, cal, index)), ctx)
        check('snapToWorkday', catchOutcome(() => snapToWorkday(day, cal)), catchOutcome(() => snapToWorkday(day, cal, index)), ctx)
        check('snapOrPrevious', catchOutcome(() => snapToWorkdayOrPrevious(day, cal)), catchOutcome(() => snapToWorkdayOrPrevious(day, cal, index)), ctx)
        const n = nValues[Math.floor(rng() * nValues.length)]
        check('addWorkdays', catchOutcome(() => addWorkdays(day, n, cal)), catchOutcome(() => addWorkdays(day, n, cal, index)), `${ctx} n=${n}`)
        const dur = Math.floor(rng() * 30)
        check('taskFinish', catchOutcome(() => taskFinish(day, dur, cal)), catchOutcome(() => taskFinish(day, dur, cal, index)), `${ctx} dur=${dur}`)
        check('taskStart', catchOutcome(() => taskStart(day, dur, cal)), catchOutcome(() => taskStart(day, dur, cal, index)), `${ctx} dur=${dur}`)
        const day2 = randomDay(rng)
        check('workdaysInclusive', catchOutcome(() => workdaysInclusive(day, day2, cal)), catchOutcome(() => workdaysInclusive(day, day2, cal, index)), `${ctx}..${day2}`)
        check('workdaysInRange', catchOutcome(() => workdaysInRange(day, day2, cal)), catchOutcome(() => workdaysInRange(day, day2, cal, index)), `${ctx}..${day2}`)
      }
    }

    expect(mismatches, `mismatches:\n${firstMismatch.join('\n')}`).toBe(0)
    expect(checked).toBe(300 * 120 * 9)
  }, 120_000)

  it('全休日历（workingDays 全 false）逐函数抛错一致', () => {
    const cal = createCalendar()
    cal.workingDays = [false, false, false, false, false, false, false]
    const index = buildWorkdayIndex(cal)
    for (const day of ['2026-03-06', '2026-03-07', '1970-01-01']) {
      for (const [name, fn] of [
        ['nextWorkday', (i: boolean) => nextWorkday(day, cal, i ? index : undefined)],
        ['prevWorkday', (i: boolean) => prevWorkday(day, cal, i ? index : undefined)],
        ['snapToWorkday', (i: boolean) => snapToWorkday(day, cal, i ? index : undefined)],
        ['snapOrPrevious', (i: boolean) => snapToWorkdayOrPrevious(day, cal, i ? index : undefined)],
        ['addWorkdays+3', (i: boolean) => addWorkdays(day, 3, cal, i ? index : undefined)],
        ['addWorkdays-3', (i: boolean) => addWorkdays(day, -3, cal, i ? index : undefined)],
        ['taskFinish', (i: boolean) => taskFinish(day, 5, cal, i ? index : undefined)],
        ['taskStart', (i: boolean) => taskStart(day, 5, cal, i ? index : undefined)],
      ] as const) {
        const truth = catchOutcome(() => fn(false))
        const fast = catchOutcome(() => fn(true))
        expect(truth.ok, `${name} 逐日实现应当抛错`).toBe(false)
        expect(outcomesEqual(truth, fast), `${name}: truth=${describeOutcome(truth)} fast=${describeOutcome(fast)}`).toBe(true)
      }
    }
  })

  it('全休日历 + 扫描窗内有一个 custom 例外 → 两条路径都返回它；窗外的则都抛错', () => {
    const setup = (excOffset: number) => {
      const cal = createCalendar()
      cal.workingDays = [false, false, false, false, false, false, false]
      const iso = isoAt(excOffset)
      cal.exceptions[iso] = { kind: 'custom', start: `${iso}T09:00`, end: `${iso}T12:00` }
      return { cal, iso, index: buildWorkdayIndex(cal) }
    }
    // 窗内（offset 100 <= MAX_SCAN_DAYS = 3660）：两条路径都命中同一个 custom 日。
    {
      const { cal, iso, index } = setup(100)
      expect(nextWorkday(isoAt(0), cal)).toBe(iso)
      expect(nextWorkday(isoAt(0), cal, index)).toBe(iso)
      expect(snapToWorkday(isoAt(0), cal, index)).toBe(iso)
      expect(addWorkdays(isoAt(0), 0, cal, index)).toBe(iso)
      // +1 个工作日需要「第二个工作日」—— 日历里只有一个 → 两条路径都抛错。
      expect(catchOutcome(() => addWorkdays(isoAt(0), 1, cal)).ok).toBe(false)
      expect(catchOutcome(() => addWorkdays(isoAt(0), 1, cal, index)).ok).toBe(false)
    }
    // 窗外（offset 4000 > 3660）：扫描不到 → 两条路径都抛同样的错。
    {
      const { cal, index } = setup(4000)
      const truth = catchOutcome(() => nextWorkday(isoAt(0), cal))
      const fast = catchOutcome(() => nextWorkday(isoAt(0), cal, index))
      expect(truth.ok).toBe(false)
      expect(outcomesEqual(truth, fast)).toBe(true)
      expect(catchOutcome(() => addWorkdays(isoAt(0), 1, cal, index)).ok).toBe(false)
    }
  })

  it('相邻工作日间隔 > SCAN_LIMIT：单步函数抛错一致；addWorkdays/task* 的已知分歧被钉死', () => {
    // 该日历**可由一条用户命令直接造出**：`calendarCommands.ts` 的 `MAX_RANGE_DAYS` 与
    // `workdays.ts` 的 `MAX_SCAN_DAYS` 同值（3660），故一条最大长度的
    // `calendar.addExceptionRange`（3660 个连续日历日全放假）即制造出 >3660 天的空档。
    // 这里复刻该命令的展开：holiday 落在 isoAt(1)..isoAt(3660)，使 isoAt(0)（周三）保持
    // 为工作日 —— 恰是「末日工作日 + 3660 天假期 + 之后才又有工作日」的形状。
    const cal = createCalendar() // 周一至周五工作
    for (let i = 1; i <= SCAN_LIMIT; i += 1) cal.exceptions[isoAt(i)] = { kind: 'holiday' }
    const index = buildWorkdayIndex(cal)

    const lastBeforeGap = isoAt(0)
    expect(isWorkday(lastBeforeGap, cal), '空档前最后一个工作日').toBe(true)
    // 索引版给出的真实「下一个工作日」：跨过 3660 天空档后的第一个工作日。
    const firstAfterGap = addWorkdays(lastBeforeGap, 1, cal, index)
    expect(epochDay(firstAfterGap) - epochDay(lastBeforeGap)).toBeGreaterThan(SCAN_LIMIT)

    // ① 单步函数：带索引与逐日**逐例一致**（值相同、抛错也相同）—— 扫描窗由距离判断显式
    //    保留，rank/select 不能改变它。空档内外的多个取样点都覆盖。
    for (const iso of [lastBeforeGap, isoAt(1000), isoAt(2000), firstAfterGap, isoAt(4000)]) {
      for (const [name, fn] of [
        ['nextWorkday', (i: boolean) => nextWorkday(iso, cal, i ? index : undefined)],
        ['prevWorkday', (i: boolean) => prevWorkday(iso, cal, i ? index : undefined)],
        ['snapToWorkday', (i: boolean) => snapToWorkday(iso, cal, i ? index : undefined)],
        ['snapOrPrevious', (i: boolean) => snapToWorkdayOrPrevious(iso, cal, i ? index : undefined)],
      ] as const) {
        const truth = catchOutcome(() => fn(false))
        const fast = catchOutcome(() => fn(true))
        expect(outcomesEqual(truth, fast), `${name}@${iso}: truth=${describeOutcome(truth)} fast=${describeOutcome(fast)}`).toBe(true)
      }
    }
    // 空档两端「下一个/上一个工作日」相距 > SCAN_LIMIT → 单步函数在两端都抛错（两条路径一致）。
    expect(catchOutcome(() => nextWorkday(lastBeforeGap, cal)).ok).toBe(false)
    expect(catchOutcome(() => nextWorkday(lastBeforeGap, cal, index)).ok).toBe(false)
    expect(catchOutcome(() => prevWorkday(firstAfterGap, cal)).ok).toBe(false)
    expect(catchOutcome(() => prevWorkday(firstAfterGap, cal, index)).ok).toBe(false)

    // ② 已知且**唯一**的分歧：addWorkdays / taskFinish / taskStart 逐日版中途抛错、索引版
    //    返回真正的下一个工作日（跨过空档）。此处把**分歧本身**钉死，作为有意行为而非意外。
    expect(catchOutcome(() => addWorkdays(lastBeforeGap, 1, cal)).ok, '逐日版应抛错').toBe(false)
    expect(addWorkdays(lastBeforeGap, 1, cal, index)).toBe(firstAfterGap)
    expect(catchOutcome(() => taskFinish(lastBeforeGap, 2, cal)).ok).toBe(false)
    expect(taskFinish(lastBeforeGap, 2, cal, index)).toBe(firstAfterGap)
    expect(catchOutcome(() => taskStart(firstAfterGap, 2, cal)).ok).toBe(false)
    expect(taskStart(firstAfterGap, 2, cal, index)).toBe(lastBeforeGap)
  })
})
