import type { DateStr } from './model/types'

/** YYYY-MM-DD 与 Date 互转，全部按本地时区解释，避免 UTC 偏移导致差一天 */

/**
 * ── 为什么除了 `Date` 还要有一套「天整数」────────────────────────────────
 *
 * 排期引擎在**整日**粒度上工作（工作日 / 吸附 / 工期都按天），但每次
 * `parseDate`（`split('-').map(Number)` + `new Date`）都要分配 2 个数组、3 个
 * Number 和 1 个 Date；`formatDate` 再 `padStart` 拼字符串。CPU profile 显示
 * 10k 叶子的 `solve()` 里 `parseDate` 独占 ~53%，日期串的解析/格式化/分配合计
 * ~80% —— 图遍历本身只有 ~1.6%。
 *
 * 改法：内部一律用「自 1970-01-01 起的天数」（epoch day）做整数运算，
 * **只有在模块边界**（对外 API）才与 `DateStr` 互转。`epochDay` / `dayToIso`
 * 各带一个 memo —— 同一批日期串在求解里反复出现，一次算好反复查。
 *
 * 天整数是**纯民用历算术**（days-from-civil），与时区/DST 无关：整日排期本就不该
 * 受某地夏令时跳变影响。已对 1970–2100 全区间、多种时区（含 `America/New_York`、
 * `Asia/Shanghai`、`Pacific/Chatham` 等 30/45 分钟偏移区）逐日核对与
 * `new Date(y,m-1,d)` 一致 —— **唯一分歧**在「整段跳过了一个民用日」的时区/时段
 * （日期线平移，如 `Pacific/Apia` 跳过的 2011-12-30、`Pacific/Kiritimati` 跳过的
 * 1994-12-31）：旧 `Date` 实现根本**无法表示**被跳过的这一天
 * （`formatDate(parseDate('2011-12-30'))` 会折成 `'2011-12-31'`），新实现则如实表示它。
 * 这是**有意为之、更正确**的差异，对本项目无实际影响（这些日期不出现，测试在
 * `America/New_York` 下跑）—— 但别声称「所有时区逐字节等价」。
 *
 * `parseDate` / `formatDate` 仍保留 —— 真正处理**壁钟时刻**的边界代码
 * （`calendar/dateTime.ts` 的 `parseDateTime`、UI 时间轴）继续用 `Date`。
 */

export function parseDate(iso: DateStr): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function formatDate(date: Date): DateStr {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// ── 民用历 ↔ 天整数（Howard Hinnant 的 days-from-civil 算法）──────────────
// 参考：http://howardhinnant.github.io/date_algorithms.html
// 全部用整数乘除 + Math.floor，无 `Date`、无字符串 —— 故无分配、无 TZ 依赖。
/** 1970-01-01 记作第 0 天。`y/m/d` 为公历（m 从 1 起）。 */
function daysFromCivil(y: number, m: number, d: number): number {
  y -= m <= 2 ? 1 : 0
  const era = Math.floor(y / 400)
  const yoe = y - era * 400 // [0, 399]
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1 // [0, 365]
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy // [0, 146096]
  return era * 146097 + doe - 719468
}

/** `daysFromCivil` 的逆。返回 `[year, month(1-12), day]`。 */
function civilFromDays(z: number): [number, number, number] {
  z += 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097 // [0, 146096]
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  )
  const y = yoe + era * 400
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)) // [0, 365]
  const mp = Math.floor((5 * doy + 2) / 153) // [0, 11]
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1 // [1, 31]
  const m = mp + (mp < 10 ? 3 : -9) // [1, 12]
  return [y + (m <= 2 ? 1 : 0), m, d]
}

/**
 * memo 上限：日期串去重后本就有界（工程跨度内几千个），这个上限纯是给
 * 「长开会话里不停拖日期」兜底，超了就整体清空（纯函数，重算无害）。
 */
const CACHE_LIMIT = 1 << 20

const dayByIso = new Map<string, number>()
const isoByDay = new Map<number, string>()

/** `YYYY-MM-DD` → 天整数。带时刻或畸形串退化走 `Date`（与旧行为同口径，绝不静默算错）。 */
export function epochDay(iso: DateStr): number {
  const hit = dayByIso.get(iso)
  if (hit !== undefined) return hit

  let day: number
  if (iso.length === 10 && iso.charCodeAt(4) === 45 /* - */ && iso.charCodeAt(7) === 45) {
    const y =
      (iso.charCodeAt(0) - 48) * 1000 +
      (iso.charCodeAt(1) - 48) * 100 +
      (iso.charCodeAt(2) - 48) * 10 +
      (iso.charCodeAt(3) - 48)
    const m = (iso.charCodeAt(5) - 48) * 10 + (iso.charCodeAt(6) - 48)
    const d = (iso.charCodeAt(8) - 48) * 10 + (iso.charCodeAt(9) - 48)
    day = daysFromCivil(y, m, d)
  } else {
    // 畸形 / 带时刻：旧实现会得到 Invalid Date，再 `formatDate` 成 "NaN-NaN-NaN"。
    // 这里如实沿用 —— 用 NaN 表示，`dayToIso(NaN)` 还原同一个串（守卫测试兜底）。
    const dt = parseDate(iso)
    day = dt.getTime() === dt.getTime() ? daysFromCivil(dt.getFullYear(), dt.getMonth() + 1, dt.getDate()) : Number.NaN
  }

  if (dayByIso.size >= CACHE_LIMIT) dayByIso.clear()
  dayByIso.set(iso, day)
  return day
}

/** 天整数 → `YYYY-MM-DD`。非有限值还原成旧 `formatDate(Invalid Date)` 的 "NaN-NaN-NaN"。 */
export function dayToIso(day: number): DateStr {
  if (!Number.isFinite(day)) return 'NaN-NaN-NaN'
  const hit = isoByDay.get(day)
  if (hit !== undefined) return hit

  const [y, m, d] = civilFromDays(day)
  const iso = `${pad4(y)}-${pad2(m)}-${pad2(d)}`
  if (isoByDay.size >= CACHE_LIMIT) isoByDay.clear()
  isoByDay.set(day, iso)
  return iso
}

/** 周一 = 0 … 周日 = 6，与 `Calendar.workingDays` 同序。整数版，无 `Date`。 */
export function weekdayMon0(day: number): number {
  // 第 0 天（1970-01-01）是周四 → +3 之后取模；`+7 %7` 兜住负数。
  return (((day + 3) % 7) + 7) % 7
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

function pad4(n: number): string {
  if (n >= 1000) return `${n}`
  if (n >= 100) return `0${n}`
  if (n >= 10) return `00${n}`
  if (n >= 0) return `000${n}`
  // 负年份超出本项目范围；保持至少 4 位（与 `${y}` 对负数的行为一致即可）。
  return `${n}`
}

export function addDays(iso: DateStr, n: number): DateStr {
  if (Number.isInteger(n)) return dayToIso(epochDay(iso) + n)
  // 非整数 n（elapsed lag 理论可为小数）：旧实现经 `Date.setDate`，
  // 截断的是「月内日 + n」而非偏移量本身，向零取整。保留旧路径以免差一天。
  const date = parseDate(iso)
  date.setDate(date.getDate() + n)
  return formatDate(date)
}
