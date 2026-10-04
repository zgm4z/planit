import type { Calendar, DateStr, Scheduling } from '../model/types'
import { dayToIso, epochDay, weekdayMon0 } from '../dateUtils'

// 把基础日期工具转出去，让 calendar/ 的调用方不必同时 import 两个模块
export { parseDate, formatDate, addDays } from '../dateUtils'

/** 单次搜索的上限，避免日历配置错误导致死循环 */
const MAX_SCAN_DAYS = 3660

/**
 * ── 内部一律走「天整数」（见 dateUtils 顶部的说明）──────────────────────────
 *
 * 对外的函数保持 `DateStr` 入参出参**不变**：每个函数把字符串边界各转一次
 * `epochDay(iso)`，之后全用整数运算，末尾 `dayToIso` 转回。下面的 `*Day` 是
 * **这份字符串 API 的内部实现**（模块私有，不导出）—— 提速来自 `epochDay`/
 * `dayToIso` 的 memo 命中，而不是让调用方直接用整数。若将来某个热点确实需要
 * 直接吃天整数，再按需把对应的 `*Day` 导出；现在不预留死接口。
 *
 * `isWorkdayDay` 对 `cal.exceptions` 只按**单日精确查表**（见 calendarCommands 的区间
 * 展开说明）。带索引的快路径（`buildWorkdayIndex` → `workdaysBetween` / advance/search
 * 家族）见下方 `WorkdayIndex` 一节：索引**每次 `solve()` 现建**，**绝不**按日历对象
 * 身份缓存例外表 —— 仓库测试会**就地**改 `cal.exceptions`，身份缓存会读到陈旧值。
 */
/** 周一 = 0 … 周日 = 6，与 Calendar.workingDays 的索引顺序一致 */
export function workdayIndex(iso: DateStr): number {
  return weekdayMon0(epochDay(iso))
}

/** 天整数版 `isWorkday`（字符串 API 的内部实现） */
function isWorkdayDay(day: number, cal: Calendar): boolean {
  // ⚠️ 查的是**规范键** `dayToIso(day)`，不是调用方原样的 `iso` 串。对规范输入
  // （`YYYY-MM-DD`，`dateTime.guard.test.ts` 守卫的形状，也是全仓唯一产出的形状）
  // 两者恒等；但 `'2026-3-6'` 这类非规范串会先被规范化，再查例外表 —— 与旧实现
  // 「拿原串直接查表」在非规范输入下结果可能不同（旧：查不到 → 按工作日；新：命中
  // 规范键 → 按例外）。这是有意的：例外表本就以规范日期为键。
  const exception = cal.exceptions[dayToIso(day)]
  if (exception) return exception.kind === 'custom'
  return cal.workingDays[weekdayMon0(day)]
}

export function isWorkday(iso: DateStr, cal: Calendar): boolean {
  return isWorkdayDay(epochDay(iso), cal)
}

/**
 * 下一个工作日（**严格**晚于 `day`）。带索引 → O(log k) 的 `firstWorkdayOnOrAfter` 一次
 * 定位；只有当结果越过 `MAX_SCAN_DAYS` 扫描窗（病态日历）时才与逐日实现一样**抛错**。
 */
function nextWorkdayDay(day: number, cal: Calendar, index?: WorkdayIndex): number {
  if (index) {
    const w = firstWorkdayOnOrAfter(day + 1, index)
    if (w !== null && w - day <= MAX_SCAN_DAYS) return w
  } else {
    for (let i = 1; i <= MAX_SCAN_DAYS; i += 1) {
      const cursor = day + i
      if (isWorkdayDay(cursor, cal)) return cursor
    }
  }
  throw new Error(`nextWorkday: 从 ${dayToIso(day)} 起扫描 ${MAX_SCAN_DAYS} 天未找到工作日，请检查日历配置`)
}

export function nextWorkday(iso: DateStr, cal: Calendar, index?: WorkdayIndex): DateStr {
  return dayToIso(nextWorkdayDay(epochDay(iso), cal, index))
}

/**
 * 上一个工作日（**严格**早于 `day`）。带索引 → O(log k) 的 `lastWorkdayOnOrBefore`
 * （扫描窗 `[day−MAX_SCAN_DAYS, day−1]`，与逐日实现一致）。
 */
function prevWorkdayDay(day: number, cal: Calendar, index?: WorkdayIndex): number {
  if (index) {
    const w = lastWorkdayOnOrBefore(day - 1, index)
    if (w !== null && day - w <= MAX_SCAN_DAYS) return w
  } else {
    for (let i = 1; i <= MAX_SCAN_DAYS; i += 1) {
      const cursor = day - i
      if (isWorkdayDay(cursor, cal)) return cursor
    }
  }
  throw new Error(`prevWorkday: 从 ${dayToIso(day)} 起扫描 ${MAX_SCAN_DAYS} 天未找到工作日，请检查日历配置`)
}

export function prevWorkday(iso: DateStr, cal: Calendar, index?: WorkdayIndex): DateStr {
  return dayToIso(prevWorkdayDay(epochDay(iso), cal, index))
}

/**
 * 当日或之后最近的工作日（on-or-after）。带索引 → O(log k)（已是工作日则早退）。
 * 找不到（越过扫描窗）时与逐日实现一样抛 **nextWorkday** 的错（旧实现就把它委托给
 * `nextWorkdayDay`）。
 */
function snapToWorkdayDay(day: number, cal: Calendar, index?: WorkdayIndex): number {
  if (index) {
    if (isWorkdayDay(day, cal)) return day
    const w = firstWorkdayOnOrAfter(day + 1, index)
    if (w !== null && w - day <= MAX_SCAN_DAYS) return w
    throw new Error(`nextWorkday: 从 ${dayToIso(day)} 起扫描 ${MAX_SCAN_DAYS} 天未找到工作日，请检查日历配置`)
  }
  return isWorkdayDay(day, cal) ? day : nextWorkdayDay(day, cal)
}

export function snapToWorkday(iso: DateStr, cal: Calendar, index?: WorkdayIndex): DateStr {
  return dayToIso(snapToWorkdayDay(epochDay(iso), cal, index))
}

/**
 * 上界归一：保留工作日，否则向前吸附到最近的工作日（当日或之前）。
 * 带索引 → O(log k)（扫描窗 `[day−MAX_SCAN_DAYS+1, day]`，与逐日实现一致）。
 */
function snapToWorkdayOrPreviousDay(day: number, cal: Calendar, index?: WorkdayIndex): number {
  if (index) {
    const w = lastWorkdayOnOrBefore(day, index)
    if (w !== null && day - w < MAX_SCAN_DAYS) return w
  } else {
    let cursor = day
    for (let i = 0; i < MAX_SCAN_DAYS; i += 1) {
      if (isWorkdayDay(cursor, cal)) return cursor
      cursor -= 1
    }
  }
  throw new Error(
    `snapToWorkdayOrPrevious: 从 ${dayToIso(day)} 起扫描 ${MAX_SCAN_DAYS} 天未找到工作日，请检查日历配置`,
  )
}

export function snapToWorkdayOrPrevious(
  iso: DateStr,
  cal: Calendar,
  index?: WorkdayIndex,
): DateStr {
  return dayToIso(snapToWorkdayOrPreviousDay(epochDay(iso), cal, index))
}

/**
 * 在 `iso` 基础上推进 `n` 个工作日。`n` 可为负。
 * 起点若落在非工作日，先吸附到下一个工作日再计数。
 *
 * `n` 非整数时逐日实现跑的是 `ceil(|n|)` 步（`for i<n` / `for i>n` 的边界），索引版
 * 用同一个 `ceil(|n|)` 一次 select 到位，逐字节一致（elapsed lag 的小数路径）。
 *
 * 索引版对一般日历（`perWeek > 0`）用一次 `selectByRank` —— O(log k)，取代原来的
 * `|n|` 次扫描。
 *
 * ⚠️ **已知且唯一的**不逐字节等价角落：`perWeek > 0` 且**相邻工作日间隔 > MAX_SCAN_DAYS**
 * 时，逐日版在中途抛错、索引版直达终点。该情形**一条用户命令即可造出**：
 * `calendarCommands.ts` 的 `MAX_RANGE_DAYS`（3660）与本文件的 `MAX_SCAN_DAYS`（3660）
 * 同值 → **一条最大长度的 `calendar.addExceptionRange`**（3660 个连续日历日全放假）
 * 就制造出 3664 天的空档（区间内周内日全为 holiday、周末本就不上班，整段只剩非工作日）。
 * 于是：旧的 `addWorkdays` / `taskFinish` / `taskStart` **抛错**（经 `forwardBound` /
 * `backwardBound` / `schedulingLowerBound` 令 `solve()` 一并崩掉）；索引版返回**真正的
 * 下一个工作日**（跨过空档）—— 语义上更正确，但失败模式由「响亮崩溃」变为「静默跨过」。
 * **单步函数（`nextWorkday` / `prevWorkday` / `snapToWorkday*`）不受影响**：它们仍显式
 * 校验扫描窗并抛同样的错（见 `nextWorkdayDay` 等的距离判断）。
 * `perWeek === 0`（全休周，工作日有限）退回逐日实现：逐步的 MAX_SCAN_DAYS 抛错语义
 * 原样保留（见 `addWorkdays` 的模糊测试）。
 */
function addWorkdaysDay(day: number, n: number, cal: Calendar, index?: WorkdayIndex): number {
  if (!index || index.perWeek === 0) {
    let cursor = snapToWorkdayDay(day, cal, index)
    for (let i = 0; i < n; i += 1) cursor = nextWorkdayDay(cursor, cal, index)
    for (let i = 0; i > n; i -= 1) cursor = prevWorkdayDay(cursor, cal, index)
    return cursor
  }
  const cursor = snapToWorkdayDay(day, cal, index)
  // 起点（工作日）的 rank = 它前面有几个工作日
  const r0 = rankBefore(cursor, index)
  const steps = Number.isFinite(n) ? Math.ceil(Math.abs(n)) : 0
  // 包含约束：正向结果 >= cursor，反向 <= cursor（再与 mag 窗口取交收紧二分范围）。
  return n < 0
    ? selectByRank(r0 - steps, index, Number.NEGATIVE_INFINITY, cursor)
    : selectByRank(r0 + steps, index, cursor)
}

export function addWorkdays(iso: DateStr, n: number, cal: Calendar, index?: WorkdayIndex): DateStr {
  return dayToIso(addWorkdaysDay(epochDay(iso), n, cal, index))
}

/**
 * ── 工作日计数的 O(log k) 闭式解（k = 日历例外条数）────────────────────────
 *
 * 旧实现 `workdaysBetween` 逐日 `isWorkdayDay` —— 一次调用 O(区间天数)。纯 CPM 的
 * `freeSlackOf` / `remainingSlack` 会对**跨整个项目跨度**的区间反复调用它，10k CPM
 * profile 里工作日计数占了源码自身时间的 ~41%（改后降到 <2%）。这里把「工作日的个数」
 * 拆成两项：
 *
 *   区间 [a,b) 的工作日数 = （纯周规则下 [a,b) 的工作日数）
 *                          + （落在 [a,b) 内、改变了工作日性的例外日 delta 之和）
 *
 * 第一项是**闭式**：任取一天 d，`[0,d)` 内的工作日数 = floor(d/7)·W + partialW[d mod 7]
 * （W = 每周工作日数，partialW = 一周内前 r 天的工作日数）。第二项把所有「例外日 delta」
 * 按天排序、取前缀和，再用**二分**求 `< D` 的部分和 → 整条查询 O(log k)。
 *
 * delta 的定义：例外**覆盖**周规则（与 `isWorkdayDay` 同口径）——
 *   · `custom` 落在非周工作日的日子 → +1（把它变成工作日）
 *   · `holiday` 落在周工作日的日子 → −1（把它变成非工作日）
 * 其余情况 delta = 0（例外不改变该日的「工作日性」）。
 *
 * ⚠️ **不按日历对象身份缓存**。仓库的测试会**就地**改 `cal.exceptions`
 * （`c.exceptions['2026-03-10'] = { kind: 'holiday' }`）—— 任何按 `exceptions` 身份
 * 缓存的表都会读到陈旧值、静默排错。这里的对策：索引**每次 `solve()` 在
 * `buildScheduleContext` 里现建一次**（求解期间日历不变，纯函数），公开的
 * `workdaysBetween(a, b, cal)`（不带索引）则原样走逐日实现 —— 保证任何调用点
 * 都不持有跨调用存活的缓存。见 `workdaysBetweenDay`。
 *
 * 只把**规范键**（`dayToIso(epochDay(key)) === key`）计入：`isWorkdayDay` 查的是
 * `cal.exceptions[dayToIso(day)]`，非规范键（如 `'2026-3-6'`）在旧实现里恒查不中
 * （等于没有例外）。索引如实照搬这一既有口径 —— 否则会与旧实现分歧。
 */
export interface WorkdayIndex {
  /** 改变工作日性的例外日（升序整数天）。与周规则一致的例外不进此表（delta = 0） */
  readonly exceptionDays: readonly number[]
  /** 前缀和：`exceptionPrefix[i]` = `exceptionDays[0..i-1]` 的 delta 之和 */
  readonly exceptionPrefix: readonly number[]
  /** 每周的工作日数 W */
  readonly perWeek: number
  /** `partialWeekly[r]` = 一周内前 r 天（自 epoch 对齐）的工作日数，r ∈ [0,7] */
  readonly partialWeekly: readonly number[]
  /**
   * Σ|delta|（`exceptionDays` 上各例外日 delta 的绝对值之和）。用作 select 二分窗口的
   * 半宽：任一天 x 的累计例外 `E(x) = exceptionCountBefore(x)` 落在 [−Σ|δ⁻|, +Σ|δ⁺|]
   * ⊆ [−exceptionMagnitude, exceptionMagnitude]。见 `selectByRank`。
   */
  readonly exceptionMagnitude: number
  /**
   * `perWeekSelect[c]` = 一周内最小的天偏移 r ∈ [0,6] 使 `partialWeekly[r] >= c`
   * （c ∈ [0,7]；无解时取 6）。`weeklySelect` 用它把「本周需累积 c 个工作日」O(1)
   * 折成天偏移，取代对 `partialWeekly` 的线性扫描。
   */
  readonly perWeekSelect: readonly number[]
}

/** 现建一份日历索引。只读 `cal`，不持有对其可变字段的长期缓存（见上方说明）。 */
export function buildWorkdayIndex(cal: Calendar): WorkdayIndex {
  const perWeek = cal.workingDays.reduce((n, ok) => n + (ok ? 1 : 0), 0)
  // partialWeekly[r] 只取决于 workingDays 与该天在一周里的位置（epoch 第 0 天是周四，
  // 故 weekdayMon0(j) = (j + 3) mod 7）—— 与具体日期无关，一次算好。
  const partialWeekly = new Array<number>(8)
  partialWeekly[0] = 0
  for (let r = 1; r <= 7; r += 1) {
    partialWeekly[r] = partialWeekly[r - 1] + (cal.workingDays[weekdayMon0(r - 1)] ? 1 : 0)
  }
  // perWeekSelect[c] = 最小的 r ∈ [0,6] 使 partialWeekly[r] >= c（partialWeekly 非减）
  const perWeekSelect = new Array<number>(8)
  {
    let r = 0
    for (let c = 0; c <= 7; c += 1) {
      while (r < 6 && partialWeekly[r] < c) r += 1
      perWeekSelect[c] = r
    }
  }

  const raws: { day: number; delta: number }[] = []
  let exceptionMagnitude = 0
  for (const key in cal.exceptions) {
    if (!Object.prototype.hasOwnProperty.call(cal.exceptions, key)) continue
    const day = epochDay(key)
    // 非规范键 / 畸形键：旧实现（按规范键查表）恒查不中 → 无 delta。如实跳过。
    if (!Number.isFinite(day) || dayToIso(day) !== key) continue
    const isWeeklyWorkday = cal.workingDays[weekdayMon0(day)]
    const isWorkdayNow = cal.exceptions[key].kind === 'custom'
    if (isWorkdayNow === isWeeklyWorkday) continue
    const delta = isWorkdayNow ? 1 : -1
    exceptionMagnitude += delta < 0 ? -delta : delta
    raws.push({ day, delta })
  }
  raws.sort((a, b) => a.day - b.day)

  const exceptionDays: number[] = []
  const exceptionPrefix: number[] = [0]
  for (const { day, delta } of raws) {
    const last = exceptionDays.length - 1
    if (last >= 0 && exceptionDays[last] === day) {
      // 同一天不可能出现两条规范键例外（Record 键唯一）；防御性合并，保持严格升序。
      exceptionPrefix[exceptionPrefix.length - 1] += delta
    } else {
      exceptionDays.push(day)
      exceptionPrefix.push(exceptionPrefix[exceptionPrefix.length - 1] + delta)
    }
  }

  return {
    exceptionDays,
    exceptionPrefix,
    perWeek,
    partialWeekly,
    exceptionMagnitude,
    perWeekSelect,
  }
}

/** 纯周规则下 `[0, D)` 的工作日数。对任意整数 D（含负）成立（floor 除 + 非负余数）。 */
function weeklyCountBefore(D: number, index: WorkdayIndex): number {
  const q = Math.floor(D / 7)
  const r = D - q * 7 // [0, 6]
  return q * index.perWeek + index.partialWeekly[r]
}

/** 索引里「例外日 < D」的 delta 之和（二分 + 前缀和）。 */
function exceptionCountBefore(D: number, index: WorkdayIndex): number {
  const days = index.exceptionDays
  let lo = 0
  let hi = days.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (days[mid] < D) lo = mid + 1
    else hi = mid
  }
  return index.exceptionPrefix[lo]
}

/**
 * ── rank / select：把「第 n 个工作日 / 下一个工作日」变成 O(log k) ────────────
 *
 * `workdaysBetween` 用 rank（数个数）就够了；advance/search 家族（`nextWorkday` /
 * `addWorkdays` / `snapToWorkday` …）原本要**逐日扫描**找下一个工作日，现在改成对
 * 「工作日计数」求逆（select）。三方口径与旧实现逐字节一致（见 `workdays.index.test.ts`
 * 的差分模糊测试）。
 *
 * `rankBefore(D)` = `[0, D)` 内的工作日数 = 纯周闭式 + 例外 delta 前缀和（均见上）。
 * `select` = 求 `rankBefore` 的逆 —— 第 r 个工作日的天整数。
 */

/** `[0, D)` 内的工作日数。任意整数 D（含负）成立。O(log k)。 */
function rankBefore(D: number, index: WorkdayIndex): number {
  return weeklyCountBefore(D, index) + exceptionCountBefore(D, index)
}

/**
 * 纯周规则下，最小的 x 使 `weeklyCountBefore(x) >= u`。要求 `perWeek > 0`（否则
 * `weeklyCountBefore ≡ 0`，无解 —— 调用方须先走 perWeek === 0 分支）。
 *
 * 半开周：`weeklyCountBefore(7k + r) = k·P + partialWeekly[r]`（r ∈ [0,6]）。最小 x
 * 落在**最小的、能命中的周** k 上（该周内再取最小的 r）。O(1)。
 */
function weeklySelect(u: number, index: WorkdayIndex): number {
  const P = index.perWeek
  // 一周内 r ∈ [0,6] 的最大工作日数（r = 6 是一周最后一天；partialWeekly[7] = P 不参与）
  const maxInWeek = index.partialWeekly[6]
  const k = Math.ceil((u - maxInWeek) / P)
  const need = u - k * P // 落在 [.., maxInWeek]；`perWeekSelect[need]` 给出所需天偏移
  if (need <= 0) return k * 7
  return k * 7 + index.perWeekSelect[need]
}

/**
 * 第 r 个工作日（0-indexed，可为负 —— 表示「第 0 个工作日之前的第 |r| 个」）。
 * 要求 `perWeek > 0`（工作日无限，任意 r 恒有解）。
 *
 * 关键：`rankBefore` 数的是**严格小于** x 的工作日，故 `rankBefore(w_r) = r`。要定位
 * w_r，对 `x = w_r + 1` 求「最小的 x 使 `rankBefore(x) >= r + 1`」再减一
 * （`rankBefore` 每过一天只增 0 或 1，故该 x 恰是 w_r + 1）。
 *
 * 窗口**自包含**（把 O(log 天数) 压到 O(log k)）：记 T = r + 1、mag =
 * exceptionMagnitude、E(x) ∈ [−mag, mag]，x* = 最小的 x 使
 * `rankBefore(x) = W(x) + E(x) >= T`。则
 *   · `rankBefore(x*) >= T` 且 `E <= mag` ⇒ `W(x*) >= T − mag` ⇒ `x* >= weeklySelect(T − mag)`；
 *   · `y = weeklySelect(T + mag)` ⇒ `rankBefore(y) >= T + mag − mag = T` ⇒ `x* <= y`。
 * 故二分只需在 [weeklySelect(T − mag), weeklySelect(T + mag)] 内 —— 调用方不必给界。
 * mag = 0（无有效例外）时窗口退化成一点 → 零次二分，纯 O(1)。
 */
function selectByRank(
  r: number,
  index: WorkdayIndex,
  lo = Number.NEGATIVE_INFINITY,
  hi = Number.POSITIVE_INFINITY,
): number {
  const T = r + 1
  const mag = index.exceptionMagnitude
  // 调用方已知的包含约束 [lo, hi]（结果工作日必落其中）与 mag 窗口取交 —— 只收紧、不放大。
  let a = Math.max(lo + 1, weeklySelect(T - mag, index)) // x 的下界
  let b = Math.min(hi + 1, weeklySelect(T + mag, index)) // x 的上界
  while (a < b) {
    const mid = (a + b) >> 1
    if (rankBefore(mid, index) >= T) b = mid
    else a = mid + 1
  }
  return a - 1
}

/**
 * 第一个 `>= lo` 的工作日。O(log k)。
 * - `perWeek > 0`：工作日无限 → 恒有解（`selectByRank`）。
 * - `perWeek === 0`（全休周）：工作日 = `exceptionDays`（holiday 落在非周工作日上
 *   delta = 0，不入表；故表里全是 custom）→ 二分例外表；lo 之后没有则 `null`。
 */
function firstWorkdayOnOrAfter(lo: number, index: WorkdayIndex): number | null {
  if (index.perWeek === 0) {
    const days = index.exceptionDays
    let a = 0
    let b = days.length
    while (a < b) {
      const m = (a + b) >> 1
      if (days[m] < lo) a = m + 1
      else b = m
    }
    const d = days[a]
    return d === undefined ? null : d
  }
  return selectByRank(rankBefore(lo, index), index, lo)
}

/** 最后一个 `<= hi` 的工作日。语义 / 边界与 `firstWorkdayOnOrAfter` 对称。O(log k)。 */
function lastWorkdayOnOrBefore(hi: number, index: WorkdayIndex): number | null {
  if (index.perWeek === 0) {
    const days = index.exceptionDays
    let a = 0
    let b = days.length
    while (a < b) {
      const m = (a + b) >> 1
      if (days[m] <= hi) a = m + 1
      else b = m
    }
    const d = days[a - 1]
    return d === undefined ? null : d
  }
  return selectByRank(rankBefore(hi + 1, index) - 1, index, Number.NEGATIVE_INFINITY, hi)
}

/**
 * 逐日实现（`workdaysBetweenDay` 的**兜底**与差分测试的**对照真值**）。
 * 不带索引时 `workdaysBetween` 走它 → 与改动前逐字节一致，公开调用点零风险。
 * 非有限端点（畸形输入：`epochDay` 得 NaN）也回退到这里，逐字节复刻旧行为
 * （含 `a > b` 且计数为 0 时返回 `-0` 这点）。
 */
function workdaysBetweenDayLoop(a: number, b: number, cal: Calendar): number {
  if (a === b) return 0
  const sign = a < b ? 1 : -1
  const from = sign > 0 ? a : b
  const to = sign > 0 ? b : a

  let count = 0
  for (let cursor = from; cursor < to; cursor += 1) {
    if (isWorkdayDay(cursor, cal)) count += 1
  }
  return count * sign
}

/**
 * 计算 [a, b) 区间内的工作日数量（左闭右开）。若 a > b，返回负数。
 *
 * 带 `index` → O(log k) 闭式解（见 `WorkdayIndex`）；不带 / 端点非有限 → 逐日兜底
 * （逐字节复刻旧行为）。两条路径对任意日历、任意区间**结果恒等**，见
 * `workdays.index.test.ts` 的差分模糊测试。
 */
function workdaysBetweenDay(a: number, b: number, cal: Calendar, index?: WorkdayIndex): number {
  if (!index || !Number.isFinite(a) || !Number.isFinite(b)) {
    return workdaysBetweenDayLoop(a, b, cal)
  }
  if (a === b) return 0
  // 与旧实现同口径取符号 —— 含「a > b 且计数为 0 → -0」这一位级细节。
  const sign = a < b ? 1 : -1
  const from = sign > 0 ? a : b
  const to = sign > 0 ? b : a

  const weekly = weeklyCountBefore(to, index) - weeklyCountBefore(from, index)
  const exceptions = exceptionCountBefore(to, index) - exceptionCountBefore(from, index)
  return (weekly + exceptions) * sign
}

/**
 * 公开签名保持 `(a, b, cal)`。第四参 `index` 可选 —— 热路径（`solve()` 经
 * `buildScheduleContext`）传入预建索引；其余调用点省略即走逐日实现（结果相同）。
 *
 * ⚠️ **`index` 必须是由同一个 `cal` 构建出来的**（`buildWorkdayIndex(cal)`）。
 * 传错日历不会报错，只会静默算出与该 `cal` 不符的结果 —— 因为快路径完全信任
 * 索引里的周模式与例外表。仓库内所有调用点都满足这个前提（索引与日历同源于
 * 同一个 context / 同一个 `input`），新加调用点时请照做。
 */
export function workdaysBetween(
  a: DateStr,
  b: DateStr,
  cal: Calendar,
  index?: WorkdayIndex,
): number {
  return workdaysBetweenDay(epochDay(a), epochDay(b), cal, index)
}

/**
 * 任务的结束日期：从 `start` 起，工期为 `duration` 个工作日（含起始日）。
 * 工期为 0（里程碑）时返回 `start` 本身吸附到的工作日。
 */
function taskFinishDay(
  start: number,
  duration: number,
  cal: Calendar,
  index?: WorkdayIndex,
): number {
  if (duration <= 0) return snapToWorkdayDay(start, cal, index)
  return addWorkdaysDay(start, duration - 1, cal, index)
}

export function taskFinish(
  start: DateStr,
  duration: number,
  cal: Calendar,
  index?: WorkdayIndex,
): DateStr {
  return dayToIso(taskFinishDay(epochDay(start), duration, cal, index))
}

/** 任务的开始日期：从 `finish` 倒推 `duration` 个工作日（含结束日）。 */
function taskStartDay(
  finish: number,
  duration: number,
  cal: Calendar,
  index?: WorkdayIndex,
): number {
  if (duration <= 0) return snapToWorkdayDay(finish, cal, index)
  return addWorkdaysDay(finish, -(duration - 1), cal, index)
}

export function taskStart(
  finish: DateStr,
  duration: number,
  cal: Calendar,
  index?: WorkdayIndex,
): DateStr {
  return dayToIso(taskStartDay(epochDay(finish), duration, cal, index))
}

/**
 * 一个 manual 排期区间：从 `start` 起、宽 `duration` 个工作日。
 *
 * 「开始日 + 工期 → 结束日」的算式**只有 `taskFinish` 一处实现**；本函数把该算式与
 * manual 的区间形态**绑成一个**，供命令层（moveTo / resize）与拖拽影子（barDrag）
 * 共用 —— 免得各调用点各写一份 `taskFinish(...)` 而悄悄漂移（Task 2 的拖拽 / 命令
 * 不一致正是这么来的）。
 *
 * 日历缺失（畸形项目）时退回 `finish = start`，绝不产出非法日期。
 */
export function manualInterval(
  start: DateStr,
  duration: number,
  cal: Calendar | undefined,
): Scheduling {
  return { mode: 'manual', start, finish: cal ? taskFinish(start, duration, cal) : start }
}

/**
 * `[start, finish]` 区间内的**含首尾**工作日数。两端先 `snapToWorkday` 归一
 * （与 manual 区间 / 拖拽落点同口径）；`start > finish` 时返回 0。
 *
 * 与 `workdaysBetween`（左闭右开、只计数）配对：本函数把「排期跨度」折成「工期」，
 * 是 `taskFinish` / `taskStart` 的逆运算（对工作日对齐的区间）。
 */
export function workdaysInclusive(
  start: DateStr,
  finish: DateStr,
  cal: Calendar,
  index?: WorkdayIndex,
): number {
  const from = snapToWorkdayDay(epochDay(start), cal, index)
  const to = snapToWorkdayDay(epochDay(finish), cal, index)
  if (from > to) return 0
  return workdaysBetweenDay(from, to, cal, index) + 1
}

/**
 * `[start, finish]` 区间内的全部工作日（**含首尾**），升序。
 * `start` 落在非工作日时先吸附到下一个工作日（与 `snapToWorkday` 同口径）。
 * `start > finish` 时返回空数组。
 *
 * 与 `workdaysBetween` 的分工：后者只**计数**（左闭右开），本函数给**列表** ——
 * 负载要逐个日期累加，需要列表。日期迭代只此一处，别在调度器里再写一遍。
 */
export function workdaysInRange(
  start: DateStr,
  finish: DateStr,
  cal: Calendar,
  index?: WorkdayIndex,
): DateStr[] {
  const out: DateStr[] = []
  let cursor = snapToWorkdayDay(epochDay(start), cal, index)
  const to = epochDay(finish)
  while (cursor <= to) {
    out.push(dayToIso(cursor))
    cursor = nextWorkdayDay(cursor, cal, index)
  }
  return out
}
